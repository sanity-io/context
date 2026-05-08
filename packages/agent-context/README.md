# @sanity/agent-context

## Installation

```bash
npm install @sanity/agent-context
```

## Exports

| Entry point                      | Purpose                                   |
| -------------------------------- | ----------------------------------------- |
| `@sanity/agent-context/studio`   | Studio plugin and schema type constant    |
| `@sanity/agent-context/ai-sdk`   | AI SDK telemetry integration for Insights |
| `@sanity/agent-context/insights` | Lower-level APIs for custom workflows     |

## Studio Plugin

Registers a document type for configuring AI agent access to your Sanity content. Each document defines a content filter that scopes what an agent can query.

```ts
// sanity.config.ts
import {defineConfig} from 'sanity'
import {agentContextPlugin} from '@sanity/agent-context/studio'

export default defineConfig({
  // ...
  plugins: [agentContextPlugin()],
})
```

The plugin also exports `AGENT_CONTEXT_SCHEMA_TYPE_NAME` which can be used to configure where the document type appears in the Studio structure:

```ts
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {agentContextPlugin, AGENT_CONTEXT_SCHEMA_TYPE_NAME} from '@sanity/agent-context/studio'

export default defineConfig({
  // ...
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Content')
          .items([
            // Filter out agent context document from the default list
            ...S.documentTypeListItems().filter(
              (item) => item.getId() !== AGENT_CONTEXT_SCHEMA_TYPE_NAME,
            ),
            // Add it elsewhere, e.g. after a divider
            S.divider(),
            S.documentTypeListItem(AGENT_CONTEXT_SCHEMA_TYPE_NAME),
          ]),
    }),
    agentContextPlugin(),
  ],
})
```

## Agent Insights

Track and classify your AI agent conversations automatically. Insights captures every conversation, classifies it with AI (success score, sentiment, content gaps), and provides a Studio dashboard for analytics.

### Telemetry

Classification supports opt-in telemetry sharing with Sanity. There are two levels:

- **Metadata-only** (`shareMetrics: true`) — Shares classification metrics (scores, sentiment, content gap counts, message shapes, model/token info). No conversation content is included.
- **Full sharing** (`shareConversations: true`) — Also includes message contents. Implies `shareMetrics`. Want to help us improve Agent Context? Opt in and the team will be in touch to help dial in your agent.

```ts
telemetry: {
  shareMetrics: true,
  shareConversations: true,
  contact: 'you@company.com',
}
```

Both levels are off by default.

### 1. Enable the Plugin

Insights is enabled by default. To disable it:

```ts
agentContextPlugin({insights: {enabled: false}})
```

This registers the `sanity.agentContextConversation` schema and adds an "Agent Insights" dashboard to your Studio.

### 2. Add Telemetry

Connect your AI agent to save conversations automatically:

```ts
import {sanityInsightsIntegration} from '@sanity/agent-context/ai-sdk'
import {convertToModelMessages, streamText} from 'ai'
import {openai} from '@ai-sdk/openai'
import {createClient} from '@sanity/client'

const client = createClient({
  projectId: 'your-project-id',
  dataset: 'production',
  token: process.env.SANITY_WRITE_TOKEN, // Needs write access
  useCdn: false,
  apiVersion: '2026-01-01',
})

const result = await streamText({
  model: openai('gpt-4o'),
  // If using useChat, convert UIMessage[] to ModelMessage[] for streamText
  messages: await convertToModelMessages(messages),
  experimental_telemetry: {
    isEnabled: true,
    integrations: [
      sanityInsightsIntegration({
        client,
        agentId: 'support-agent',
        threadId: conversationId, // Any unique string (session ID, UUID, etc.)
      }),
    ],
  },
})
```

The integration requires a Sanity client with write permissions. Keep the token server-side only.

### 3. Set Up Classification

Classification requires a scheduled Sanity Function that analyzes conversations with AI. Create the function and blueprint at your **project root** (not in `studio/`):

1. Add dependencies to your root `package.json`:

```json
{
  "dependencies": {
    "@ai-sdk/anthropic": "^3",
    "@sanity/agent-context": "latest",
    "@sanity/client": "^7",
    "@sanity/functions": "^1",
    "ai": "^6"
  },
  "devDependencies": {
    "@sanity/blueprints": "^0.15.0",
    "dotenv": "^17"
  }
}
```

2. Create `functions/classify-conversations/index.ts` — see the [full example](https://github.com/sanity-io/agent-context/tree/main/examples/ecommerce/functions/classify-conversations/index.ts)

3. Create `sanity.blueprint.ts` — see the [full example](https://github.com/sanity-io/agent-context/tree/main/examples/ecommerce/sanity.blueprint.ts)

4. Deploy:

```bash
pnpm install
npx sanity login
npx sanity blueprints init
npx sanity blueprints promote
npx sanity functions test classify-conversations --with-user-token  # Test locally
npx sanity blueprints deploy
npx sanity functions env add classify-conversations ANTHROPIC_API_KEY <your-key>
```

### Metrics

Every classified conversation includes these standardized metrics:

| Metric         | Type                                    | Description                                  |
| -------------- | --------------------------------------- | -------------------------------------------- |
| `successScore` | `number` (1-10)                         | How well the agent resolved the user's needs |
| `sentiment`    | `'positive' \| 'neutral' \| 'negative'` | Overall user sentiment                       |
| `contentGaps`  | `string[]`                              | Topics where the agent lacked knowledge      |

### Insights API

The recommended way to classify conversations is with `classifyConversations`, which handles fetching, batching, and error handling in a single call:

```ts
import {classifyConversations} from '@sanity/agent-context/insights'

const result = await classifyConversations({
  client,
  model: anthropic('claude-haiku-4-5'),
  agentId: 'support-bot', // Optional: scope to a specific agent
  limit: 100, // Optional: max conversations per run
  concurrency: 5, // Optional: parallel classifications (default 3)
  cooldownMinutes: 15, // Optional: idle time before eligible (default 10)
  telemetry: {shareMetrics: true},
})

console.log(
  `${result.successCount} classified, ${result.errorCount} failed out of ${result.totalFound}`,
)
```

For custom workflows, use the lower-level primitives directly:

| Function                     | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `classifyConversations`      | **Recommended** — classify all eligible conversations |
| `classifyConversation`       | Classify a single conversation                        |
| `getConversationsToClassify` | Find conversations needing (re)classification         |
| `getPreviousContentGaps`     | Fetch content gaps ranked by frequency                |
| `saveConversation`           | Save a conversation without classification            |
| `generateConversationId`     | Generate deterministic ID from agentId + threadId     |

### Notes

- **Error handling** — Non-blocking by design. Save/classification failures are logged but don't break the user experience. Check logs for `[sanity-insights]` messages.
- **Concurrency** — Create a fresh `sanityInsightsIntegration()` instance per request. Do not share instances across concurrent requests.
- **Costs** — Classification runs in scheduled batches (every 10 minutes by default) to minimize token usage. Adjust schedule and batch size in your function handler.
