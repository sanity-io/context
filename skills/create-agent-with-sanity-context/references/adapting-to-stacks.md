# Adapting to Different Stacks

The MCP connection pattern is framework and LLM-agnostic. This guide gives just enough to connect a non-Next.js stack and get answers back; adapt it to the user's framework.

## Contents

- [The Universal Pattern](#the-universal-pattern)
- [Install](#install)
- [Fetching Initial Context](#fetching-initial-context)
- [Core Pattern (Request/Response)](#core-pattern-requestresponse)
- [Different Frameworks](#different-frameworks)
- [Other AI Libraries and Languages](#other-ai-libraries-and-languages)
- [Questions to Ask Users](#questions-to-ask-users)

---

## The Universal Pattern

Regardless of framework, the integration follows this flow:

```
1. Fetch initial context via HTTP (${SANITY_CONTEXT_MCP_URL}/initial-context)
2. Create MCP client with HTTP transport
3. Authenticate with the organization API token (Context access)
4. Get tools from MCP client
5. Inline the initial context into the system prompt and drop the initial_context tool,
   or, if the fetch failed, keep the initial_context tool
6. Call the LLM with the tools, allowing multiple steps
7. Clean up the MCP connection when done
```

---

## Install

```bash
npm install ai @ai-sdk/mcp @ai-sdk/anthropic
```

Swap `@ai-sdk/anthropic` for your provider's package if you use a different LLM. Add `@sanity/context` only if you set up Insights. The snippets below use AI SDK v7 (`instructions`, `onEnd`, standalone stream helpers).

Plain Node doesn't load `.env` files on its own: run with `node --env-file=.env ...` or use your existing secrets setup.

---

## Fetching Initial Context

The snippets below inline the initial context and drop the `initial_context` tool only when the fetch succeeded, per the rule in [SKILL.md](../SKILL.md#how-sanity-context-works). Append `/initial-context` to the MCP URL **path** (before any query params). Same auth header, same query params:

```ts
async function fetchInitialContext(mcpUrl: string, token: string): Promise<string | null> {
  const url = new URL(mcpUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/initial-context`
  try {
    const res = await fetch(url, {headers: {Authorization: `Bearer ${token}`}})
    if (res.ok) return await res.text()
    console.error(`Initial context request failed: HTTP ${res.status} ${await res.text()}`)
  } catch (error) {
    console.error('Initial context request failed', error)
  }
  return null
}
```

In a long-running server, cache the result with a short TTL (the reference implementation uses 5 minutes). In a CLI, script, or serverless cold start, a cache doesn't help: fetch per run.

---

## Core Pattern (Request/Response)

The smallest complete agent: one question in, one answer out. Use it as-is for a CLI or script, or wrap it in a route handler.

```ts
import {anthropic} from '@ai-sdk/anthropic'
import {createMCPClient} from '@ai-sdk/mcp'
import {generateText, stepCountIs} from 'ai'

const SYSTEM_PROMPT = 'You answer questions using the Sanity tools. Never guess; if nothing matches, say so.'

export async function ask(question: string): Promise<string> {
  const mcpUrl = process.env.SANITY_CONTEXT_MCP_URL
  const token = process.env.SANITY_ORGANIZATION_TOKEN
  if (!mcpUrl || !token) {
    throw new Error('Set SANITY_CONTEXT_MCP_URL and SANITY_ORGANIZATION_TOKEN')
  }

  const [mcpClient, initialContext] = await Promise.all([
    createMCPClient({
      transport: {type: 'http', url: mcpUrl, headers: {Authorization: `Bearer ${token}`}},
    }),
    fetchInitialContext(mcpUrl, token), // See above
  ])

  try {
    const allTools = await mcpClient.tools()
    // Drop initial_context only when its payload is inlined above; otherwise the model needs the tool
    const {initial_context: _, ...toolsWithoutInitialContext} = allTools
    const tools = initialContext ? toolsWithoutInitialContext : allTools

    const {text} = await generateText({
      model: anthropic('claude-sonnet-4-5'),
      instructions: initialContext
        ? `${SYSTEM_PROMPT}\n\n# Data reference\n\n${initialContext}`
        : SYSTEM_PROMPT,
      prompt: question,
      tools,
      // AI SDK v7 stops after 1 step by default. Without this the agent calls a tool and never answers.
      stopWhen: stepCountIs(20),
    })
    return text
  } finally {
    await mcpClient.close()
  }
}
```

---

## Different Frameworks

**Express (JSON response)**

```ts
import express from 'express'

const app = express()
app.use(express.json())

app.post('/api/assistant', async (req, res) => {
  const question: unknown = req.body?.question
  if (typeof question !== 'string' || !question.trim()) {
    res.status(400).json({error: 'Body must be JSON: {"question": "..."}'})
    return
  }
  try {
    res.json({answer: await ask(question)}) // `ask` from the core pattern above
  } catch (error) {
    console.error(error)
    res.status(500).json({error: error instanceof Error ? error.message : 'Assistant failed'})
  }
})
```

For a streamed chat UI in Express, build the call like the Remix example below with `streamText`, then pipe it with `pipeUIMessageStreamToResponse({response: res, stream: toUIMessageStream({stream: result.stream})})` from `ai`.

**Remix / React Router (streamed to `useChat`)**

Any framework whose route handlers return a web `Response` works the same way:

```ts
import {anthropic} from '@ai-sdk/anthropic'
import {createMCPClient, type MCPClient} from '@ai-sdk/mcp'
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai'

export async function action({request}: {request: Request}) {
  const mcpUrl = process.env.SANITY_CONTEXT_MCP_URL
  const token = process.env.SANITY_ORGANIZATION_TOKEN
  if (!mcpUrl || !token) {
    return Response.json({error: 'Sanity Context is not configured'}, {status: 500})
  }
  const {messages}: {messages: UIMessage[]} = await request.json()
  let mcpClient: MCPClient | undefined

  try {
    const [client, initialContext] = await Promise.all([
      createMCPClient({
        transport: {type: 'http', url: mcpUrl, headers: {Authorization: `Bearer ${token}`}},
      }),
      fetchInitialContext(mcpUrl, token), // See "Fetching Initial Context" above
    ])
    mcpClient = client

    const allTools = await client.tools()
    // Drop initial_context only when its payload is inlined above; otherwise the model needs the tool
    const {initial_context: _, ...toolsWithoutInitialContext} = allTools
    const tools = initialContext ? toolsWithoutInitialContext : allTools

    const result = streamText({
      model: anthropic('claude-sonnet-4-5'),
      instructions: initialContext
        ? `You are a helpful assistant.\n\n# Data reference\n\n${initialContext}`
        : 'You are a helpful assistant.',
      messages: await convertToModelMessages(messages),
      tools,
      // AI SDK v7 stops after 1 step by default. Without this the agent calls a tool and never answers.
      stopWhen: stepCountIs(20),
      onEnd: async () => {
        await client.close()
      },
    })

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({stream: result.stream, tools, originalMessages: messages}),
    })
  } catch (error) {
    await mcpClient?.close()
    console.error(error)
    return Response.json({error: error instanceof Error ? error.message : 'Chat failed'}, {status: 500})
  }
}
```

---

## Other AI Libraries and Languages

The endpoint is a standard MCP server, so any MCP-capable client works: connect over HTTP with `Authorization: Bearer <organization token>`, then apply the same initial context rule.

- **Python with LangChain:** see [Connect Sanity Context with LangChain](https://www.sanity.io/docs/ai/sanity-context-langchain).
- **Python with the OpenAI Agents SDK:** see [Connect Sanity Context with OpenAI Agents SDK](https://www.sanity.io/docs/ai/sanity-context-openai-agents-sdk).
- **Anything else:** use the library's own MCP client support. Don't hand-convert tool definitions; MCP clients handle schemas and tool calls for you.

---

## Questions to Ask Users

When adapting this pattern, understand:

1. **"What framework are you using?"** — Determines route/endpoint structure
2. **"What AI SDK or library?"** — Determines how tools are passed to the LLM
3. **"What's the agent's purpose?"** — Shapes the system prompt
4. **"What content types will it access?"** — Informs the endpoint's GROQ filter in the Context app
5. **"Streaming or request/response?"** — Streaming for chat UIs (`streamText`), request/response for APIs, CLIs, and scripts (`generateText`)
