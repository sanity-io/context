# Conversation Insights

Track and classify agent conversations using `@sanity/context`. This enables analytics, debugging, and understanding how users interact with your agent.

> **Reference Implementation**: See [ecommerce/\_index.md](ecommerce/_index.md) for file navigation.

## Overview

The Insights system has two parts that work together:

1. **Telemetry Integration**: Saves conversation transcripts from your chat route to your organization's Context store
2. **Scheduled Classification**: Analyzes conversations with your own AI SDK model and records verdicts through the Context API

**Set up both parts.** Telemetry alone just stores raw conversations. Classification is what produces Insights in the Context app: success scores, sentiment, and content gaps.

Both parts ride on `@sanity/client` (^8.4.0) and its `client.context` namespace. The pending queue is a GROQ query over the org's Context document store: conversations that were never classified, have no recorded failure, are non-empty, and have been idle for `settledForMinutes` (default 10, and you own the setting). Classification itself runs on your side, with your model and your LLM API key.

## Prerequisites

Before setting up insights, gather:

| Requirement                | Where used              | Notes                                                                                                                      |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Sanity organization ID** | Both                    | From [sanity.io/manage](https://sanity.io/manage), the organization that owns the Context endpoint                          |
| **MCP endpoint name**      | Both                    | The endpoint's name in the Context app, which is also the last path segment of the MCP URL                               |
| **Organization API token** | Both                    | Context **Editor** permissions, created in Manage under the organization's API > Tokens. Keep it server-side only          |
| **LLM API key**            | Classification (Step 3) | For the scheduled function that classifies conversations (Anthropic, OpenAI, etc.)                                         |

## Project Structure

Scheduled classification uses **Sanity Blueprints** to deploy **Sanity Functions**.

Before adding files, search the project for an existing `sanity.blueprint.ts`. If one exists with deployed functions, add the new function there — even if it's not next to the lockfile. An existing working setup takes precedence over the default placement rules below. Only follow these rules when creating a new blueprint from scratch.

Find the project's lockfile (`yarn.lock`, `pnpm-lock.yaml`, or `package-lock.json`). Two rules for new blueprints:

1. **`sanity.blueprint.ts` must be in the same directory as the lockfile.** The CLI detects the package manager from the lockfile. If no lockfile is present, pass `--fn-installer pnpm` (or `npm`/`yarn`) to the deploy command.
2. **Function `src` paths are resolved relative to the blueprint file.** By default a function named `classify-conversations` maps to `functions/classify-conversations/` next to the blueprint. Use the `src` property in `defineScheduledFunction` to point to a different directory.

**In a monorepo** with no existing blueprint, the lockfile is at the workspace root — so `sanity.blueprint.ts` and `functions/` go there too, alongside the root `package.json`. However, if a blueprint already exists in a subdirectory (e.g. `apps/studio/`) and functions are successfully deploying from there, use that location. The CLI can work from subdirectories when configured correctly (e.g. with `--fn-installer pnpm`).

**Dependencies**: Functions use the `package.json` next to the blueprint for dependencies by default (`project-level`). Each function can alternatively have its own `package.json` (`function-level`), but a function uses one or the other — never both. See [Sanity Functions: Dependencies](https://www.sanity.io/docs/functions/function-dependencies).

Example layout for a new blueprint in a monorepo:

```
my-monorepo/
├── sanity.blueprint.ts       # Next to lockfile
├── functions/
│   └── classify-conversations/
│       └── index.ts
├── package.json              # Function deps go here (project-level)
├── yarn.lock                 # (or pnpm-lock.yaml, package-lock.json)
├── .env
└── apps/
    ├── studio/
    └── web/
```

This is a reference layout for a new blueprint, so always adapt to the user's existing directory structure. If a blueprint already exists elsewhere, use that location instead. If the project has multiple blueprint stacks in a subdirectory pattern (e.g. `apps/blueprints/studio/`, `apps/blueprints/web/`), create a new stack following the same convention.

## Setup

### Step 1: Enable Telemetry in Your Chat Route

Add `sanityInsightsIntegration` to your `streamText` call. It takes an org-scoped Sanity client and saves conversation transcripts automatically.

```ts
import {createClient} from '@sanity/client'
import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'
import {streamText} from 'ai'

// Server-side only: the token must never reach the browser
const client = createClient({
  apiVersion: 'v2025-11-27',
  token: process.env.SANITY_ORGANIZATION_TOKEN,
  context: {organizationId: process.env.SANITY_ORGANIZATION_ID},
  useCdn: false,
  useProjectHostname: false,
})

const result = streamText({
  model: anthropic('claude-sonnet-4-5'),
  messages,
  telemetry: {
    integrations: [
      sanityInsightsIntegration({
        client,
        threadId: chatId, // Unique conversation thread ID
        // Tags the conversation with the MCP endpoint's name for grouping
        metadata: {mcpEndpoints: process.env.SANITY_CONTEXT_ENDPOINT_NAME ?? []},
      }),
    ],
  },
})
```

**Token**: The client authenticates with an organization API token with Context **Editor** permissions. A Context Viewer token reads the MCP but can't record conversations, and project tokens don't work at all. If the agent already uses a Viewer token for the MCP, replace it with one Editor token for both rather than juggling two. Keep it server-side only.

**Thread ID**: Each conversation needs a unique `threadId`. Generate one when a new chat starts and persist it across messages in that conversation. How it reaches the server depends on the setup:

- **AI SDK `useChat`**: The hook sends `id` (the chat ID) in the request body automatically. Extract it in your route handler and use it as `threadId`.
- **Custom transport**: Pass the thread ID via request body, headers, or cookies, whatever fits the app's architecture.

See [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts): it takes `id` from the `useChat` request body and uses it as `threadId`.

**Not using AI SDK?** The telemetry integration requires Vercel AI SDK. If using another library, save transcripts with `client.context.conversations.save` from `@sanity/client` directly:

```ts
// Call this after each conversation turn completes
await client.context.conversations.save({
  threadId: chatId,
  messages: [
    {role: 'user', content: 'How do I return an item?'},
    {role: 'assistant', content: 'You can return items within 30 days...'},
    // Include full conversation history each call: it upserts the transcript
  ],
  metadata: {mcpEndpoints: process.env.SANITY_CONTEXT_ENDPOINT_NAME ?? []},
  modelProvider: 'anthropic',
  modelId: 'claude-sonnet-4-5',
  tokenUsage: {inputTokens: 1200, outputTokens: 350, totalTokens: 1550},
})
```

Each save is an idempotent upsert per thread: the messages replace the stored transcript wholesale, and the last write wins. See the Insights API Reference below for full API details.

---

**Steps 2-7 below set up the classification function**, a separate scheduled job that analyzes saved conversations. This runs outside your app using Sanity Functions.

### Step 2: Add Dependencies

Ensure these packages are in the `package.json` next to `sanity.blueprint.ts`, merged into existing dependencies (do not overwrite the file):

**dependencies**: `@ai-sdk/anthropic` (or your provider's package), `@sanity/client`, `@sanity/context`, `@sanity/functions`, `ai`. Use the latest versions on the same majors as [ecommerce/package.json](ecommerce/package.json) and [ecommerce/app/package.json](ecommerce/app/package.json).

**devDependencies**: `@sanity/blueprints` (latest), `dotenv` (^17)

If using a different LLM provider, swap `@ai-sdk/anthropic` for your provider's package (e.g., `@ai-sdk/openai`).

### Step 3: Create the Classification Function

Create `functions/classify-conversations/index.ts` next to `sanity.blueprint.ts`:

```ts
// functions/classify-conversations/index.ts
import {anthropic} from '@ai-sdk/anthropic'
import {createClient} from '@sanity/client'
import {classifyConversations} from '@sanity/context/insights'
import {scheduledEventHandler} from '@sanity/functions'

export const handler = scheduledEventHandler(async () => {
  // These are injected by the blueprint's env block. The names are examples,
  // so adapt to match the user's env var conventions.
  const {SANITY_ORGANIZATION_ID, SANITY_CONTEXT_ENDPOINT_NAME, SANITY_ORGANIZATION_TOKEN} = process.env

  if (!SANITY_ORGANIZATION_ID || !SANITY_CONTEXT_ENDPOINT_NAME || !SANITY_ORGANIZATION_TOKEN) {
    console.error(
      '[classify-conversations] Missing SANITY_ORGANIZATION_ID, SANITY_CONTEXT_ENDPOINT_NAME, or SANITY_ORGANIZATION_TOKEN',
    )
    return
  }

  const client = createClient({
    apiVersion: 'v2025-11-27',
    token: SANITY_ORGANIZATION_TOKEN,
    context: {organizationId: SANITY_ORGANIZATION_ID},
    useCdn: false,
    useProjectHostname: false,
  })

  const result = await classifyConversations({
    client,
    mcpEndpoint: SANITY_CONTEXT_ENDPOINT_NAME,
    model: anthropic('claude-haiku-4-5'),
  })

  console.log(
    `Classified ${result.successCount}/${result.totalFound} conversations${result.errorCount > 0 ? ` (${result.errorCount} failed)` : ''}`,
  )
})
```

### Step 4: Configure the Blueprint

If `sanity.blueprint.ts` already exists, add the scheduled function resource to it. Otherwise, create it:

```ts
// sanity.blueprint.ts
import {defineBlueprint, defineScheduledFunction} from '@sanity/blueprints'
import 'dotenv/config'

// Read from .env at deploy time. Unset values are skipped (this also keeps strict TypeScript
// happy), so ANTHROPIC_API_KEY can instead be set after deploy with `sanity functions env add`.
const env: Record<string, string> = {}
for (const name of [
  'ANTHROPIC_API_KEY',
  'SANITY_ORGANIZATION_ID',
  'SANITY_CONTEXT_ENDPOINT_NAME',
  'SANITY_ORGANIZATION_TOKEN',
]) {
  const value = process.env[name]
  if (value) env[name] = value
}

export default defineBlueprint({
  resources: [
    defineScheduledFunction({
      name: 'classify-conversations',
      timeout: 600,
      env,
      event: {
        expression: '*/10 * * * *', // Every 10 minutes
      },
    }),
  ],
})
```

**How this works**: The `env` object is built from your local `.env` at deploy time and injected into the function's `process.env` at runtime. The names in the list are what the function reads; if the project's `.env` uses different names, map them here. `import 'dotenv/config'` reads `.env` only, not `.env.local`, so Next.js projects that keep secrets in `.env.local` need the values in `.env` (or exported in the shell) when deploying.

### Step 5: Configure Environment Variables

The function needs four values at runtime: organization ID, endpoint name, an organization API token (Context Editor), and an LLM API key.

All four are passed via the blueprint's `env` block (Step 4). The blueprint reads from your `.env` at deploy time. Create or update `.env` next to `sanity.blueprint.ts` and ask the user what env var names their project uses:

```bash
# Example: use the env var names from the project's existing .env
SANITY_ORGANIZATION_ID=your-org-id
SANITY_CONTEXT_ENDPOINT_NAME=my-agent
SANITY_ORGANIZATION_TOKEN=sk...
ANTHROPIC_API_KEY=sk-ant-...
```

**LLM API key**: Either keep it in `.env` (the blueprint passes it through at deploy), or leave it out of `.env` and set it after deploying with `npx sanity functions env add` (Step 7). Use one or the other: the second is useful if you don't want secrets in `.env` or deploy from CI.

### Step 6: Test Locally

Before deploying, verify the full pipeline works:

1. **Conversations are saved**: Check Insights in the Context app for conversations (send a few messages to your agent first)
2. **Classification runs**: Execute the function locally:

```bash
npx sanity functions test classify-conversations --with-user-token
```

The function reads its env vars from the `.env` file next to `sanity.blueprint.ts`.

**Note**: Local testing runs against your real data, so conversations will actually be classified. Only conversations idle for `settledForMinutes` (default 10) are eligible, so active conversations are never classified mid-flight.

### Step 7: Deploy

Run all commands from the directory containing `sanity.blueprint.ts`.

**Prerequisites**: Make sure you're logged in to the Sanity CLI. Run `npx sanity login` if needed.

```bash
# 1. Install dependencies
pnpm install   # or npm install / yarn

# 2. Initialize the blueprint stack (first time only)
npx sanity blueprints init

# 3. Promote to organization scope (required for scheduled functions)
npx sanity blueprints promote

# 4. Check for issues
npx sanity blueprints doctor

# 5. Deploy the blueprint and function (ask for permission to deploy)
npx sanity blueprints deploy

# 6. Only if ANTHROPIC_API_KEY isn't in .env: set it on the deployed function
npx sanity functions env add classify-conversations ANTHROPIC_API_KEY <your-api-key>
```

**What these commands do:**

- **`blueprints init`**: Links your project to a Sanity blueprint stack. Run once per project.
- **`blueprints promote`**: Elevates the stack to organization scope, which is required for scheduled functions. You need organization member permissions to run this.
- **`blueprints doctor`**: Checks blueprint health; flags dependency issues, version mismatches, and directory structure problems.
- **`blueprints deploy`**: Deploys the function and schedules it to run.
- **`functions env add`**: Sets an environment variable for a deployed function. Must be run after deploy. Replace `<your-api-key>` with your actual API key.

### Step 8: Verify Deployment

```bash
# Check function logs
npx sanity functions logs classify-conversations

# Manually trigger for testing
npx sanity functions test classify-conversations --with-user-token
```

## Troubleshooting

### Function not running

- Did you run `npx sanity blueprints promote`? Scheduled functions require org-level scope.
- Check logs: `npx sanity functions logs classify-conversations`

### 401 errors from the Context API

The organization token is missing or invalid, or belongs to a different organization than `SANITY_ORGANIZATION_ID`. Verify `SANITY_ORGANIZATION_TOKEN` is set in the function's env (check the blueprint's `env` block and your `.env`).

### 403 `insightsWriteAccessDenied`

The token can't record conversations. Recording Insights requires an organization token with Context **Editor** access or higher; a Viewer token only reads the MCP.

### 404 errors from the Context API

The organization ID or thread ID doesn't resolve. Verify `SANITY_ORGANIZATION_ID` matches the organization that owns the Context endpoint, and that the client is created with `context: {organizationId}`.

### Classification not finding conversations

- Conversations need to sit idle for `settledForMinutes` (default 10) before they enter the pending queue
- If you pass `mcpEndpoint`, only conversations tagged with that name via `metadata.mcpEndpoints` qualify
- Conversations with a recorded classification failure are not retried; check Insights in the Context app for errors
- Check that telemetry is saving conversations: look for them in Insights in the Context app

## Insights API Reference

Every function takes `{client}`: a `@sanity/client` (^8.4.0) created with `createClient({apiVersion: 'v2025-11-27', token, context: {organizationId}, useCdn: false, useProjectHostname: false})`.

### `classifyConversations`

The recommended way to classify conversations. Handles fetching, batching, and error handling in a single call:

```ts
import {classifyConversations} from '@sanity/context/insights'

const result = await classifyConversations({
  client: SanityClient,
  model: LanguageModel,             // Any AI SDK compatible model
  concurrency?: number,             // Optional: parallel classifications (default 3)
  limit?: number,                   // Optional: max conversations per run (default 100)
  settledForMinutes?: number,       // Optional: idle time before a thread is classified (default 10)
  mcpEndpoint?: string,             // Optional: only conversations tagged with this endpoint name
})
// Returns: { successCount, errorCount, totalFound }
```

### Lower-level Primitives

For custom workflows, use the individual primitives directly:

- `getConversationsToClassify({client, limit?, settledForMinutes?, mcpEndpoint?})`: GROQ query for the pending classification queue (summaries only)
- `getPreviousContentGaps({client})`: GROQ query for known content gaps ranked by frequency
- `classifyConversation({client, threadId, model, previousContentGaps?, messages?})`: Classify a single conversation; fetches the transcript via the client when `messages` is omitted, and records the verdict or a `classificationError` through `client.context.conversations.classify`. Pass the `getPreviousContentGaps()` result as `previousContentGaps` so content gap names stay consistent across runs; `classifyConversations` does this for you

Reading conversations back uses the same organization-scoped client: `client.context.conversations.get({threadId})` returns one recorded conversation, or `null`. For lists and reports, query the organization's Context store with `client.context.fetch`:

```ts
const conversation = await client.context.conversations.get({threadId: 'thread-123'})

const recent = await client.context.fetch(
  '*[_type == "sanity.context.conversation"] | order(messagesUpdatedAt desc) [0...50]',
)
```
