# Conversation Insights

Track and classify agent conversations using `@sanity/context`. This enables analytics, debugging, and understanding how users interact with your agent.

> **Reference Implementation**: See [ecommerce/\_index.md](ecommerce/_index.md) for file navigation.

## Overview

The Insights system has two parts that work together:

1. **Telemetry Integration**: Saves conversation transcripts from your chat route to your organization's Context store
2. **Scheduled Classification**: Analyzes conversations with your own AI SDK model and records verdicts through the Context API

**Set up both parts.** Telemetry alone just stores raw conversations. Classification is what produces the dashboard with success scores, sentiment, and content gaps.

Both parts ride on `@sanity/client` (^8.4.0) and its `client.context` namespace. The pending queue is a GROQ query over the org's Context document store: conversations that were never classified, have no recorded failure, are non-empty, and have been idle for `settledForMinutes` (default 10, and you own the setting). Classification itself runs on your side, with your model and your LLM API key.

## Prerequisites

Before setting up insights, gather:

| Requirement                | Where used              | Notes                                                                                                                      |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Sanity organization ID** | Both                    | From [sanity.io/manage](https://sanity.io/manage), the organization that owns the Context endpoint                          |
| **MCP endpoint name**      | Both                    | The last path segment of the MCP URL (from the Sanity Context plugin in Studio)                                            |
| **Sanity API token**       | Both                    | Authenticates the Sanity client. Keep it server-side only                                                                  |
| **LLM API key**            | Classification (Step 3) | For the scheduled function that classifies conversations (Anthropic, OpenAI, etc.)                                         |

## Project Structure

**First, check if the project already has a `sanity.blueprint.ts`**: search the full repo. If one exists with deployed functions, add the classification function there. Do not create a second blueprint.

If no blueprint exists, create one following the [placement rules in SKILL.md](../SKILL.md#sanity-blueprints--functions). The default placement is next to the project's lockfile.

If creating a new blueprint in a **monorepo**, the default placement is the workspace root (next to the lockfile):

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

In a **flat project**, the layout is the same, with everything at the root:

```
my-project/
├── sanity.blueprint.ts
├── functions/
│   └── classify-conversations/
│       └── index.ts
├── package.json
├── pnpm-lock.yaml
├── .env
├── studio/
└── app/
```

These are reference layouts for new blueprints, so always adapt to the user's existing directory structure. If a blueprint already exists elsewhere, use that location instead. If the project has multiple blueprint stacks in a subdirectory pattern (e.g. `apps/blueprints/studio/`, `apps/blueprints/web/`), create a new stack following the same convention.

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
  token: process.env.SANITY_API_TOKEN,
  context: {organizationId: process.env.SANITY_ORGANIZATION_ID},
  useCdn: false,
  useProjectHostname: false,
})

