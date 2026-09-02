# @sanity/context

## Installation

```bash
npm install @sanity/context
```

### Compatibility

Requires `@sanity/client` ^8.4.0 as a peer dependency, which comes automatically with `sanity` 6.12 or later.

## Exports

| Entry point                | Purpose                                   |
| -------------------------- | ----------------------------------------- |
| `@sanity/context/studio`   | Studio plugin and schema type constant    |
| `@sanity/context/ai-sdk`   | AI SDK telemetry integration for Insights |
| `@sanity/context/insights` | Lower-level APIs for custom workflows     |

## Studio Plugin

> **Deprecated:** Context configuration has moved to the Context app in the Sanity Dashboard. The plugin still registers the document type so existing MCP context documents can be edited, but new setups should use the Context app. See the [migration guide](https://www.sanity.io/docs/ai/context-migration-guide).

Registers a document type for configuring AI agent access to your Sanity content. Each document defines a content filter that scopes what an agent can query.

```ts
// sanity.config.ts
import {defineConfig} from 'sanity'
import {contextPlugin} from '@sanity/context/studio'

export default defineConfig({
  // ...
  plugins: [contextPlugin()],
})
```

The plugin also exports `CONTEXT_SCHEMA_TYPE_NAME` which can be used to configure where the document type appears in the Studio structure:

```ts
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {contextPlugin, CONTEXT_SCHEMA_TYPE_NAME} from '@sanity/context/studio'

export default defineConfig({
  // ...
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Content')
          .items([
            // Filter out the Sanity Context document from the default list
            ...S.documentTypeListItems().filter(
              (item) => item.getId() !== CONTEXT_SCHEMA_TYPE_NAME,
            ),
            // Add it elsewhere, e.g. after a divider
            S.divider(),
            S.documentTypeListItem(CONTEXT_SCHEMA_TYPE_NAME),
          ]),
    }),
    contextPlugin(),
  ],
})
```

## Agent Insights

Track and classify your AI agent conversations automatically. Insights saves every conversation transcript to your organization's Context store, and a classification step you run with your own AI SDK model extracts success scores, sentiment, and content gaps. Results are surfaced in the Context dashboard.

Everything rides on `@sanity/client` (^8.4.0) and its `client.context` namespace. Create one org-scoped client and pass it to the telemetry integration and the insights functions:

```ts
import {createClient} from '@sanity/client'

const client = createClient({
  apiVersion: 'v2025-11-27',
  token: process.env.SANITY_API_TOKEN, // Keep server-side only
  context: {organizationId: process.env.SANITY_ORGANIZATION_ID},
  useCdn: false,
  useProjectHostname: false,
})
```

### Add Telemetry

Connect your AI agent to save conversations automatically:

```ts
import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'
import {convertToModelMessages, streamText} from 'ai'
import {openai} from '@ai-sdk/openai'

const result = await streamText({
  model: openai('gpt-4o'),
  // If using useChat, convert UIMessage[] to ModelMessage[] for streamText
  messages: await convertToModelMessages(messages),
  experimental_telemetry: {
    isEnabled: true,
    integrations: [
      sanityInsightsIntegration({
        client,
        threadId: conversationId, // Any unique string (session ID, UUID, etc.)
        // The well-known mcpEndpoints key tags the conversation with an MCP endpoint name
        metadata: {mcpEndpoints: process.env.SANITY_CONTEXT_ENDPOINT_NAME ?? []},
        // Optional: share telemetry with Sanity to help improve Context.
        // {metrics: true} shares metadata-only metrics; {conversations: true}
        // shares full transcripts (implies metrics); add a contact so the
        // team can reach you.
        sharing: {metrics: true},
      }),
    ],
  },
})
```

Each save is an idempotent upsert per thread: the messages replace the stored transcript wholesale, so repeated saves with the same `threadId` keep the transcript current.

### Set Up Classification

Classification runs on your side, with your model and your LLM API key. The pending queue is a query over your org's Context document store: conversations with messages, no verdict, no recorded failure, and idle long enough to be considered settled. Run `classifyConversations` on a schedule, for example as a scheduled Sanity Function:

1. Create `functions/classify-conversations/index.ts`, see the [full example](https://github.com/sanity-io/context/tree/main/examples/ecommerce/functions/classify-conversations/index.ts)

2. Create `sanity.blueprint.ts`, see the [full example](https://github.com/sanity-io/context/tree/main/examples/ecommerce/sanity.blueprint.ts)

   Requirements:
   - Install `@sanity/functions`, `@ai-sdk/anthropic`, `@sanity/blueprints`, and `dotenv` alongside `@sanity/client` and `@sanity/context`
   - Create a `.env` next to the blueprint with `ANTHROPIC_API_KEY`, `SANITY_ORGANIZATION_ID`, `SANITY_CONTEXT_ENDPOINT_NAME`, and `SANITY_API_TOKEN`

3. Deploy:

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
import {classifyConversations} from '@sanity/context/insights'
import {anthropic} from '@ai-sdk/anthropic'

const result = await classifyConversations({
  client,
  model: anthropic('claude-haiku-4-5'),
  mcpEndpoint: process.env.SANITY_CONTEXT_ENDPOINT_NAME, // Optional: only this endpoint's conversations
  limit: 100, // Optional: max conversations per run (default 100)
  concurrency: 5, // Optional: parallel classifications (default 3)
  settledForMinutes: 10, // Optional: idle time before a thread is classified (default 10)
})

console.log(
  `${result.successCount} classified, ${result.errorCount} failed out of ${result.totalFound}`,
)
```

For custom workflows, use the lower-level primitives directly:

| Function                     | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `classifyConversations`      | **Recommended**: classify all pending conversations |
| `classifyConversation`       | Classify a single conversation by thread ID         |
| `getConversationsToClassify` | Query the pending classification queue (GROQ)       |
| `getPreviousContentGaps`     | Query known content gaps ranked by frequency        |

All take the same `{client}` option. Saving a transcript without the AI SDK integration is `client.context.conversations.save` from `@sanity/client` directly:

```ts
await client.context.conversations.save({
  threadId: 'thread-123',
  messages: [
    {role: 'user', content: 'Hello!'},
    {role: 'assistant', content: 'Hi there! How can I help?'},
  ],
  metadata: {mcpEndpoints: 'support-agent'},
})
```

Reading conversations back for dashboards or reports is plain GROQ over the org's Context document store:

```ts
const recent = await client.context.fetch(
  '*[_type == "sanity.context.conversation"] | order(messagesUpdatedAt desc) [0...50]',
)
```

### Notes

- **Error handling**: Non-blocking by design. Save and classification failures are logged but don't break the user experience. Save failures log `[sanity-insights]` messages; classification failures log `[classifyConversation]` messages. A failed classification records the error on the conversation, which removes it from the pending queue.
- **Concurrency**: Create a fresh `sanityInsightsIntegration()` instance per request. Do not share instances across concurrent requests.
- **Cooldown**: Conversations become eligible for classification only after they have been idle for `settledForMinutes` (default 10). You own this setting; tune it to how long your threads stay active.
- **Costs**: Classification runs in scheduled batches (every 10 minutes in the example) with your own LLM key. Adjust the schedule and `limit` to control token usage.
- **Staging**: Configure the client with `apiHost: 'https://api.sanity.work'` to target the staging API. Defaults to `https://api.sanity.io`.
