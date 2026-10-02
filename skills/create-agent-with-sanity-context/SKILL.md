---
name: create-agent-with-sanity-context
description: Build AI agents with structured access to Sanity content via Sanity Context. Use when setting up a Sanity-powered chatbot, connecting an AI assistant to Sanity content, or adding client-side tools to an agent. Covers MCP endpoint setup in the Context app (GROQ mode over a dataset, or Knowledge Base mode), agent implementation, Insights, and advanced patterns. Always use this skill when users mention building a chatbot with Sanity, creating an AI assistant for their content, setting up the Sanity Context MCP server, integrating Sanity with Claude/GPT/any LLM, making content searchable by AI, implementing semantic search over Sanity data, or connecting their CMS to an AI agent.
---

# Build an Agent with Sanity Context

Give AI agents intelligent access to your Sanity content. Unlike embedding-only approaches, Sanity Context is schema-aware—agents can reason over your content structure, query with real field values, follow references, and combine structural filters with semantic search.

**What this enables:**

- Agents understand the relationships between your content types
- Queries use actual schema fields, not just text similarity
- Results respect your content model (categories, tags, references)
- Semantic search is available when needed, layered on structure

Sanity Context gives agents your schema and teaches them GROQ, but it can't know your domain. You close that gap through the **Instructions field** (dataset-specific query guidance) and optionally the **system prompt** (agent behavior and tone).

**Three actors in this workflow:**

- **You** — the agent executing this skill, helping the user set things up
- **The user** — the human you're working with, who knows their domain and data
- **The production agent** — the agent being built, which will serve end users

## What You'll Need

Before starting, gather these:

