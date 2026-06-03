# Conversation Insights

Track and classify agent conversations using `@sanity/context`. This enables analytics, debugging, and understanding how users interact with your agent.

> **Reference Implementation**: See [ecommerce/\_index.md](ecommerce/_index.md) for file navigation.

## Overview

The Insights system has two parts that work together:

1. **Telemetry Integration** — Saves conversations from your chat route
2. **Scheduled Classification** — Analyzes conversations with AI to extract insights

**Set up both parts.** Telemetry alone just stores raw conversations. Classification is what produces the dashboard with success scores, sentiment, and content gaps.

The `contextPlugin()` includes Insights by default (conversation schema and dashboard). No custom schema needed.

## Prerequisites

Before setting up insights, gather:

| Requirement           | Where used              | Notes                                                                                                                                    |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Sanity Project ID** | Both                    | From `sanity.config.ts` or [sanity.io/manage](https://sanity.io/manage)                                                                  |
| **Dataset name**      | Both                    | Usually `production`                                                                                                                     |
| **Write token**       | Telemetry (Step 1)      | For saving `sanity.agentContextConversation` documents. Use an existing write token if the project has one, or create one at [sanity.io/manage](https://sanity.io/manage) → Project → API → Tokens with **Editor** role |
| **LLM API key**       | Classification (Step 3) | For the scheduled function that classifies conversations (Anthropic, OpenAI, etc.)                                                       |

**Note**: The classification function uses a **robot token** (created automatically by the blueprint) — you don't need to create a separate token for it.

## Project Structure

**First, check if the project already has a `sanity.blueprint.ts`** — search the full repo. If one exists with deployed functions, add the classification function there. Do not create a second blueprint.

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

In a **flat project**, the layout is the same — everything at the root:

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

These are reference layouts for new blueprints — always adapt to the user's existing directory structure. If a blueprint already exists elsewhere, use that location instead. If the project has multiple blueprint stacks in a subdirectory pattern (e.g. `apps/blueprints/studio/`, `apps/blueprints/web/`), create a new stack following the same convention.

## Setup

### Step 1: Enable Telemetry in Your Chat Route

Add `sanityInsightsIntegration` to your `streamText` call. This saves conversations automatically.

```ts
import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'
import {streamText} from 'ai'

const result = streamText({
  model: anthropic('claude-sonnet-4-5'),
  messages,
  experimental_telemetry: {
    isEnabled: true,
    integrations: [
      sanityInsightsIntegration({
        client: writeClient, // Sanity client with Editor permissions
        agentId: 'my-agent', // Name/ID for grouping conversations
        threadId: chatId, // Unique conversation thread ID
      }),
    ],
  },
})
```

**Write client**: Requires a Sanity client with a token that has Editor permissions. Ask the user if they already have a write token in their environment — many projects do (e.g. `ADMIN_STUDIO_WRITE_TOKEN`, `SANITY_API_WRITE_TOKEN`). If not, create one at [sanity.io/manage](https://sanity.io/manage) → Project → API → Tokens with Editor role.

**Thread ID**: Each conversation needs a unique `threadId`. Generate one when a new chat starts and persist it across messages in that conversation. How it reaches the server depends on the setup:

- **AI SDK `useChat`**: The hook sends `id` (the chat ID) in the request body automatically. Extract it in your route handler and use it as `threadId`.
- **Custom transport**: Pass the thread ID via request body, headers, or cookies — whatever fits the app's architecture.

See [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts) for how this is handled with cookies.

For client-side thread ID generation, use SSR-safe initialization to avoid hydration mismatches:

```tsx
const [threadId] = useState(() =>
  typeof window !== 'undefined' ? crypto.randomUUID() : ''
)
```

Then pass it to your chat API via request body or headers.

**Not using AI SDK?** The telemetry integration requires Vercel AI SDK. If using another library, use `saveConversation` directly:

```ts
import {saveConversation} from '@sanity/context/insights'

// Call this after each conversation turn completes
await saveConversation({
  client: writeClient,
  agentId: 'my-agent',
  threadId: chatId,
  messages: [
    {role: 'user', content: 'How do I return an item?'},
    {role: 'assistant', content: 'You can return items within 30 days...'},
    // Include full conversation history each call — it upserts the document
  ],
  modelProvider: 'anthropic',
  modelId: 'claude-sonnet-4-5',
  tokenUsage: {inputTokens: 1200, outputTokens: 350, totalTokens: 1550},
})
```

The function generates a deterministic document ID from `agentId` + `threadId`, so repeated calls update the same document. See the Insights API Reference below for full API details.

---

**Steps 2-7 below set up the classification function** — a separate scheduled job that analyzes saved conversations. This runs outside your app using Sanity Functions.

### Step 2: Add Dependencies

Ensure these packages are in the `package.json` next to `sanity.blueprint.ts` — merge them into existing dependencies, do not overwrite the file:

**dependencies**: `@ai-sdk/anthropic` (^3), `@sanity/context` (latest), `@sanity/client` (^7), `@sanity/functions` (^1), `ai` (^6.0.175 minimum — required for `experimental_telemetry.integrations`)

**devDependencies**: `@sanity/blueprints` (latest), `dotenv` (^17)

If using a different LLM provider, swap `@ai-sdk/anthropic` for your provider's package (e.g., `@ai-sdk/openai`).

### Step 3: Create the Classification Function

Create `functions/classify-conversations/index.ts` next to `sanity.blueprint.ts`:

```ts
// functions/classify-conversations/index.ts
import {createClient} from '@sanity/client'
import {classifyConversations} from '@sanity/context/insights'
import {scheduledEventHandler} from '@sanity/functions'
import {anthropic} from '@ai-sdk/anthropic'

export const handler = scheduledEventHandler(async ({context}) => {
  if (!context.clientOptions?.token) {
    console.error('[classify-conversations] No client token available')
    return
  }

  // SANITY_PROJECT_ID and SANITY_DATASET are injected by the blueprint's env block.
  // These are example names — adapt to match the user's env var conventions.
  const client = createClient({
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_DATASET,
    apiVersion: '2026-01-01',
    token: context.clientOptions.token,
    useCdn: false,
  })

  const result = await classifyConversations({
    client,
    model: anthropic('claude-sonnet-4-5'),
    telemetry: {
      shareMetrics: true,
      // shareConversations: true,
      // contact: 'you@company.com',
    },
  })

  console.log(
    `Classified ${result.successCount}/${result.totalFound} conversations${result.errorCount > 0 ? ` (${result.errorCount} failed)` : ''}`,
  )
})
```

### Step 4: Configure the Blueprint

If `sanity.blueprint.ts` already exists, add the scheduled function and robot token resources to it. Otherwise, create it:

```ts
// sanity.blueprint.ts
import {defineBlueprint, defineRobotToken, defineScheduledFunction} from '@sanity/blueprints'
import 'dotenv/config'

export default defineBlueprint({
  resources: [
    defineScheduledFunction({
      name: 'classify-conversations',
      timeout: 600,
      robotToken: '$.resources.classify-conversations-robot.token',
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        SANITY_PROJECT_ID: process.env.SANITY_STUDIO_PROJECT_ID,
        SANITY_DATASET: process.env.SANITY_STUDIO_DATASET,
      },
      event: {
        expression: '*/10 * * * *', // Every 10 minutes
      },
    }),
    defineRobotToken({
      name: 'classify-conversations-robot',
      label: 'Classify Conversations Robot',
      memberships: [
        {
          resourceType: 'project',
          resourceId: process.env.SANITY_STUDIO_PROJECT_ID!,
          roleNames: ['editor'],
        },
      ],
    }),
  ],
})
```

**How this works**: The `env` block reads from your local `.env` at deploy time and injects the values into the function's `process.env` at runtime. The robot token provides only the auth token — scheduled functions need projectId and dataset via env vars. The env var names on the left (`SANITY_PROJECT_ID`) are what the function reads; the names on the right (`SANITY_STUDIO_PROJECT_ID`) are what your `.env` file uses. Ask the user for the correct `.env` var names in their project.

**Robot token role**: The robot token must have `editor` role — classification writes results back to conversation documents. Using `viewer` will cause silent write failures.

### Step 5: Configure Environment Variables

The function needs three values at runtime: project ID, dataset, and an LLM API key.

**Project ID and dataset** are passed via the blueprint's `env` block (Step 4). The blueprint reads from your `.env` at deploy time. Create or update `.env` next to `sanity.blueprint.ts` — ask the user what env var names their project uses:

```bash
# Example — use the env var names from the project's existing .env
SANITY_STUDIO_PROJECT_ID=your-project-id
SANITY_STUDIO_DATASET=production
ANTHROPIC_API_KEY=sk-ant-...
```

**LLM API key** is also in the `env` block, so it's read from `.env` at deploy time. You can alternatively set it after deploying (Step 7) via `npx sanity functions env add` — useful if you don't want secrets in `.env` or are deploying from CI.

### Step 6: Test Locally

Before deploying, verify the full pipeline works:

1. **Conversations are saved**: Check Studio for `sanity.agentContextConversation` documents (send a few messages to your agent first)
2. **Insights tool is visible**: Open Studio and confirm the Agent Insights tool appears in the topbar
3. **Classification runs**: Execute the function locally:

```bash
npx sanity functions test classify-conversations --with-user-token
```

The `--with-user-token` flag injects your personal token into `context.clientOptions` — this is the same path the robot token uses in production. The function reads `ANTHROPIC_API_KEY` from the `.env` file next to `sanity.blueprint.ts`.

**Note**: Local testing runs against your real dataset — conversations will actually be classified. Only conversations that have been idle for at least 10 minutes are eligible for classification (to avoid classifying active conversations).

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
- **`blueprints doctor`**: Checks blueprint health — flags dependency issues, version mismatches, and directory structure problems.
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
- **On request finish**: Combines with response messages and saves to Sanity

Conversations are saved as `sanity.agentContextConversation` documents (provided by the plugin).

### Classification

The `getConversationsToClassify` primitive finds conversations that:

- Have never been classified (`classifiedAt` not set)
- Have been updated since last classification (`_updatedAt > classifiedAt`)
- Have been idle for at least 10 minutes to avoid classifying active conversations

The `classifyConversation` primitive:

1. Sends messages to an LLM with a classification prompt
2. Extracts metrics: success score, sentiment, content gaps
3. Updates the conversation document with results

### Telemetry

The `telemetry` option on `classifyConversation` lets you share classification data with the Sanity team to help improve Sanity Context. **This is fully opt-in and off by default.**

There are two tiers:

**Metadata-only** (`shareMetrics: true`): Shares classification metrics (success scores, sentiment, content gap counts), message shapes (roles, byte sizes, tool names), model info, and token usage. No conversation content is transmitted — we cannot see what your users or agent said.

**Full conversation sharing** (`shareConversations: true`): Additionally shares the actual message contents. This lets the Sanity team analyze real conversations to identify patterns, suggest improvements to your agent configuration, and help you get better results. Provide a `contact` so the team can reach out and collaborate with you directly.

If you can, enabling metadata-only telemetry helps us prioritize improvements. If you want hands-on help tuning your agent, enable full sharing and the team will be in touch.

## Troubleshooting

### Function not running

- Did you run `npx sanity blueprints promote`? Scheduled functions require org-level scope.
- Check logs: `npx sanity functions logs classify-conversations`

### "No client token available"

**In production**: The robot token isn't configured correctly. Verify:

- `robotToken` in the blueprint matches the robot token resource name (e.g. `$.resources.classify-conversations-robot.token`)
- The `resourceId` in `defineRobotToken` is your actual project ID

**During local testing**: Run with `--with-user-token` to inject your personal token into `context.clientOptions`.

### Classification not finding conversations

- Conversations need at least 10 minutes of idle time before classification
- Check that telemetry is saving conversations: look for `sanity.agentContextConversation` documents in Studio

## Insights API Reference

### `sanityInsightsIntegration`

```ts
import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'

sanityInsightsIntegration({
  client: SanityClient, // Write client (Editor permissions)
  agentId: string | (() => string), // Agent identifier
  threadId: string | (() => string), // Thread identifier
})
```

### `classifyConversations`

The recommended way to classify conversations. Handles fetching, batching, and error handling in a single call:

```ts
import {classifyConversations} from '@sanity/context/insights'

const result = await classifyConversations({
  client: SanityClient,
  model: LanguageModel,             // Any AI SDK compatible model
  telemetry?: TelemetryConfig,      // Optional: share metrics with Sanity
  agentId?: string,                 // Optional: filter by agent
  limit?: number,                   // Optional: max conversations to process
  cooldownMinutes?: number,         // Optional: idle time before eligibility (default 10)
  concurrency?: number,             // Optional: parallel classifications (default 5)
})
// Returns: { successCount, errorCount, totalFound }
```

### Lower-level Primitives

For custom workflows, use the individual primitives directly:

- `getConversationsToClassify({client, agentId?, limit?, cooldownMinutes?})` — Find conversations needing classification
- `getPreviousContentGaps({client, agentId?, maxAgeDays?, limit?})` — Fetch content gaps ranked by frequency
- `classifyConversation({client, conversationId, model, messages, ...})` — Classify a single conversation

```ts
import {classifyConversation, getConversationsToClassify, getPreviousContentGaps} from '@sanity/context/insights'
```

## Opting Out

If you don't need Insights, disable it in the plugin:

```ts
contextPlugin({insights: {enabled: false}})
```

This removes the conversation schema and dashboard from your Studio.
