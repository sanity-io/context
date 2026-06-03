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
npm install @ai-sdk/anthropic @ai-sdk/mcp @ai-sdk/svelte ai
# or
pnpm add @ai-sdk/anthropic @ai-sdk/mcp @ai-sdk/svelte ai
```

Key difference from Next.js: `@ai-sdk/svelte` instead of `@ai-sdk/react`.

## Environment Variables

SvelteKit splits environment variables into two modules:

- **`$env/static/private`** — Server-only variables (never exposed to client)
- **`$env/static/public`** — Variables prefixed with `PUBLIC_` (available in client bundles)

> **Important:** SvelteKit does not expose private env vars on `process.env`. This means the default `anthropic()` provider (which reads `process.env.ANTHROPIC_API_KEY`) will not work. You must use `createAnthropic({ apiKey })` instead.

Required variables in your `.env` file:

```bash
# Sanity Configuration (private — server only)
SANITY_PROJECT_ID=your-project-id
SANITY_DATASET=production
SANITY_API_READ_TOKEN=your-read-token

# Public (available in client bundles, prefixed with PUBLIC_)
PUBLIC_SANITY_API_VERSION=vX

# Anthropic API key (private — server only)
ANTHROPIC_API_KEY=your-anthropic-key
```

## Create the Chat API Route

Create `src/routes/api/chat/+server.ts`:

```ts
import {streamText, convertToModelMessages, stepCountIs, type UIMessage} from 'ai'
import {createAnthropic} from '@ai-sdk/anthropic'
import {createMCPClient} from '@ai-sdk/mcp'
import type {RequestHandler} from './$types'
import {
  SANITY_API_READ_TOKEN,
  ANTHROPIC_API_KEY,
  SANITY_PROJECT_ID,
  SANITY_DATASET,
} from '$env/static/private'
import {PUBLIC_SANITY_API_VERSION} from '$env/static/public'

// MCP URL — connects to your Sanity Context document
const SANITY_API_VERSION = PUBLIC_SANITY_API_VERSION || 'vX'
const AGENT_CONTEXT_SLUG = 'content-qa'
const MCP_URL = `https://api.sanity.io/${SANITY_API_VERSION}/context/mcp/${SANITY_PROJECT_ID}/${SANITY_DATASET}/${AGENT_CONTEXT_SLUG}`

// System prompt for the agent
const SYSTEM_PROMPT = `You are a helpful content assistant.

When answering questions:
- Use the available tools to search and retrieve relevant content
- Be concise and accurate
- Cite specific sources when relevant
- If you don't find information, say so clearly

Your goal is to help users find and understand the content available to you.`

