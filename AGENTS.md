# AGENTS.md

Guidelines for AI coding assistants working in this repository.

## Overview

This is a monorepo for Sanity Context—tools for building AI agents with structured access to Sanity content. The system has three main parts:

1. **Context MCP** (external service) - Hosted MCP server. Endpoints are configured per organization in the Context app in the Sanity Dashboard and expose tools to AI agents
2. **Agent Implementation** - Your app that connects to Context MCP and uses the tools
3. **`@sanity/context`** - Insights (conversation telemetry and classification) for agent implementations, plus a deprecated Studio plugin

This repo contains the `@sanity/context` package, agent skills for building and optimizing integrations, and a demo app.

## Repository Structure

```
.
├── packages/
│   └── context/              # @sanity/context npm package (Insights + deprecated Studio plugin)
├── skills/
│   ├── create-agent-with-sanity-context/  # Build an agent with Sanity Context
│   ├── dial-your-context/                 # Tune Instructions field content for Sanity Context
│   └── shape-your-agent/                  # Craft a system prompt for your agent (optional)
├── sandboxes/
│   └── dev-studio/           # Development sandbox for testing the deprecated plugin
├── examples/
│   └── ecommerce/            # Demo Next.js app with AI chat (source of truth for skill references)
└── package.json              # Root workspace config
```

## Package: @sanity/context

```ts
// Insights: AI SDK telemetry integration
import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'
// Insights: classification primitives
import {classifyConversations} from '@sanity/context/insights'
```

The deprecated Studio plugin lives in `src/studio/` (`@sanity/context/studio`). It only keeps legacy documents editable; don't extend it or point docs or skills at it.

## Development

```bash
pnpm install
pnpm dev          # Watch mode
pnpm build        # Build all packages
pnpm test:unit    # Run tests
pnpm check:types  # TypeScript checking
pnpm check:lint   # ESLint
```

### Testing deprecated plugin changes

`sandboxes/dev-studio` exists only for the deprecated plugin. Run `pnpm dev` in the root, then in another terminal:

```bash
cd sandboxes/dev-studio
cp .env.example .env  # Add your project credentials
pnpm dev
```

## Key Concepts

### MCP Endpoints

Created and managed in the Context app in the Sanity Dashboard, owned by the organization. Fields:

| Field          | Purpose                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `title`        | Human-readable label; also the heading of the initial context                            |
| `name`         | URL identifier. Lowercase, numbers, hyphens; unique in the organization; immutable       |
| `sources`      | A dataset (`<projectId>.<datasetName>`) for GROQ mode, or Knowledge Bases (`kb…` ids)    |
| `instructions` | Domain guidance for the agent, injected into the initial context                         |
| `groqFilter`   | GROQ filter expression scoping which documents the agent can read (dataset sources only) |

An endpoint with a dataset source serves GROQ mode and needs a deployed schema from Studio v5.1.0+. One whose sources are all Knowledge Bases serves Knowledge Base mode. With both, the dataset wins and the Knowledge Bases are ignored.

### GROQ Filter

A GROQ filter expression (the part inside `*[...]`) that scopes what content an agent can access:

```groq
_type in ["product", "category"]
```

A `?groqFilter=` URL param narrows the saved filter (combined with `&&`); it never replaces it.

### MCP URL

```
https://api.sanity.io/v1/context/organizations/:organizationId/mcp/:endpointName
```

Agents connect via HTTP transport with a Bearer token: an **organization** API token with Context access (Viewer to read; Editor to also record Insights). Project tokens are refused with HTTP 403 (`-32007` `contextGrantRequired` on dataset endpoints, `-32006` `knowledgeBaseAccessDenied` on Knowledge Base endpoints).

### Insights

Conversation tracking and classification system. Two parts:

1. **Telemetry integration** (`@sanity/context/ai-sdk`) — saves conversations from chat routes via AI SDK telemetry integrations (`telemetry` on ai v7, `experimental_telemetry` on v6)
2. **Insights primitives** (`@sanity/context/insights`) — classification primitives that run the customer's own AI SDK model and record verdicts through `client.context`; transcript saving itself is `client.context.conversations.save` from `@sanity/client`

Key files:

| File                                              | Purpose                                              |
| ------------------------------------------------- | ---------------------------------------------------- |
| `src/insights/classifyConversations.ts`           | Happy-path wrapper for classifying all conversations |
| `src/insights/classifyConversation.ts`            | Classify a single conversation with AI               |
| `src/insights/getConversationsToClassify.ts`      | Query the pending classification queue (GROQ)        |
| `src/insights/getPreviousContentGaps.ts`          | Query known content gaps ranked by frequency         |
| `src/insights/types.ts`                           | Shared insights options and message types            |
| `src/integrations/ai-sdk/telemetryIntegration.ts` | AI SDK telemetry integration                         |

Every insights function takes a `@sanity/client` (v8.4+) configured with `context: {organizationId}` and a server-side token; writes go through `client.context.conversations` and reads are GROQ over the org's Context document store via `client.context.fetch`. The pending queue is a query (no verdict, no recorded failure, non-empty, settled past a caller-owned cooldown, 10 minutes by default). Classification runs customer-side with their model and LLM key. `classifyConversations` (plural) is the recommended entry point — it orchestrates `getConversationsToClassify`, `getPreviousContentGaps`, and `classifyConversation` with bounded concurrency.

### Skill References Syncing

The `skills/create-agent-with-sanity-context/references/ecommerce/` folder is automatically synced from `examples/ecommerce/` via `pnpm sync-skill-example` (runs in CI on merge to main). Do not edit files in the references folder directly — make changes in `examples/ecommerce/` instead.
