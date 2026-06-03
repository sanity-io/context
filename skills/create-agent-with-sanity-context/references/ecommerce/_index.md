# Ecommerce Reference Implementation

Complete working example of a Next.js e-commerce site with AI shopping assistant powered by Sanity Context MCP.

> **Auto-synced** from `examples/ecommerce/`. Do not edit directly.

## When to Load Files

| Task                      | Load These Files                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| MCP connection setup      | `app/src/app/api/chat/route.ts` (`createMCPClient`)                                                        |
| System prompt from Sanity | `app/src/app/api/chat/route.ts` (`buildSystemPrompt`), `studio/schemaTypes/documents/agentConfig.ts`       |
| Client-side tool handling | `app/src/components/chat/chat.tsx` (`onToolCall`), `app/src/lib/client-tools.ts`                           |
| Page context capture      | `app/src/lib/capture-context.ts`                                                                           |
| Custom markdown rendering | `app/src/components/chat/message/text-part.tsx`                                                            |
| Studio plugin setup       | `studio/sanity.config.ts`                                                                                  |
| Schema design patterns    | `studio/schemaTypes/documents/product.ts`, `studio/schemaTypes/index.ts`                                   |
| Sanity client/queries     | `app/src/sanity/lib/client.ts`, `app/src/sanity/queries/`                                                  |
| Conversation insights     | `app/src/app/api/chat/route.ts` (`sanityInsightsIntegration`), `functions/classify-conversations/index.ts` |
| Environment variables     | `.env`                                                                                                     |

## File Map

### Agent Integration (Core)

```
app/src/app/api/chat/route.ts     # API route: MCP client, tools, streaming, insights
app/src/lib/client-tools.ts       # Tool constants shared server/client
app/src/lib/capture-context.ts    # Page context & screenshot capture
```

### Chat UI

```
app/src/components/chat/
├── chat.tsx                      # Main component: useChat, tool handling
├── chat-input.tsx                # Input field
├── chat-button.tsx               # Floating button to open chat
├── loader.tsx                    # Loading indicator
├── tool-call.tsx                 # Debug tool call display
└── message/
    ├── message.tsx               # Message rendering
    ├── text-part.tsx             # Text with markdown + directive parsing
    ├── document.tsx              # Document directive router
    └── product.tsx               # Product card component
```

### Scheduled Functions (Project Root)

```
./
├── sanity.blueprint.ts           # Scheduled function config
├── functions/
│   └── classify-conversations/
│       └── index.ts              # Scheduled classification function
```

### Sanity Studio

```
studio/
├── sanity.config.ts              # Plugin setup (includes contextPlugin)
└── schemaTypes/
    ├── index.ts                  # Schema registration
    ├── documents/
    │   ├── product.ts            # Product schema
    │   ├── category.ts           # Category schema
    │   ├── brand.ts              # Brand schema
    │   ├── agentConfig.ts        # Agent system prompt config
    │   └── ...
    └── objects/
        ├── productVariant.ts     # Variant (size/color combos)
        ├── price.ts              # Price object
        └── seo.ts                # SEO metadata
```

### Sanity Queries & Client

```
app/src/sanity/
├── lib/
│   ├── client.ts                 # Sanity client setup
│   ├── write-client.ts           # Write client for insights
│   └── image.ts                  # Image URL builder
└── queries/
    ├── products.ts               # Product queries
    ├── categories.ts             # Category queries
    └── fragments.ts              # Reusable GROQ fragments
```

### Product Pages (Context for Agent)

```
app/src/app/
├── page.tsx                      # Homepage
└── products/
    ├── page.tsx                  # Product listing
    └── [slug]/page.tsx           # Product detail
```

## Key Patterns

### MCP Connection

See `app/src/app/api/chat/route.ts` (`createMCPClient`)

### Client Tools (No Server Execute)

See `app/src/app/api/chat/route.ts` (`clientTools`)

### System Prompt from Sanity

See `app/src/app/api/chat/route.ts` (`buildSystemPrompt`)

### Tool Handling on Client

See `app/src/components/chat/chat.tsx` (`onToolCall`)

### Auto-continuation

See `app/src/components/chat/chat.tsx` (`sendAutomaticallyWhen`)

### Custom Directives

See `app/src/components/chat/message/text-part.tsx` (uses `@sanity/agent-directives`)

### Conversation Insights

Conversations are automatically saved via `sanityInsightsIntegration` in the chat route. Classification runs every 10 minutes via a scheduled function in `functions/classify-conversations/index.ts`.
