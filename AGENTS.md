# AGENTS.md

Guidelines for AI coding assistants working in this repository.

## Overview

This is a monorepo for Sanity Agent Context—tools for building AI agents with structured access to Sanity content. The system has three main parts:

1. **Studio Plugin** (`@sanity/agent-context`) - Registers a document type for configuring agent content access
2. **Context MCP** (external service) - Reads agent context documents and exposes tools to AI agents
3. **Agent Implementation** - Your app that connects to Context MCP and uses the tools

This repo contains the Studio plugin, agent skills for building and optimizing integrations, and a demo app.

## Repository Structure

```
.
├── packages/
│   └── agent-context/        # @sanity/agent-context npm package
├── skills/
│   ├── create-agent-with-sanity-context/  # Build an agent with Agent Context
│   ├── dial-your-context/                 # Tune Instructions field content for your Agent Context MCP
│   └── shape-your-agent/                  # Craft a system prompt for your agent (optional)
├── sandboxes/
│   └── dev-studio/           # Development sandbox for testing plugin
├── examples/
│   └── ecommerce/            # Demo Next.js app with AI chat (source of truth for skill references)
└── package.json              # Root workspace config
```

## Package: @sanity/agent-context

The main deliverable. A Sanity Studio plugin that registers the `sanity.agentContext` document type.

### Key Files

| File                                                              | Purpose                |
| ----------------------------------------------------------------- | ---------------------- |
| `src/studio/context-plugin/plugin.tsx`                            | Plugin definition      |
| `src/studio/context-plugin/agentContextSchema.ts`                 | Document type schema   |
| `src/studio/context-plugin/AgentContextDocumentInput.tsx`         | Custom form component  |
| `src/studio/context-plugin/groq-filter-input/GroqFilterInput.tsx` | GROQ filter editor     |
| `src/studio/context-plugin/groq-filter-input/groqUtils.ts`        | GROQ parsing utilities |

### Exports

```ts
// Studio plugin and constants
import {agentContextPlugin, AGENT_CONTEXT_SCHEMA_TYPE_NAME} from '@sanity/agent-context/studio'
```

## Development

```bash
pnpm install
pnpm dev          # Watch mode
pnpm build        # Build all packages
pnpm test:unit    # Run tests
pnpm check:types  # TypeScript checking
pnpm check:lint   # ESLint
```

### Testing Plugin Changes

Run `pnpm dev` in the root, then in another terminal:

```bash
cd sandboxes/dev-studio
cp .env.example .env  # Add your project credentials
pnpm dev
```

## Key Concepts

### Agent Context Document

Schema type: `sanity.agentContext`

| Field           | Type   | Purpose                                  |
| --------------- | ------ | ---------------------------------------- |
| `name`          | string | Display name (e.g., "Product Assistant") |
| `slug`          | slug   | URL identifier, auto-generated from name |
| `contentFilter` | object | GROQ filter defining accessible content  |

### Content Filter

A GROQ expression that scopes what content an agent can access:

```groq
_type in ["product", "category"]
```

The filter UI provides two modes:

- **Types tab**: Simple checkbox selection of document types
- **GROQ tab**: Manual entry for complex filters

### MCP URL

Each agent context document generates an MCP URL:

```
https://api.sanity.io/v2026-03-03/agent-context/:projectId/:dataset/:slug
```

Agents connect via HTTP transport with a Bearer token (Sanity API read token).

### Insights

Conversation tracking and classification system. Two parts:

1. **Telemetry integration** (`@sanity/agent-context/ai-sdk`) — saves conversations from chat routes via AI SDK's `experimental_telemetry`
2. **Classification primitives** (`@sanity/agent-context/insights`) — composable functions for analyzing saved conversations

Key files:

| File                                                | Purpose                                    |
| --------------------------------------------------- | ------------------------------------------ |
| `src/insights/saveConversation.ts`                  | Save/upsert conversation documents         |
| `src/insights/getConversationsToClassify.ts`        | Query conversations needing classification |
| `src/insights/classifyConversation.ts`              | Classify a conversation with AI            |
| `src/insights/sendInsightsTelemetry.ts`             | Opt-in telemetry sharing with Sanity       |
| `src/insights/getPreviousContentGaps.ts`            | Fetch previously identified content gaps   |
| `src/integrations/ai-sdk/telemetryIntegration.ts`   | AI SDK telemetry integration               |
| `src/studio/insights/schemas/conversationSchema.ts` | Conversation document schema               |

`getConversationsToClassify` and `classifyConversation` are designed as composable primitives — the former returns all data (messages, model info), the latter accepts it as input with no internal fetches.

### Skill References Syncing

The `skills/create-agent-with-sanity-context/references/ecommerce/` folder is automatically synced from `examples/ecommerce/` via `pnpm sync-skill-example` (runs in CI on merge to main). Do not edit files in the references folder directly — make changes in `examples/ecommerce/` instead.