const result = streamText({
  model: anthropic('claude-sonnet-4-5'),
  messages,
  experimental_telemetry: {
    isEnabled: true,
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

**Token**: The client authenticates with a Sanity API token that can write to the organization's Context store (a read-only Viewer token covers MCP queries but not conversation writes). Ask the user if they already have one in their environment; many projects do (e.g. `SANITY_API_TOKEN`). Keep it server-side only.

**Thread ID**: Each conversation needs a unique `threadId`. Generate one when a new chat starts and persist it across messages in that conversation. How it reaches the server depends on the setup:

- **AI SDK `useChat`**: The hook sends `id` (the chat ID) in the request body automatically. Extract it in your route handler and use it as `threadId`.
- **Custom transport**: Pass the thread ID via request body, headers, or cookies, whatever fits the app's architecture.

See [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts) for how this is handled with cookies.

For client-side thread ID generation, use SSR-safe initialization to avoid hydration mismatches:

```tsx
const [threadId] = useState(() =>
  typeof window !== 'undefined' ? crypto.randomUUID() : ''
)
```

Then pass it to your chat API via request body or headers.

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

**dependencies**: `@ai-sdk/anthropic` (^3), `@sanity/client` (^8.4.0), `@sanity/context` (latest), `@sanity/functions` (^1), `ai` (^6.0.175 minimum, required for `experimental_telemetry.integrations`)

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
  const {SANITY_ORGANIZATION_ID, SANITY_CONTEXT_ENDPOINT_NAME, SANITY_API_TOKEN} = process.env

  if (!SANITY_ORGANIZATION_ID || !SANITY_CONTEXT_ENDPOINT_NAME || !SANITY_API_TOKEN) {
    console.error(
      '[classify-conversations] Missing SANITY_ORGANIZATION_ID, SANITY_CONTEXT_ENDPOINT_NAME, or SANITY_API_TOKEN',
    )
    return
  }

  const client = createClient({
    apiVersion: 'v2025-11-27',
    token: SANITY_API_TOKEN,
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

export default defineBlueprint({
  resources: [
    defineScheduledFunction({
      name: 'classify-conversations',
      timeout: 600,
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        SANITY_ORGANIZATION_ID: process.env.SANITY_ORGANIZATION_ID,
        SANITY_CONTEXT_ENDPOINT_NAME: process.env.SANITY_CONTEXT_ENDPOINT_NAME,
        SANITY_API_TOKEN: process.env.SANITY_API_TOKEN,
      },
      event: {
        expression: '*/10 * * * *', // Every 10 minutes
      },
    }),
  ],
})
```

**How this works**: The `env` block reads from your local `.env` at deploy time and injects the values into the function's `process.env` at runtime. The env var names on the left are what the function reads; the names on the right are what your `.env` file uses. Ask the user for the correct `.env` var names in their project.

### Step 5: Configure Environment Variables

The function needs four values at runtime: organization ID, endpoint name, a Sanity API token, and an LLM API key.

All four are passed via the blueprint's `env` block (Step 4). The blueprint reads from your `.env` at deploy time. Create or update `.env` next to `sanity.blueprint.ts` and ask the user what env var names their project uses:

```bash
# Example: use the env var names from the project's existing .env
SANITY_ORGANIZATION_ID=your-org-id
SANITY_CONTEXT_ENDPOINT_NAME=my-agent
SANITY_API_TOKEN=sk...
ANTHROPIC_API_KEY=sk-ant-...
```

**LLM API key**: You can alternatively set it after deploying (Step 7) via `npx sanity functions env add`, useful if you don't want secrets in `.env` or are deploying from CI.

### Step 6: Test Locally

Before deploying, verify the full pipeline works:

1. **Conversations are saved**: Check the Context dashboard for conversations (send a few messages to your agent first)
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

# 6. Set the API key as an environment variable (after deploy)
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

## How It Works

### Conversation Saving

The `sanityInsightsIntegration` hooks into AI SDK's telemetry system:

- **On request start**: Captures input messages
- **On request finish**: Combines with response messages and saves the transcript via `client.context.conversations.save`

Each save is an idempotent upsert per thread, scoped to the client's organization.

### Classification

The `getConversationsToClassify` primitive queries the pending queue with GROQ via `client.context.fetch`. A conversation is pending when it:

- Has never been classified
- Has no recorded classification failure
- Is non-empty
- Has been idle for `settledForMinutes` (default 10, caller-owned)

Results are ordered oldest first and returned as summaries (no transcript). Pass `mcpEndpoint` to narrow to conversations tagged with that endpoint name.

The `classifyConversation` primitive:

1. Fetches the full transcript via the client (unless messages are provided)
2. Sends the messages to your LLM with a classification prompt
3. Records the verdict (success score, sentiment, content gaps) through `client.context.conversations.classify`

If classification fails, the error is recorded on the conversation as `classificationError`, which removes it from the pending queue, and the error is re-thrown.

Previously identified content gaps are fed back into the prompt so the model reuses consistent gap terminology across runs.

## Troubleshooting

### Function not running

- Did you run `npx sanity blueprints promote`? Scheduled functions require org-level scope.
- Check logs: `npx sanity functions logs classify-conversations`

### 401 errors from the Context API

The Sanity API token is missing or invalid. Verify `SANITY_API_TOKEN` is set in the function's env (check the blueprint's `env` block and your `.env`).

### 404 errors from the Context API

The organization ID or thread ID doesn't resolve. Verify `SANITY_ORGANIZATION_ID` matches the organization that owns the Context endpoint, and that the client is created with `context: {organizationId}`.

### Classification not finding conversations

- Conversations need to sit idle for `settledForMinutes` (default 10) before they enter the pending queue
- If you pass `mcpEndpoint`, only conversations tagged with that name via `metadata.mcpEndpoints` qualify
- Conversations with a recorded classification failure are not retried; check the dashboard for errors
- Check that telemetry is saving conversations: look for them in the Context dashboard

## Insights API Reference

Every function takes `{client}`: a `@sanity/client` (^8.4.0) created with `createClient({apiVersion: 'v2025-11-27', token, context: {organizationId}, useCdn: false, useProjectHostname: false})`. For staging, add `apiHost: 'https://api.sanity.work'` to the client config.

### `sanityInsightsIntegration`

```ts
import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'

sanityInsightsIntegration({
  client: SanityClient, // Org-scoped client with a server-side token
  threadId: string | (() => string), // Thread identifier
  metadata?: Record<string, string | string[]>, // Dimensions recorded on the conversation;
  // the well-known mcpEndpoints key tags it with an MCP endpoint name
})
```

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
- `classifyConversation({client, threadId, model, previousContentGaps?, messages?})`: Classify a single conversation; fetches the transcript via the client when `messages` is omitted, and records the verdict or a `classificationError` through `client.context.conversations.classify`

```ts
import {classifyConversation, getConversationsToClassify, getPreviousContentGaps} from '@sanity/context/insights'
```

Saving a transcript is `client.context.conversations.save({threadId, messages, metadata?, modelProvider?, modelId?, tokenUsage?})` from `@sanity/client` directly. Reading conversations back for dashboards or reports is plain GROQ:

```ts
await client.context.fetch(
  '*[_type == "sanity.context.conversation"] | order(messagesUpdatedAt desc) [0...50]',
)
```
