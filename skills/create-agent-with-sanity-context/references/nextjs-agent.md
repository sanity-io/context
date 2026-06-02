# Reference: Next.js + Vercel AI SDK Agent

This is a reference implementation using Next.js and Vercel AI SDK. Use it as a pattern guide—adapt the concepts to whatever framework and AI library the user is working with.

> **Reference Implementation**: See [ecommerce/\_index.md](ecommerce/_index.md) for file navigation, then explore [ecommerce/app/](ecommerce/app/).

## Contents

- [Install Dependencies](#install-dependencies)
- [Environment Variables](#environment-variables)
- [Chat API Route](#create-the-chat-api-route)
- [Customizing the System Prompt](#customizing-the-system-prompt)
- [Frontend Chat Component](#frontend-chat-component)
- [Testing the Agent](#testing-the-agent)
- [Advanced Patterns](#advanced-patterns)
- [Troubleshooting](#troubleshooting)

---

## Install Dependencies

```bash
npm install @ai-sdk/anthropic @ai-sdk/mcp @ai-sdk/react ai
# or
pnpm add @ai-sdk/anthropic @ai-sdk/mcp @ai-sdk/react ai
```

**IMPORTANT: Always check [ecommerce/app/package.json](ecommerce/app/package.json) for current working versions.**

Do NOT guess versions—check the reference `package.json` or use `npm info <package> version` to get the latest. AI SDK packages update frequently.

## Environment Variables

See [ecommerce/.env.example](ecommerce/.env.example) for the template.

Required variables:

```bash
# Sanity Configuration
NEXT_PUBLIC_SANITY_PROJECT_ID=your-project-id
NEXT_PUBLIC_SANITY_DATASET=production

# Sanity API token with read access
SANITY_API_READ_TOKEN=your-read-token

# Sanity Context MCP URL
SANITY_CONTEXT_MCP_URL=https://api.sanity.io/v2026-03-03/context/mcp/:projectId/:dataset/:slug

# Anthropic API key
ANTHROPIC_API_KEY=your-anthropic-key

# Agent config slug (for fetching system prompt from Sanity)
AGENT_CONFIG_SLUG=default
```

## Create the Chat API Route

See [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts) for the complete implementation.

**Key sections:**

- **Client tool definitions**: Tools without `execute` function - execution happens client-side
- **`buildSystemPrompt`**: Combines base prompt from Sanity with implementation-specific parts
- **MCP client creation**: HTTP transport connection to the Sanity Context MCP server
- **`streamText` call**: Combining MCP tools with client tools

**MCP Connection Pattern** (`createMCPClient`):

```ts
const mcpClient = await createMCPClient({
  transport: {
    type: 'http',
    url: process.env.SANITY_CONTEXT_MCP_URL,
    headers: {
      Authorization: `Bearer ${process.env.SANITY_API_READ_TOKEN}`,
    },
  },
})
```

**Tool Combination** (`streamText`):

```ts
const mcpTools = await mcpClient.tools()
const result = streamText({
  model: anthropic('claude-opus-4-5'),
  system: systemPrompt,
  messages: await convertToModelMessages(messages),
  tools: {
    ...mcpTools, // Sanity Context tools (groq_query, initial_context, etc.)
    ...clientTools, // Client-side tools (page context, screenshot)
  },
})
```

## Customizing the System Prompt

The system prompt shapes how your agent behaves. You can define prompts entirely inline, or store the base prompt in Sanity and combine with implementation-specific parts in code. The reference implementation uses the hybrid approach.

See [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts) (`buildSystemPrompt` function).

**For more examples**, see [system-prompts.md](system-prompts.md).

## Frontend Chat Component

See [ecommerce/app/src/components/chat/chat.tsx](ecommerce/app/src/components/chat/chat.tsx) for a complete implementation.

**Key sections:**

- `useChat` hook setup with transport, auto-continuation, and tool handling
- Client-side tool execution via `onToolCall` callback
- Screenshot handling workaround (files sent as follow-up message)
- Chat UI rendering with message display and input

**Related files:**

- [ecommerce/app/src/lib/client-tools.ts](ecommerce/app/src/lib/client-tools.ts) - Tool name constants and `DocumentContext` type
- [ecommerce/app/src/lib/capture-context.ts](ecommerce/app/src/lib/capture-context.ts) - Page context and screenshot capture functions

### Markdown Rendering

LLM responses are markdown — without a renderer, users see raw syntax.

```bash
npm install react-markdown
```

See [ecommerce/app/src/components/chat/message/text-part.tsx](ecommerce/app/src/components/chat/message/text-part.tsx) for the reference implementation.

## Testing the Agent

1. Start your Next.js dev server: `npm run dev`
2. Open your chat interface or test via curl:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What content do you have access to?"}]}'
```

The agent should:

1. Call `initial_context` to understand available content types
2. Respond with a summary of what it can help with

---

## Conversation Insights

Track conversations for analytics and debugging using `sanityInsightsIntegration`:

```ts
import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'

const result = streamText({
  model: anthropic('claude-sonnet-4-5'),
  messages,
  experimental_telemetry: {
    isEnabled: true,
    integrations: [
      sanityInsightsIntegration({
        client: writeClient, // Sanity client with write permissions
        agentId: 'my-agent',
        threadId: chatId,
      }),
    ],
  },
})
```

This automatically saves conversations to Sanity. Set up a scheduled function to classify them. See [conversation-classification.md](conversation-classification.md) for details.

---

## Advanced Patterns

These patterns take your agent from basic to production-ready. See the reference implementation for working examples of each.

### Client-Side Tools

Some tools need to run in the browser (capturing page context, taking screenshots). Define these as tools without execute functions on the server, then handle them on the client.

**Server definition**: See [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts) (`clientTools`)

**Client handling**: See [ecommerce/app/src/components/chat/chat.tsx](ecommerce/app/src/components/chat/chat.tsx) (`onToolCall`)

**Context capture utilities**: See [ecommerce/app/src/lib/capture-context.ts](ecommerce/app/src/lib/capture-context.ts)

- `getDocumentContext()`: Lightweight context sent with every message
- `getPageContent()`: Page content as markdown
- `captureScreenshot()`: Visual screenshot using html2canvas

### User Context Transport

Include context (current page, user preferences) with every request without the user typing it.

See [ecommerce/app/src/components/chat/chat.tsx](ecommerce/app/src/components/chat/chat.tsx) (`DefaultChatTransport`):

```tsx
transport: new DefaultChatTransport({
  body: () => ({documentContext: getDocumentContext()}),
}),
```

Then access it on the server at [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts) (`documentContext`):

```ts
const {messages, documentContext}: {messages: UIMessage[]; documentContext: DocumentContext} =
  await req.json()
```

### Auto-Continuation for Tool Calls

When the LLM makes tool calls, automatically continue the conversation.

See [ecommerce/app/src/components/chat/chat.tsx](ecommerce/app/src/components/chat/chat.tsx) (`sendAutomaticallyWhen`):

```tsx
sendAutomaticallyWhen: ({messages}) => {
  if (pendingScreenshotRef.current) return false
  return lastAssistantMessageIsCompleteWithToolCalls({messages})
},
```

### Custom Rendering (Product Directives)

For e-commerce or content-heavy apps, define custom markdown directives to render rich content using `@sanity/agent-directives`.

**Install**: `pnpm add @sanity/agent-directives`

**System Prompt** (define the syntax): Define custom directives in your system prompt (see `buildSystemPrompt` in the API route)

**Directive rendering**: See [ecommerce/app/src/components/chat/message/text-part.tsx](ecommerce/app/src/components/chat/message/text-part.tsx)

- Uses `remarkAgentDirectives` plugin from `@sanity/agent-directives/react`
- Directive names are converted to PascalCase (`::document{...}` → `Document` component)
- Handles both inline (`:document{...}`) and block (`::document{...}`) formats

**Document component**: See [ecommerce/app/src/components/chat/message/document.tsx](ecommerce/app/src/components/chat/message/document.tsx)

- Routes directives by `type` to specific components (e.g., `Product`)

**Product component**: See [ecommerce/app/src/components/chat/message/product.tsx](ecommerce/app/src/components/chat/message/product.tsx)

- Inline: renders as a link
- Block: renders with image thumbnail

---

## Troubleshooting

### MCP endpoint returns 500 or schema errors

Sanity Context requires a deployed Studio. See [Deploy Your Studio](studio-setup.md#deploy-your-studio) for instructions.

### "SANITY_CONTEXT_MCP_URL is not set"

Ensure you've:

1. Created a Sanity Context document in Studio (or use the base URL without a slug)
2. Given it a slug
3. Copied the MCP URL from the document
4. Added it to your `.env.local`

### "401 Unauthorized" from MCP

Your `SANITY_API_READ_TOKEN` is missing or invalid. Generate a new token at [sanity.io/manage](https://sanity.io/manage) with Viewer permissions.

### "No documents found" / Empty results

Check your Sanity Context document's content filter:

- Is the GROQ filter correct?
- Are the document types spelled correctly?
- Are there published documents matching the filter?

### Tools not appearing

1. Check that `mcpClient.tools()` returns tools (log it)
2. Ensure the MCP URL is correct (project ID, dataset, and optionally slug)
3. If using a slug-based URL, verify the Sanity Context document is published