export const POST: RequestHandler = async ({request}) => {
  const {messages}: {messages: UIMessage[]} = await request.json()

  // Create MCP client using AI SDK wrapper
  const mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: MCP_URL,
      headers: {
        Authorization: `Bearer ${SANITY_API_READ_TOKEN}`,
      },
    },
  })

  try {
    // Get tools from MCP client
    const mcpTools = await mcpClient.tools()

    // Stream the response
    const result = streamText({
      model: createAnthropic({apiKey: ANTHROPIC_API_KEY})('claude-sonnet-4-20250514'),
      messages: await convertToModelMessages(messages),
      system: SYSTEM_PROMPT,
      tools: mcpTools,
      stopWhen: stepCountIs(10),
      onFinish: async () => {
        await mcpClient.close()
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    await mcpClient.close()
    throw error
  }
}
```

**Key patterns:**

- **Imports**: Note `createAnthropic` (not bare `anthropic`), imports from `$env/static/private` and `$env/static/public`, `RequestHandler` type from `./$types`
- **MCP URL**: Constructed from env vars
- **System prompt**: Inline for simplicity
- **`POST` handler**: MCP client creation, tool discovery, `streamText` call, and response

**SvelteKit-specific details:**

- **`createAnthropic({ apiKey: ANTHROPIC_API_KEY })`** — Must pass the key explicitly because SvelteKit doesn't expose private env vars on `process.env`
- **`convertToModelMessages(messages)`** — The `Chat` class from `@ai-sdk/svelte` sends `UIMessage[]` (with `parts` arrays). `streamText` expects `ModelMessage[]` (with `content` strings). This conversion is required.
- **`stopWhen: stepCountIs(10)`** — AI SDK v6 pattern for limiting tool-call loops (replaces the older `maxSteps`)
- **`toUIMessageStreamResponse()`** — Returns the UI message stream format that the `Chat` class expects. Using `toDataStreamResponse()` will silently fail.

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

**`src/routes/chat/+page.svelte`** — Page wrapper:

```svelte
<script lang="ts">
  import Chat from '../../components/Chat.svelte';
</script>

<svelte:head>
  <title>Chat - Content Assistant</title>
</svelte:head>

<main>
  <Chat />
</main>
```

**`src/components/Chat.svelte`** — Chat component:

```svelte
<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';

  let input = '';
  const chat = new Chat({
    api: '/api/chat'
  });

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

    {#each chat.messages as message, i (i)}
      <div class="message" class:user={message.role === 'user'} class:assistant={message.role === 'assistant'}>
        <div class="message-role">
          {message.role === 'user' ? 'You' : 'Assistant'}
        </div>
        <div class="message-content">
          {#each message.parts as part}
            {#if part.type === 'text'}
              <p>{part.text}</p>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <form class="input-form" onsubmit={handleSubmit}>
    <input
      type="text"
      bind:value={input}
      placeholder="Ask a question..."
    />
    <button type="submit" disabled={!input.trim()}>
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

  .message-content p { margin: 0.25rem 0; }

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

### Markdown Rendering

LLM responses are markdown — without a renderer, users see raw syntax. Add `marked` as a dependency and use `{@html marked(part.text)}` instead of `<p>{part.text}</p>`.

## Testing the Agent

1. Start your SvelteKit dev server: `npm run dev`
2. Open `/chat` in your browser at `http://localhost:5173/chat`
3. Or test via curl:

```bash
curl -X POST http://localhost:5173/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "parts": [{"type": "text", "text": "What content do you have access to?"}]}]}'
```

The agent should:

1. Call `groq_query` or `schema_explorer` to understand available content types
2. Respond with a summary of what it can help with

---

## SvelteKit-Specific Gotchas

| Gotcha                      | Symptom                           | Fix                                                                                                               |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Bare `anthropic()` provider | "ANTHROPIC_API_KEY is missing"    | Use `createAnthropic({ apiKey: ANTHROPIC_API_KEY })` — SvelteKit doesn't expose private env vars on `process.env` |
| Missing SSR disable         | Runtime errors about browser APIs | Add `src/routes/chat/+page.ts` with `export const ssr = false`                                                    |

---

## Troubleshooting

### "ANTHROPIC_API_KEY is missing"

SvelteKit private env vars are only available via `$env/static/private`, not `process.env`. Use `createAnthropic({ apiKey: ANTHROPIC_API_KEY })` with the explicitly imported key.

### Chat messages render empty

Verify you're using `toUIMessageStreamResponse()`, not `toDataStreamResponse()`. The `Chat` class from `@ai-sdk/svelte` expects the UI message stream format.

### "Cannot find module `$env/static/private`"

Ensure the file importing from `$env/static/private` is in a SvelteKit server context (`+server.ts`, `+page.server.ts`, etc.). Client-side files cannot import private env vars.

### Runtime errors on chat page

The `Chat` class requires browser APIs. Add a `+page.ts` file alongside your `+page.svelte` with `export const ssr = false`.

### MCP endpoint returns 500 or schema errors

Sanity Context requires a deployed Studio. See [Deploy Your Studio](studio-setup.md#deploy-your-studio) for instructions.

### "Module not found: @ai-sdk/mcp"

Ensure `@ai-sdk/mcp` is in your `package.json` dependencies. In monorepo setups, it can be in the workspace root, but for standalone projects it must be in the app's own `package.json`.