| Requirement                 | Where to get it                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context enabled**         | An organization admin enables it from the organization's [Labs page](https://www.sanity.io/manage/org/labs) in Manage                                                                                                                                                                                   |
| **Sanity Project ID**       | GROQ mode: your `sanity.config.ts` or [sanity.io/manage](https://sanity.io/manage)                                                                                                                                                                                                                      |
| **Dataset name**            | GROQ mode: usually `production` — check your `sanity.config.ts`                                                                                                                                                                                                                                         |
| **Knowledge Bases enabled** | Knowledge Base mode (beta): an organization admin enables Context Knowledge Bases from the same Labs page                                                                                                                                                                                               |
| **Organization ID**         | [Manage](https://www.sanity.io/manage) → organization settings, or the organization's URL                                                                                                                                                                                                               |
| **Organization API token**  | [Manage](https://www.sanity.io/manage/org/api/tokens) → organization → API → Tokens → **Add API token**, then under **Organization permissions** check **Context**. Choose **Viewer** for an agent that only reads; choose **Editor** if it also records Insights (Step 3). Project tokens do not work. |
| **LLM API key**             | From your LLM provider (Anthropic, OpenAI, etc.) — any provider works                                                                                                                                                                                                                                   |

The organization token is a server-side secret. It must never reach the browser.

## How Sanity Context Works

The Sanity Context MCP server gives AI agents structured, read-only access to Sanity content. The core integration pattern:

1. **Initial Context**: Fetch the initial context (the schema in GROQ mode, the Knowledge Base outline in Knowledge Base mode) via the `/initial-context` HTTP endpoint and inject it into the system prompt
2. **MCP Connection**: HTTP transport to the MCP endpoint URL
3. **Authentication**: Bearer token using the organization API token
4. **Tool Discovery**: Get available tools from MCP client, pass to LLM
5. **System Prompt**: Tell the production agent its role, tone, and boundaries

**Two retrieval modes.** The endpoint's content source decides which one it serves:

- **GROQ mode** (a dataset source): the agent queries the live dataset with GROQ, guided by the schema. Fits structured, consistent content where the schema tells the agent where to look: catalogs, articles, FAQs. For in-between content (a catalog with useful details in prose fields), enable [dataset embeddings](https://www.sanity.io/docs/content-lake/dataset-embeddings) and stay in GROQ mode.
- **Knowledge Base mode** (Knowledge Base sources, beta): the agent reads a pre-built index built ahead of time from datasets, websites, and files. Fits answers spread across prose from several places, where finding the answer is the hard part. See [Context retrieval modes](https://www.sanity.io/docs/ai/sanity-context-retrieval-modes).

An endpoint serves one mode. If it has both a dataset source and Knowledge Base sources, the dataset wins and the Knowledge Bases are ignored, with no error. Ask the user which fits; GROQ mode is the default for content that lives in a Sanity dataset.

**MCP endpoints** are created in the **Context app** in the Sanity Dashboard. Each endpoint has these fields:

| Field              | Purpose                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| **Title**          | Human-readable label. The agent also sees it as the heading of its initial context                        |
| **Name**           | URL identifier (lowercase, numbers, hyphens). Unique in the organization and **immutable** after creation |
| **Content source** | What the endpoint serves: a dataset (GROQ mode) or one or more Knowledge Bases (Knowledge Base mode)      |
| **Instructions**   | Domain-specific guidance for the agent, injected into the initial context                                 |
| **GROQ filter**    | A GROQ filter expression scoping which documents the agent can read. GROQ mode only                       |

**MCP URL:**

```
https://api.sanity.io/v1/context/organizations/:organizationId/mcp/:endpointName
```

The Context app shows the URL once the endpoint is created. Changes to instructions or the filter in the Context app take effect without redeploying the agent. If the agent caches `/initial-context` (recommended below), instruction changes show up when that cache refreshes.

**URL query params** apply per request (useful for testing and development):

- `?instructions=<content>` — Overrides the endpoint's instructions (an empty `?instructions=` gives a blank slate)
- `?groqFilter=<expression>` — **Narrows** the endpoint's filter. The saved filter always still applies; the two are combined with `&&`
- `?perspective=drafts|raw|<releaseId>` — Content perspective. Defaults to `published`

**The integration is simple**: Connect to the MCP URL, get tools, use them. The reference implementation shows one way to do this—adapt to your stack and LLM provider.

**Initial context (recommended):**

Always fetch the initial context via the `/initial-context` HTTP endpoint and inject it into the system prompt. This gives a significant latency improvement on the first message—the agent already knows the schema and available tools without needing a tool call. It also enables better prompt caching since the schema prefix is stable across conversations.

Append `/initial-context` to the MCP URL path (before any query params), using the same auth header:

```bash
curl https://api.sanity.io/v1/context/organizations/:organizationId/mcp/:endpointName/initial-context \
  -H "Authorization: Bearer $SANITY_ORGANIZATION_TOKEN"
```

Cache the result with a short TTL (the reference implementation uses 5 minutes) and include it in your system prompt. A short TTL keeps schema, Instructions, and Knowledge Base rebuilds flowing through without a redeploy. When using this, exclude the `initial_context` tool from the tools passed to the LLM to avoid redundant calls.

If you don't control the system prompt (e.g. using a third-party MCP client), the `initial_context` MCP tool still works — the agent will call it on the first message instead.

## Available MCP Tools

**GROQ mode:**

| Tool                 | Purpose                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initial_context`    | Get compressed schema overview (types, fields, document counts) plus the endpoint's Instructions. Also available via the `/initial-context` HTTP endpoint. |
| `groq_query`         | Execute GROQ queries with optional semantic search, subject to the endpoint's GROQ filter                                                                  |
| `schema_explorer`    | Get detailed schema for a specific document type                                                                                                           |
| `array_field_reader` | Read large array fields and Portable Text content from a single document                                                                                   |

**Knowledge Base mode:**

| Tool                    | Purpose                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initial_context`       | The outline of each Knowledge Base (every entry path with a one-line summary) plus the endpoint's Instructions. Also available via HTTP                         |
| `knowledge_base_read`   | Read the full content of up to 20 entries in one call, by Knowledge Base id (`kb…`) and entry paths taken verbatim from the outline                             |
| `knowledge_base_search` | Keyword search over a Knowledge Base's entries (exact matching, up to 20 results). Returns ranked paths to read with `knowledge_base_read`, or the full entries |

**For development and debugging:** The general Sanity MCP provides broader access to your Sanity project (schema deployment, document management, etc.). Useful during development but not intended for customer-facing applications.

## Before You Start: Understand the User's Situation

A complete integration has **four distinct components** that may live in different places:

| Component                   | What it is                                                                                           | Examples                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. MCP Endpoint**         | A deployed schema (GROQ mode) or a built Knowledge Base, plus an endpoint created in the Context app | Studio (v5.1.0+) for the schema deploy, Context app in the Sanity Dashboard for Knowledge Bases and the endpoint                                        |
| **2. Agent Implementation** | Code that connects to Sanity Context and handles LLM interactions                                    | Next.js API route, Express server, Python service, or any MCP-compatible client                                                                         |
| **3. Frontend**             | UI for users to interact with the agent                                                              | Chat widget, search interface, CLI—or none for backend services                                                                                         |
| **4. Functions**            | Scheduled classification via Sanity Blueprints                                                       | `sanity.blueprint.ts` + `functions/` directory — has its own placement constraints (see [Sanity Blueprints & Functions](#sanity-blueprints--functions)) |

An MCP endpoint is always required, backed by a deployed schema (GROQ mode, Studio v5.1.0+) or a built Knowledge Base: the agent has nothing to connect to without them. Frontend depends on the use case (many agents run as backend services or integrate into existing UIs).

**Before writing any code, inspect the project to understand:**

1. **Project layout**: Read the top-level `package.json` (check for `workspaces` or a `pnpm-workspace.yaml`), locate the lockfile, and map out the distinct apps/packages. This determines where `sanity.blueprint.ts` and `functions/` will go — see [Sanity Blueprints & Functions](#sanity-blueprints--functions).
2. **Their stack**: What framework/runtime? (Next.js, Remix, Node server, Python, etc.)
3. **Their AI library**: Vercel AI SDK, LangChain, direct API calls, etc.
4. **Their domain**: What will the agent help with? (Shopping, docs, support, search, etc.)
5. **Which components they need help with**: They may only need one or two.

- **Components in different repos** (most common): You may only have access to one component. Complete what you can, then tell the user what steps remain for the other repos.
- **Co-located components**: All in the same project—work through them based on what the user wants to tackle first.
- **No Studio in the codebase?** For GROQ mode, ask the user whether the schema is already deployed from a Studio elsewhere. If it isn't, it has to be deployed before the endpoint will serve. Knowledge Base mode doesn't need a deployed schema.

The reference patterns use Next.js + Vercel AI SDK, but adapt to whatever the user is working with.

## Workflow

**Always present the full workflow.** Even if the user's request seems narrow, inform them of all four steps — you don't have to implement everything, but they should know what's available. Step 3 is optional and Step 4 is recommended once the agent works; make sure the user knows both exist, then let them decide. Walk the user through the steps, explaining what each unlocks:

1. **Create the MCP Endpoint** — Deploy the schema or build a Knowledge Base, then create an endpoint in the Context app
2. **Build the Agent** — Get a working chatbot connected to their content
3. **Conversation Insights** (optional) — Track and classify conversations to see where the agent succeeds and struggles
4. **Tune the Agent** — Refine instructions and system prompt using the tuning skills

After completing each step, present the next one. Stop when the user has what they need or explicitly defers.

### Step 1: Create the MCP Endpoint

Confirm the retrieval mode with the user first (see [Two retrieval modes](#how-sanity-context-works)), then prepare the content source.

**GROQ mode: deploy the schema.** The MCP server reads the schema from Sanity, not from the local machine, and an endpoint with a dataset source won't serve without a deployed schema from Studio **v5.1.0+**. Check the Studio's `sanity` version first. Then, from the Studio directory:

- **Any Studio:** `npx sanity schema deploy`
- **Sanity-hosted Studio:** `npx sanity deploy` also works, but the user then has to open the deployed Studio in the browser once to trigger the schema deployment
- **Externally hosted Studio** (Sanity CLI v5.8.0+): `npx sanity deploy --external --schema-required` registers the external URL and fails fast if the schema deploy fails

**Knowledge Base mode: create and build the Knowledge Base.** The user does this in the Context app (organization Administrator or Developer role). At a high level:

1. Select **New knowledge base** and give it a **Title** and a **Purpose**: one or two sentences on who it serves and what it helps with. A specific purpose produces a better build
2. **Add source**: a dataset, a website, or files. Start with a focused set of current material
3. Select **Build entries** and wait for **Entries up to date**, then skim **Entries** and **Issues**

For details on sources, issues, and keeping it current, point the user to [Create a Knowledge Base](https://www.sanity.io/docs/ai/sanity-context-create-knowledge-base).

**Create the endpoint in the Context app.** The user does this in the Sanity Dashboard; it needs the Administrator or Developer role in the organization. Attaching a dataset also needs the Administrator or Developer role on the dataset's project, with unrestricted read access to that dataset. Tell them what to enter:

1. Open the **Context** app in the Sanity Dashboard and select **New MCP endpoint**
2. **Title**: something readable, e.g. "Product Assistant"
3. **Name**: short and stable, e.g. `product-assistant`. It becomes part of the URL and can't be changed later
4. **Content source**:
   - GROQ mode: choose the **Dataset** tab, then pick the project and dataset. Projects where the user lacks that role are disabled
   - Knowledge Base mode: choose the **Knowledge bases** tab and check the Knowledge Bases to serve
5. **GROQ filter** (GROQ mode, optional): a filter expression such as `_type in ["product", "category"]`. Start broad; the `dial-your-context` skill helps narrow it
6. **Instructions**: leave empty for now; Step 4 covers them
7. Select **Create endpoint**, and copy the endpoint URL from its detail page

**Get the organization token** if the user doesn't have one yet (see [What You'll Need](#what-youll-need)). Store it as `SANITY_ORGANIZATION_TOKEN` next to the agent's other secrets.

**Validate the endpoint:**

```bash
curl -X POST https://api.sanity.io/v1/context/organizations/:organizationId/mcp/:endpointName \
  -H "Authorization: Bearer $SANITY_ORGANIZATION_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
```

The response should list `initial_context` and `groq_query` (GROQ mode) or `initial_context`, `knowledge_base_read`, and `knowledge_base_search` (Knowledge Base mode). If it doesn't, see [Troubleshooting](#troubleshooting).

### Step 2: Build the Agent (Adapt to user's stack)

**The user already has an agent or MCP client?** They just need to connect it to the MCP endpoint URL with the organization token as a Bearer token. The tools will appear automatically.

**Building from scratch?** Help the user set up the MCP connection and LLM integration. The reference implementations use Vercel AI SDK with Anthropic, but the pattern works with any LLM provider (OpenAI, local models, etc.). Start with the basics and add advanced patterns as needed.

**Framework-specific guides:**

- **Next.js**: See [references/nextjs-agent.md](references/nextjs-agent.md)
- **SvelteKit**: See [references/sveltekit-agent.md](references/sveltekit-agent.md)
- **Other stacks** (Express, Remix, Python, LangChain): See [references/adapting-to-stacks.md](references/adapting-to-stacks.md)

**System prompts** (applies to all frameworks): See [references/system-prompts.md](references/system-prompts.md) for structure and domain-specific examples (e-commerce, docs, support, content curation).

The framework guides cover:

- **Core setup** (required): MCP connection, authentication, basic chat route
- **Frontend** (optional): Chat component for the framework, including markdown rendering (LLM responses are markdown — a renderer like `react-markdown` or `marked` is needed to display formatted output)
- **Advanced patterns** (optional): Client-side tools, auto-continuation, custom directive rendering

### Step 3: Conversation Insights (Optional)

**Offer Insights; the user decides.** Without tracking, there's no easy way to know whether the agent is helping users or failing silently. Insights shows what users ask, where the agent struggles, and what content is missing. It adds a Context Editor token and a scheduled function, so skip it if the user doesn't want that yet.

**What this unlocks:**

- See which conversations succeed and which fail
- Discover content gaps — topics users ask about that the agent can't answer well
- Debug specific conversations with full transcripts
- Compare performance across multiple agents

**If the user wants it, setup is two parts — do both:**

1. **Telemetry** — Add one integration to your existing `streamText` call (stores conversation transcripts in the organization's Context store). Recording conversations needs a Context **Editor** token; one Editor token can serve both the MCP and Insights
2. **Classification** — Deploy a scheduled function that analyzes conversations with the user's own AI SDK model and records verdicts back through the Context API

Telemetry without classification just stores raw conversations. Classification is what extracts success scores, sentiment, and content gaps — the actual insights. Set up both together.

**Follow [references/conversation-classification.md](references/conversation-classification.md) to set this up.** The guide covers both parts end-to-end. Insights appears in the Context app in the Sanity Dashboard once conversations are classified.

### Step 4: Tune Your Agent (Recommended)

Once the production agent works:

1. **Tune the Instructions field** using the `dial-your-context` skill — an interactive session where you explore the user's dataset together, verify findings, and produce concise Instructions that teach the production agent what the schema alone doesn't make obvious: counter-intuitive field names, second-order reference chains, data quality issues, required filters, and query patterns. The skill can also help configure the endpoint's GROQ filter to scope what content the production agent sees. The user pastes the results into the endpoint's Instructions and GROQ filter fields in the Context app.

   **Knowledge Base mode:** `dial-your-context` targets GROQ mode. For a Knowledge Base, answers improve in the Context app by resolving issues and fixing sources; see [Resolve Knowledge Base issues](https://www.sanity.io/docs/ai/sanity-context-resolve-issues).

2. **Shape the system prompt** (optional) using the `shape-your-agent` skill — if the user controls the production agent's system prompt, this helps define tone, boundaries, and guardrails. Skip this if the user doesn't control the system prompt.

## Sanity Blueprints & Functions

Scheduled classification uses **Sanity Blueprints** to deploy **Sanity Functions**.

### Placement principles

Before adding files, search the project for an existing `sanity.blueprint.ts`. If one exists with deployed functions, add the new function there — even if it's not next to the lockfile. An existing working setup takes precedence over the default placement rules below. Only follow these rules when creating a new blueprint from scratch.

Find the project's lockfile (`yarn.lock`, `pnpm-lock.yaml`, or `package-lock.json`). Two rules for new blueprints:

1. **`sanity.blueprint.ts` must be in the same directory as the lockfile.** The CLI detects the package manager from the lockfile. If no lockfile is present, pass `--fn-installer pnpm` (or `npm`/`yarn`) to the deploy command.
2. **Function `src` paths are resolved relative to the blueprint file.** By default a function named `classify-conversations` maps to `functions/classify-conversations/` next to the blueprint. Use the `src` property in `defineScheduledFunction` to point to a different directory.

**In a monorepo** with no existing blueprint, the lockfile is at the workspace root — so `sanity.blueprint.ts` and `functions/` go there too, alongside the root `package.json`. However, if a blueprint already exists in a subdirectory (e.g. `apps/studio/`) and functions are successfully deploying from there, use that location. The CLI can work from subdirectories when configured correctly (e.g. with `--fn-installer pnpm`).

**Dependencies**: Functions use the `package.json` next to the blueprint for dependencies by default (`project-level`). Each function can alternatively have its own `package.json` (`function-level`), but a function uses one or the other — never both. See [Sanity Functions: Dependencies](https://www.sanity.io/docs/functions/function-dependencies).

### Commands

Run from the directory containing `sanity.blueprint.ts`:

| Command                                              | Purpose                                                 |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `npx sanity blueprints init`                         | Initialize the blueprint stack (first time only)        |
| `npx sanity blueprints promote`                      | Promote to org scope (required for scheduled functions) |
| `npx sanity blueprints doctor`                       | Check blueprint health and flag issues                  |
| `npx sanity blueprints plan`                         | Preview what deploy will change                         |
| `npx sanity blueprints deploy`                       | Deploy blueprint and functions                          |
| `npx sanity functions env add <fn> <key> <value>`    | Set an env var (after deploy)                           |
| `npx sanity functions logs <name>`                   | View function logs                                      |
| `npx sanity functions test <name> --with-user-token` | Test function locally                                   |

## GROQ with Semantic Search

Sanity Context supports `text::semanticSimilarity()` for semantic ranking:

```groq
*[_type == "article" && category == "guides"]
  | score(text::semanticSimilarity("getting started tutorial"))
  | order(_score desc)
  { _id, title, summary }[0...10]
```

Always use `order(_score desc)` when using `score()` to get best matches first.

## Adapting to Different Stacks

The MCP connection pattern is framework and LLM-agnostic. Whether Next.js, Remix, Express, or Python FastAPI—the HTTP transport works the same. Any LLM provider that supports tool calling will work.

See [references/adapting-to-stacks.md](references/adapting-to-stacks.md) for:

- Framework-specific route patterns (Express, Remix, Python)
- AI library integrations (LangChain, direct API calls)

See [references/system-prompts.md](references/system-prompts.md) for domain-specific examples (e-commerce, docs, support, content curation).

## Best Practices

- **Start simple**: Build the basic integration first, then add advanced patterns as needed
- **Schema design**: Use descriptive field names—agents rely on schema understanding
- **GROQ queries**: Always include `_id` in projections so agents can reference documents
- **Content filters**: Use the endpoint's GROQ filter to scope what the production agent sees — start broad, then narrow based on what it actually needs. The filter is a GROQ filter expression, the part inside `*[...]`, not a full query or projection. Examples: `_type in ["product", "article"]`, `_type == "article" && language == "en"`, `_type == "product" && references(*[_type == "category" && slug.current == "electronics"]._id)`
- **Instructions field**: Keep it concise — only include what the auto-generated schema doesn't make obvious. Don't duplicate schema information. See the `dial-your-context` skill.
- **System prompts**: Be explicit about forbidden behaviors and formatting rules. Less is more — an over-engineered prompt can interfere with the Instructions content. See the `shape-your-agent` skill.
- **Package versions**: `@sanity/context` is only needed for Insights (Step 3); an agent without Insights doesn't install it. When you do use it, use the latest version — run `npm info @sanity/context version` to get it. For other packages, check the reference `package.json` files or use `npm info <package> version`. AI SDK and Sanity packages update frequently, and using outdated versions will cause errors that are hard to debug.

## Troubleshooting

### "401 Unauthorized" from MCP

The token is missing or malformed, or it doesn't belong to the organization in the URL (message: "Not a member of this organization"; JSON-RPC `-32001` on the MCP route). Confirm `SANITY_ORGANIZATION_TOKEN` is set, is read by the agent code, is sent as `Authorization: Bearer <token>`, and that the organization ID in the URL is right.

### "404": MCP endpoint not found

HTTP 404 with JSON-RPC `-32001` and the message "MCP endpoint not found: <name>". The endpoint name or organization ID in the URL is wrong. Copy the URL from the endpoint in the Context app; the name is lowercase and can't be changed. (`-32001` is also used for the 401 above, so check the HTTP status.)

### "403 Forbidden": JSON-RPC `-32007` (`contextGrantRequired`) or `-32006` (`knowledgeBaseAccessDenied`)

The token is not an organization API token with Context access. `-32007` comes from the check on endpoints with a dataset source; `-32006` ("No access to knowledge base 'kb…'") comes from the check on each Knowledge Base an endpoint serves. A project token is the most common first-run failure: it is refused however broad its permissions. Create an organization token as described in [What You'll Need](#what-youll-need).

On the MCP route this arrives as JSON-RPC error `-32007` with the message "This requires an organization API token with Context access ('sanity.knowledge-base.read')…". On `/initial-context` it shows the code `contextGrantRequired`.

### `-32004`: "Only datasets with deployed Studio applications are supported"

The schema isn't deployed for the endpoint's project and dataset. Deploy it from a Studio on v5.1.0+ (see [Step 1](#step-1-create-the-mcp-endpoint)), then reconnect.

### `-32005`: 'Mode is set to "knowledge_base" but no knowledge bases are configured'

The endpoint has no dataset source and no Knowledge Base it can serve. For GROQ mode, edit the endpoint in the Context app and choose the **Dataset** tab as its content source. For Knowledge Base mode, check that at least one Knowledge Base is selected on the endpoint.

### "No documents found" / Empty results

Check the endpoint's GROQ filter in the Context app:

- Is the GROQ filter correct?
- Are the document types spelled correctly?
- Are there published documents matching the filter? The endpoint reads the `published` perspective by default

A filter that matches nothing looks like a broken connection, so check it before debugging the connection. If several Studio workspaces point at the same dataset, the endpoint uses the first one unless `?workspace=<name>` is set, which can serve the wrong schema.

### Tools not appearing

1. Check that `mcpClient.tools()` returns tools (log it)
2. Ensure the MCP URL is correct: organization ID and endpoint name
3. If the URL has a `tools` param, it narrows the tool list; drop it to see everything
