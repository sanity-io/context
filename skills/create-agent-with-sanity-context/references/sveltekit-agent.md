# Reference: SvelteKit + Vercel AI SDK Agent

This is a reference implementation using SvelteKit and Vercel AI SDK. Use it as a pattern guide—adapt the concepts to whatever framework and AI library the user is working with.

## Contents

- [Install Dependencies](#install-dependencies)
- [Environment Variables](#environment-variables)
- [Chat API Route](#create-the-chat-api-route)
- [Customizing the System Prompt](#customizing-the-system-prompt)
- [Frontend Chat Component](#frontend-chat-component)
- [Testing the Agent](#testing-the-agent)
- [SvelteKit-Specific Gotchas](#sveltekit-specific-gotchas)
- [Troubleshooting](#troubleshooting)

---

## Install Dependencies

```bash
npm install @ai-sdk/anthropic @ai-sdk/mcp @ai-sdk/svelte ai marked
# or
pnpm add @ai-sdk/anthropic @ai-sdk/mcp @ai-sdk/svelte ai marked
```

Key difference from Next.js: `@ai-sdk/svelte` instead of `@ai-sdk/react`. `marked` renders the model's markdown. The snippets use AI SDK v7 and SvelteKit 3 (what `npx sv create` installs today).

## Environment Variables

SvelteKit 3 declares environment variables in `src/env.ts` and validates them at build time:

```ts
// src/env.ts
import {defineEnvVars} from '@sveltejs/kit/env'

export const variables = defineEnvVars({
  SANITY_CONTEXT_MCP_URL: {},
  SANITY_ORGANIZATION_TOKEN: {},
  ANTHROPIC_API_KEY: {},
})
```

Server code imports them from `$app/env/private`. On **SvelteKit 2**, skip `src/env.ts` and import the same names from `$env/static/private` instead.

> **Important:** SvelteKit does not expose private env vars on `process.env`. This means the default `anthropic()` provider (which reads `process.env.ANTHROPIC_API_KEY`) will not work. You must use `createAnthropic({ apiKey })` instead.

Values in your `.env` file:

```bash
# MCP endpoint URL, from the endpoint in the Context app
SANITY_CONTEXT_MCP_URL=https://api.sanity.io/v1/context/organizations/:organizationId/mcp/:endpointName
# Organization API token with Context access
SANITY_ORGANIZATION_TOKEN=your-token
# Anthropic API key
ANTHROPIC_API_KEY=your-anthropic-key
```

Because SvelteKit 3 validates these at build time, `npm run build` fails until they're set.

## Create the Chat API Route

Create `src/routes/api/chat/+server.ts`:

```ts
import {createAnthropic} from '@ai-sdk/anthropic'
import {createMCPClient, type MCPClient} from '@ai-sdk/mcp'
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai'
import type {RequestHandler} from './$types'
import {ANTHROPIC_API_KEY, SANITY_CONTEXT_MCP_URL, SANITY_ORGANIZATION_TOKEN} from '$app/env/private'

const SYSTEM_PROMPT = `You are a helpful content assistant.

When answering questions:
- Use the available tools to search and retrieve relevant content
- Be concise and accurate
- Cite specific sources when relevant
- If you don't find information, say so clearly`

const CACHE_TTL_MS = 5 * 60 * 1000
let cachedInitialContext: string | null = null
let cacheTimestamp = 0

async function fetchInitialContext(): Promise<string | null> {
  if (cachedInitialContext && Date.now() - cacheTimestamp < CACHE_TTL_MS) return cachedInitialContext
  const url = new URL(SANITY_CONTEXT_MCP_URL)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/initial-context`
  try {
    const res = await fetch(url, {headers: {Authorization: `Bearer ${SANITY_ORGANIZATION_TOKEN}`}})
    if (res.ok) {
      cachedInitialContext = await res.text()
      cacheTimestamp = Date.now()
    } else {
      console.error(`Initial context request failed: HTTP ${res.status} ${await res.text()}`)
    }
  } catch (error) {
    console.error('Initial context request failed', error)
  }
  return cachedInitialContext
}

export const POST: RequestHandler = async ({request}) => {
  const {messages}: {messages: UIMessage[]} = await request.json()
  let mcpClient: MCPClient | undefined

  try {
    const [client, initialContext] = await Promise.all([
      createMCPClient({
        transport: {
          type: 'http',
          url: SANITY_CONTEXT_MCP_URL,
          headers: {Authorization: `Bearer ${SANITY_ORGANIZATION_TOKEN}`},
        },
      }),
      fetchInitialContext(),
    ])
    mcpClient = client

    const allTools = await client.tools()
    // Drop initial_context only when its payload is inlined above; otherwise the model needs the tool
    const {initial_context: _, ...toolsWithoutInitialContext} = allTools
    const tools = initialContext ? toolsWithoutInitialContext : allTools

    const result = streamText({
      model: createAnthropic({apiKey: ANTHROPIC_API_KEY})('claude-sonnet-4-5'),
      instructions: initialContext
        ? `${SYSTEM_PROMPT}\n\n# Data reference\n\n${initialContext}`
        : SYSTEM_PROMPT,
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
    return Response.json(
      {error: error instanceof Error ? error.message : 'Chat request failed'},
      {status: 500},
    )
  }
}
```

**Key patterns:**

- **Imports**: `createAnthropic` (not bare `anthropic`), env from `$app/env/private`, `RequestHandler` type from `./$types`
- **MCP URL**: Read from `SANITY_CONTEXT_MCP_URL`, copied from the endpoint in the Context app
- **Initial context**: Inlined into the instructions and the `initial_context` tool dropped, or the tool kept when the fetch failed. Never neither
- **Errors**: Returned as JSON so the browser sees the real message instead of an opaque 500

**SvelteKit-specific details:**

- **`createAnthropic({ apiKey: ANTHROPIC_API_KEY })`** — Must pass the key explicitly because SvelteKit doesn't expose private env vars on `process.env`
- **`convertToModelMessages(messages)`** — The `Chat` class from `@ai-sdk/svelte` sends `UIMessage[]` (with `parts` arrays). `streamText` expects `ModelMessage[]`. This conversion is required.
- **`stopWhen: stepCountIs(20)`** — Lets the agent call tools and then answer. AI SDK v7 stops after one step by default
- **`createUIMessageStreamResponse` + `toUIMessageStream`** — Returns the UI message stream format that the `Chat` class expects (AI SDK v7; replaces the deprecated `result.toUIMessageStreamResponse()`)

## Customizing the System Prompt

The system prompt shapes how your agent behaves. You can define prompts entirely inline, or store the base prompt in Sanity and combine with implementation-specific parts in code. The example above uses inline; the Next.js reference implementation uses the hybrid approach.

See [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts) (`buildSystemPrompt` function) for the hybrid pattern.

**For more examples**, see [system-prompts.md](system-prompts.md).

## Frontend Chat Component

The chat UI requires two files: a page config to disable SSR, and the component itself.

**`src/routes/chat/+page.ts`** — Disable SSR:

```ts
// The Chat class from @ai-sdk/svelte requires browser APIs
export const ssr = false
```

> **Important:** The `Chat` class uses browser-only APIs. Without `export const ssr = false`, you'll get runtime errors during server-side rendering.

**`src/routes/chat/+page.svelte`** — Page wrapper (SvelteKit 3's `#lib` alias, defined under `imports` in `package.json` by `sv create`; SvelteKit 2 uses `$lib`):

```svelte
<script lang="ts">
  import Chat from '#lib/components/Chat.svelte';
</script>

<svelte:head>
  <title>Chat - Content Assistant</title>
</svelte:head>

<main>
  <Chat />
</main>
```

**`src/lib/components/Chat.svelte`** — Chat component:

```svelte
<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';
  import { marked } from 'marked';

  let input = $state('');
  // Posts to /api/chat by default
  const chat = new Chat({});

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    chat.sendMessage({ text: input });
    input = '';
  }
</script>

<div class="chat-container">
  <div class="chat-header">
    <h2>Content Assistant</h2>
    <p>Ask me anything about the content</p>
  </div>

  <div class="messages">
    {#if chat.messages.length === 0}
      <div class="empty-state">
        <p>Hi! I'm your content assistant. Ask me anything about the available content.</p>
      </div>
    {/if}

    {#each chat.messages as message (message.id)}
      <div class="message" class:user={message.role === 'user'} class:assistant={message.role === 'assistant'}>
        <div class="message-role">
          {message.role === 'user' ? 'You' : 'Assistant'}
        </div>
        <div class="message-content">
          {#each message.parts as part}
            {#if part.type === 'text'}
              <!-- Model output: sanitize (e.g. DOMPurify) if your content can contain untrusted HTML -->
              {@html marked(part.text)}
            {/if}
          {/each}
        </div>
      </div>
    {/each}

    {#if chat.error}
      <p class="error">{chat.error.message}</p>
    {/if}
  </div>

  <form class="input-form" onsubmit={handleSubmit}>
    <input
      type="text"
      bind:value={input}
      placeholder="Ask a question..."
    />
    <button type="submit" disabled={!input.trim() || chat.status === 'streaming'}>
      Send
    </button>
  </form>
</div>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 600px;
    max-width: 800px;
    margin: 0 auto;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
    background: white;
  }

  .chat-header {
    padding: 1rem;
    background: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
  }

  .chat-header h2 { margin: 0 0 0.25rem 0; font-size: 1.25rem; }
  .chat-header p { margin: 0; font-size: 0.875rem; color: #666; }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .empty-state { text-align: center; color: #999; margin-top: 2rem; }

  .message { display: flex; flex-direction: column; gap: 0.25rem; }
  .message.user { align-items: flex-end; }

  .message-role { font-size: 0.75rem; font-weight: 600; color: #666; }

  .message-content {
    padding: 0.75rem 1rem;
    border-radius: 8px;
    line-height: 1.5;
    max-width: 80%;
  }

  /* :global because {@html} content isn't scoped */
  .message-content :global(p) { margin: 0.25rem 0; }

  .error { color: #c00; font-size: 0.875rem; }

  .message.user .message-content { background: #007bff; color: white; }
  .message.assistant .message-content { background: #f5f5f5; color: #333; }

  .input-form {
    display: flex;
    gap: 0.5rem;
    padding: 1rem;
    border-top: 1px solid #e0e0e0;
  }

  .input-form input {
    flex: 1;
    padding: 0.75rem 1rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 1rem;
  }

  .input-form input:focus { outline: none; border-color: #007bff; }

  .input-form button {
    padding: 0.75rem 1.5rem;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .input-form button:disabled { background: #ccc; cursor: not-allowed; }
</style>
```

**Key patterns:**

- **`Chat` class** — Svelte uses a class instantiation (`new Chat({...})`) instead of React's `useChat` hook
- **`chat.messages`** — Reactive by default in Svelte 5; no need for stores or subscriptions
- **`chat.sendMessage({ text })`** — Sends a message to the API route
- **Parts-based rendering** — Iterate `message.parts` and check `part.type === 'text'` to render text content
- **`$state`** — `input` must be `$state` so the Send button's disabled state updates (Svelte 5 runes)

### Markdown Rendering

LLM responses are markdown; the component renders them with `marked`. `{@html ...}` inserts raw HTML, so sanitize it (for example with DOMPurify) if the content the agent reads can contain untrusted HTML.

## Testing the Agent

1. Start your SvelteKit dev server: `npm run dev`
2. Open `/chat` in your browser at `http://localhost:5173/chat`
3. Or test via curl:

```bash
curl -X POST http://localhost:5173/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"id": "1", "role": "user", "parts": [{"type": "text", "text": "What content do you have access to?"}]}]}'
```

The agent should:

1. Already know the available content types (the initial context is in the system prompt)
2. Respond with a summary of what it can help with—no tool call needed on the first message

---

## SvelteKit-Specific Gotchas

| Gotcha                          | Symptom                                                                | Fix                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Bare `anthropic()` provider     | "ANTHROPIC_API_KEY is missing"                                         | Use `createAnthropic({ apiKey: ANTHROPIC_API_KEY })`: SvelteKit doesn't expose private env vars on `process.env`                          |
| Missing SSR disable             | Runtime errors about browser APIs                                      | Add `src/routes/chat/+page.ts` with `export const ssr = false`                                                                            |
| SvelteKit 2 code on SvelteKit 3 | "`$lib` has been removed. Use `#lib` instead", or env imports untyped | Declare env in `src/env.ts` and import from `$app/env/private`; use `#lib`, which needs `"imports": {"#lib/*": "./src/lib/*"}` in `package.json` |

---

## Troubleshooting

### "ANTHROPIC_API_KEY is missing"

SvelteKit private env vars are only available through `$app/env/private`, not `process.env`. Use `createAnthropic({ apiKey: ANTHROPIC_API_KEY })` with the explicitly imported key.

### Chat messages render empty

Verify the route returns `createUIMessageStreamResponse({stream: toUIMessageStream({stream: result.stream, tools, originalMessages: messages})})`, not a text or data stream. The `Chat` class from `@ai-sdk/svelte` expects the UI message stream format.

### "Cannot find module `$app/env/private`", or the build fails with "Value is missing"

The variables must be declared in `src/env.ts`, which SvelteKit 3 validates at build time: set them in `.env` or the build environment before `npm run build`. Only server files (`+server.ts`, `+page.server.ts`, etc.) can import private env vars.

### Runtime errors on chat page

The `Chat` class requires browser APIs. Add a `+page.ts` file alongside your `+page.svelte` with `export const ssr = false`.

### MCP connection errors

See the [Troubleshooting section in SKILL.md](../SKILL.md#troubleshooting) for 401, 403, `-32004` (schema not deployed), and empty results. Server errors also print in the dev server's terminal.

### "Module not found: @ai-sdk/mcp"

Ensure `@ai-sdk/mcp` is in your `package.json` dependencies. In monorepo setups, it can be in the workspace root, but for standalone projects it must be in the app's own `package.json`.
