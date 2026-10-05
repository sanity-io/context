# Connecting an Agent

Just enough to connect Sanity Context on any JavaScript or TypeScript stack with AI SDK v7. The coding agent already knows the user's framework; this shows the Context-specific parts. For a complete Next.js app, see [Full Reference Implementation](#full-reference-implementation).

## Contents

- [Install](#install)
- [Fetching Initial Context](#fetching-initial-context)
- [Request/Response](#requestresponse)
- [Streaming to a Chat UI](#streaming-to-a-chat-ui)
- [Framework Pitfalls](#framework-pitfalls)
- [Full Reference Implementation](#full-reference-implementation)
- [Other Languages and Libraries](#other-languages-and-libraries)

---

## Install

The snippets are written for these versions. Install the same majors:

| Package | Major | For |
| --- | --- | --- |
| `ai` | 7 | AI SDK core (`generateText`, `streamText`) |
| `@ai-sdk/mcp` | 2 | MCP client |
| `@ai-sdk/anthropic` | 4 | LLM provider (or the v7-compatible package for your provider) |
| `@ai-sdk/react` / `@ai-sdk/svelte` | 4 / 5 | Chat UI, only for a streaming chat |

```bash
npm install ai@^7 @ai-sdk/mcp@^2 @ai-sdk/anthropic@^4
# plus, for a React chat UI:
npm install @ai-sdk/react@^4
```

Mismatched majors cause type errors that look like mistakes in your own code (for example on `model`). The example app's [package.json](ecommerce/app/package.json) uses the same majors.

Plain Node doesn't load `.env` files on its own: run with `node --env-file=.env ...` or use your existing secrets setup.

---

## Fetching Initial Context

The snippets below inline the initial context and drop the `initial_context` tool only when the fetch succeeded; if it failed, the model still has the tool. Append `/initial-context` to the MCP URL **path** (before any query params). Same auth header, same query params:

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

## Request/Response

One question in, one answer out. Use it as-is for a CLI or script, or call it from an API route that returns JSON.

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
      // The AI SDK stops after one step by default. Without this the agent calls a tool and never answers.
      stopWhen: stepCountIs(20),
    })
    return text
  } finally {
    await mcpClient.close()
  }
}
```

---

## Streaming to a Chat UI

A route handler that streams to the AI SDK's chat UI. It takes a web `Request` and returns a web `Response`:

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

export async function POST(request: Request) {
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
      // The AI SDK stops after one step by default. Without this the agent calls a tool and never answers.
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

**Where the handler goes:**

| Framework | Location |
| --- | --- |
| Next.js (App Router) | `app/api/chat/route.ts`, exported as `POST` (as above) |
| SvelteKit | `src/routes/api/chat/+server.ts`, as `export const POST = ({request}) => ...` |
| Remix / React Router | The route's `action({request})` |
| Hono, Workers, and other web-`Response` runtimes | The route handler |
| Express / Node `http` | Same `streamText` call, then `pipeUIMessageStreamToResponse({response: res, stream: toUIMessageStream({stream: result.stream})})` from `ai` |

**On the client**, use your framework's AI SDK UI package. It posts to `/api/chat` by default and reads this stream. Don't parse the stream by hand; its wire format is internal to the AI SDK. A minimal React version:

```tsx
'use client'
import {useChat} from '@ai-sdk/react'
import {useState} from 'react'

export function Chat() {
  const {messages, sendMessage, status, error} = useChat()
  const [input, setInput] = useState('')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        sendMessage({text: input})
        setInput('')
      }}
    >
      {messages.map((message) => (
        <div key={message.id}>
          {message.role}:{' '}
          {message.parts.map((part, i) => (part.type === 'text' ? <span key={i}>{part.text}</span> : null))}
        </div>
      ))}
      {error && <p>{error.message}</p>}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={status === 'submitted' || status === 'streaming'}
      />
    </form>
  )
}
```

Svelte (`Chat` from `@ai-sdk/svelte`) and Vue follow the same pattern. Text parts are markdown: render them with a markdown renderer, and sanitize the HTML if the content can contain untrusted markup. The chat needs the browser, so render it client-side. The example app's [chat components](ecommerce/app/src/components/chat/) show a fuller version.

---

## Framework Pitfalls

- **Env vars not on `process.env`** (SvelteKit, Cloudflare Workers, and other non-Node runtimes): the default `anthropic()` provider reads `process.env.ANTHROPIC_API_KEY` and fails. Import the key from the framework's private env module and use `createAnthropic({apiKey})`. Read the MCP URL and token the same way.

---

## Full Reference Implementation

The example app is a complete Next.js shopping assistant. [ecommerce/\_index.md](ecommerce/_index.md) maps its files; the parts worth copying:

- **Chat route** with initial context caching and Insights: [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts)
- **Chat UI** with markdown rendering: [ecommerce/app/src/components/chat/](ecommerce/app/src/components/chat/)
- **Client-side tools** (tools without `execute`, handled in the browser via `onToolCall`), **per-request page context**, and **rich product rendering** with `@sanity/agent-directives`: see `clientTools` in the route, `chat.tsx`, and `message/text-part.tsx`

The reference loads its base system prompt from an `agent.config` document and returns a 500 if none exists. To reuse that pattern, add the schema from [ecommerce/studio/schemaTypes/documents/agentConfig.ts](ecommerce/studio/schemaTypes/documents/agentConfig.ts) and create one document; otherwise define the prompt inline. For what to put in the prompt, use the `shape-your-agent` skill.

---

## Other Languages and Libraries

The endpoint is a standard MCP server, so any MCP-capable client works: connect over HTTP with `Authorization: Bearer <organization token>`, then apply the same initial context rule.

- **Python with LangChain:** see [Connect Sanity Context with LangChain](https://www.sanity.io/docs/ai/sanity-context-langchain).
- **Python with the OpenAI Agents SDK:** see [Connect Sanity Context with OpenAI Agents SDK](https://www.sanity.io/docs/ai/sanity-context-openai-agents-sdk).
- **Anything else:** use the library's own MCP client support. Don't hand-convert tool definitions; MCP clients handle schemas and tool calls for you.
