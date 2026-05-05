# Conversation Insights

Track and classify agent conversations using `@sanity/agent-context`. This enables analytics, debugging, and understanding how users interact with your agent.

> **Reference Implementation**: See [ecommerce/\_index.md](ecommerce/_index.md) for file navigation.

## Overview

The Insights system has two parts that work together:

1. **Telemetry Integration** — Saves conversations from your chat route
2. **Scheduled Classification** — Analyzes conversations with AI to extract insights

**Set up both parts.** Telemetry alone just stores raw conversations. Classification is what produces the dashboard with success scores, sentiment, and content gaps.

The `agentContextPlugin()` includes Insights by default (conversation schema and dashboard). No custom schema needed.

## Prerequisites

Before setting up insights, gather:

| Requirement           | Where used              | Notes                                                                                                                                    |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Sanity Project ID** | Both                    | From `sanity.config.ts` or [sanity.io/manage](https://sanity.io/manage)                                                                  |
| **Dataset name**      | Both                    | Usually `production`                                                                                                                     |
| **Write token**       | Telemetry (Step 1)      | For saving conversations to Sanity. Create at [sanity.io/manage](https://sanity.io/manage) → Project → API → Tokens with **Editor** role |
| **LLM API key**       | Classification (Step 3) | For the scheduled function that classifies conversations (Anthropic, OpenAI, etc.)                                                       |

**Note**: The classification function uses a **robot token** (created automatically by the blueprint) — you don't need to create a separate token for it.

## Project Structure

The recommended structure places `sanity.blueprint.ts` and `functions/` at the project root, alongside your lockfile. This ensures the CLI can detect your package manager and resolve dependencies correctly.

```
my-project/
├── sanity.blueprint.ts       # Blueprint config
├── functions/
│   └── classify-conversations/
│       └── index.ts
├── package.json              # Shared dependencies for functions
├── pnpm-lock.yaml            # (or yarn.lock, package-lock.json)
├── .env
├── studio/
└── app/
```

Functions use the root `package.json` for dependencies by default. See [Sanity Functions: Dependencies](https://www.sanity.io/docs/functions/function-dependencies) for alternative setups.

## Setup

### Step 1: Enable Telemetry in Your Chat Route

Add `sanityInsightsIntegration` to your `streamText` call. This saves conversations automatically.

```ts
import {sanityInsightsIntegration} from '@sanity/agent-context/ai-sdk'
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

**Write client**: Create a Sanity client with a token that has Editor permissions. Create the token at [sanity.io/manage](https://sanity.io/manage) → Project → API → Tokens with Editor role. Store it as `SANITY_API_WRITE_TOKEN` in your app's environment.

**Thread ID**: Each conversation needs a unique `threadId`. Generate one when a new chat starts and persist it across messages in that conversation. See [ecommerce/app/src/app/api/chat/route.ts](ecommerce/app/src/app/api/chat/route.ts) for how this is handled with cookies.

For client-side thread ID generation, use SSR-safe initialization to avoid hydration mismatches:

```tsx
const [threadId] = useState(() =>
  typeof window !== 'undefined' ? crypto.randomUUID() : ''
)
```

Then pass it to your chat API via request body or headers.

**Not using AI SDK?** The telemetry integration requires Vercel AI SDK. If using another library, use `saveConversation` directly:

```ts
import {saveConversation} from '@sanity/agent-context/insights'

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

### Step 2: Add Dependencies to Root package.json

Add these dependencies to your **root** `package.json` (not `studio/package.json`):

```json
{
  "dependencies": {
    "@ai-sdk/anthropic": "^3",
    "@sanity/agent-context": "latest",
    "@sanity/client": "^7",
    "@sanity/functions": "^1",
    "ai": "^6.0.137"  // Minimum version required for experimental_telemetry.integrations
  },
  "devDependencies": {
    "@sanity/blueprints": "^0.15.0",
    "dotenv": "^17"
  }
}
```

If using a different LLM provider, swap `@ai-sdk/anthropic` for your provider's package (e.g., `@ai-sdk/openai`).

### Step 3: Create the Classification Function

Create `functions/classify-conversations/index.ts` at your **project root**:

```ts
// functions/classify-conversations/index.ts
import {createClient} from '@sanity/client'
import {
  classifyConversation,
  getConversationsToClassify,
  getPreviousContentGaps,
} from '@sanity/agent-context/insights'
import {scheduledEventHandler} from '@sanity/functions'
import {anthropic} from '@ai-sdk/anthropic'
import {env} from 'node:process'

const CONCURRENCY = 5

export const handler = scheduledEventHandler(async ({context}) => {
  const {SANITY_PROJECT_ID, SANITY_DATASET} = env

  if (!context.clientOptions?.token) {
    console.error('[classify-conversations] No client token available')
    return
  }

  const client = createClient({
    projectId: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    apiVersion: '2026-01-01',
    token: context.clientOptions.token,
    useCdn: false,
  })

  const [conversations, previousContentGaps] = await Promise.all([
    getConversationsToClassify({client}),
    getPreviousContentGaps({client}),
  ])

  if (conversations.length === 0) {
    console.log('[classify-conversations] No conversations to classify')
    return
  }

  console.log(`[classify-conversations] Found ${conversations.length} conversations to classify`)

  let successCount = 0
  let errorCount = 0

  for (let i = 0; i < conversations.length; i += CONCURRENCY) {
    const batch = conversations.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async (conv) => {
        await classifyConversation({
          client,
          conversationId: conv._id,
          model: anthropic('claude-sonnet-4-5'),
          messages: conv.messages,
          modelProvider: conv.modelProvider,
          modelId: conv.modelId,
          tokenUsage: conv.tokenUsage,
          previousContentGaps,
          telemetry: {
            shareMetrics: true,
            // shareConversations: true,
            // contact: 'you@company.com',
          },
        })
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++
      } else {
        errorCount++
        console.error(`[classify-conversations] Failed to classify:`, result.reason)
      }
    }
  }

  console.log(`[classify-conversations] Completed: ${successCount} succeeded, ${errorCount} failed`)
})
```

### Step 4: Create the Blueprint

Create `sanity.blueprint.ts` at your **project root**:

```ts
// sanity.blueprint.ts (project root - NOT in studio/)
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

**Important**: The `resourceId` in `defineRobotToken` must be your actual project ID. Using `process.env.SANITY_STUDIO_PROJECT_ID` reads it from your `.env` file at deploy time.

### Step 5: Configure Environment Variables

Create or update `.env` at your project root:

```bash
# Required for blueprint deployment
SANITY_STUDIO_PROJECT_ID=your-project-id
SANITY_STUDIO_DATASET=production

# Required for classification function
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 6: Test Locally

Before deploying, test the function locally to verify everything works:

```bash
npx sanity functions test classify-conversations --with-user-token
```

The `--with-user-token` flag provides your personal token for API calls. The function reads `ANTHROPIC_API_KEY` from your `.env` file.

**Note**: Local testing runs against your real dataset — conversations will actually be classified. Only conversations that have been idle for at least 10 minutes are eligible for classification (to avoid classifying active conversations).

### Step 7: Deploy

Run all commands from your **project root** (where `sanity.blueprint.ts` and your lockfile are located).

**Prerequisites**: Make sure you're logged in to the Sanity CLI. Run `npx sanity login` if needed.

```bash
# 1. Install dependencies
pnpm install   # or npm install / yarn

# 2. Initialize the blueprint stack (first time only)
npx sanity blueprints init

# 3. Promote to organization scope (required for scheduled functions)
npx sanity blueprints promote

# 4. Deploy the blueprint and function (ask for permission to deploy)
npx sanity blueprints deploy

# 5. Set the API key as an environment variable (after deploy)
npx sanity functions env add classify-conversations ANTHROPIC_API_KEY <your-api-key>
```

**What these commands do:**

- **`blueprints init`**: Links your project to a Sanity blueprint stack. Run once per project.
- **`blueprints promote`**: Elevates the stack to organization scope, which is required for scheduled functions. You need organization member permissions to run this.
- **`blueprints deploy`**: Deploys the function and schedules it to run.
- **`functions env add`**: Sets an environment variable for a deployed function. Must be run after deploy. Replace `<your-api-key>` with your actual API key.

**Package manager**: The CLI detects your package manager from the lockfile. If it can't detect it, pass `--fn-installer pnpm` (or `npm`/`yarn`) to the deploy command.

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

The `telemetry` option on `classifyConversation` lets you share classification data with the Sanity team to help improve Agent Context. **This is fully opt-in and off by default.**

There are two tiers:

**Metadata-only** (`shareMetrics: true`): Shares classification metrics (success scores, sentiment, content gap counts), message shapes (roles, byte sizes, tool names), model info, and token usage. No conversation content is transmitted — we cannot see what your users or agent said.

**Full conversation sharing** (`shareConversations: true`): Additionally shares the actual message contents. This lets the Sanity team analyze real conversations to identify patterns, suggest improvements to your agent configuration, and help you get better results. Provide a `contact` so the team can reach out and collaborate with you directly.

If you can, enabling metadata-only telemetry helps us prioritize improvements. If you want hands-on help tuning your agent, enable full sharing and the team will be in touch.

## Troubleshooting

### Function not running

- Did you run `npx sanity blueprints promote`? Scheduled functions require org-level scope.
- Check logs: `npx sanity functions logs classify-conversations`

### "No client token available"

The robot token isn't configured correctly. Verify:

- `robotToken` in the blueprint matches the robot token resource name
- The `resourceId` in `defineRobotToken` is your actual project ID

### Environment variables not found

- Blueprint reads env vars at **deploy time** from your local `.env`
- Function reads env vars at **runtime** from what was passed via `env: {}` in the blueprint
- Make sure `.env` exists and has the required values before deploying

### Classification not finding conversations

- Conversations need at least 10 minutes of idle time before classification
- Check that telemetry is saving conversations: look for `sanity.agentContextConversation` documents in Studio

## Insights API Reference

### `sanityInsightsIntegration`

```ts
import {sanityInsightsIntegration} from '@sanity/agent-context/ai-sdk'

sanityInsightsIntegration({
  client: SanityClient, // Write client (Editor permissions)
  agentId: string | (() => string), // Agent identifier
  threadId: string | (() => string), // Thread identifier
})
```

### `getConversationsToClassify`

```ts
import {getConversationsToClassify} from '@sanity/agent-context/insights'

const conversations = await getConversationsToClassify({
  client: SanityClient,
  agentId?: string,    // Optional: filter by agent
  limit?: number,      // Optional: max results
})
// Each conversation includes: _id, agentId, threadId, messages,
// modelProvider?, modelId?, tokenUsage?
```

### `getPreviousContentGaps`

Fetches previously identified content gaps, ranked by frequency. Pass the result to `classifyConversation` to encourage consistent terminology:

```ts
import {getPreviousContentGaps} from '@sanity/agent-context/insights'

const previousContentGaps = await getPreviousContentGaps({
  client: SanityClient,
  maxAgeDays?: number,    // Optional: only include gaps from last N days (default 30)
  limit?: number,         // Optional: max gaps to return (default 50)
  agentId?: string,       // Optional: filter by agent
})
// Returns: string[]
```

### `classifyConversation`

```ts
import {classifyConversation} from '@sanity/agent-context/insights'

await classifyConversation({
  client: SanityClient,
  conversationId: string,
  model: LanguageModel,             // Any AI SDK compatible model
  messages: Message[],              // Conversation messages to classify
  modelProvider?: string,           // LLM provider (for telemetry)
  modelId?: string,                 // Model ID (for telemetry)
  tokenUsage?: {                    // Token usage stats (for telemetry)
    inputTokens?: number,
    outputTokens?: number,
    totalTokens?: number,
  },
  previousContentGaps?: string[],   // From getPreviousContentGaps
  telemetry: {
    shareMetrics: true,             // Share metadata-only metrics with Sanity
    // shareConversations: true,    // Also share full message contents
    // contact: 'you@company.com',  // So we can reach you
  },
})
```

## Opting Out

If you don't need Insights, disable it in the plugin:

```ts
agentContextPlugin({insights: {enabled: false}})
```

This removes the conversation schema and dashboard from your Studio.
