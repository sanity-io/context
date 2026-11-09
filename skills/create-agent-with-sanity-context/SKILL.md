---
name: create-agent-with-sanity-context
description: Build AI agents with structured access to Sanity content via Sanity Context. Use when setting up a Sanity-powered chatbot, connecting an AI assistant to Sanity content, or adding client-side tools to an agent. Covers MCP endpoint setup in the Context app or with the Sanity CLI (GROQ mode over a dataset, or Knowledge Base mode), agent implementation, Insights, and advanced patterns. Always use this skill when users mention building a chatbot with Sanity, creating an AI assistant for their content, setting up the Sanity Context MCP server, integrating Sanity with Claude/GPT/any LLM, making content searchable by AI, implementing semantic search over Sanity data, or connecting their CMS to an AI agent.
---

# Build an Agent with Sanity Context

Give AI agents intelligent access to your Sanity content. Unlike embedding-only approaches, Sanity Context is schema-aware—agents can reason over your content structure, query with real field values, follow references, and combine structural filters with semantic search.

Sanity Context gives agents your schema and teaches them GROQ, but it can't know your domain. You close that gap through the **Instructions field** (dataset-specific query guidance) and optionally the **system prompt** (agent behavior and tone).

**Three actors in this workflow:**

- **You** — the agent executing this skill, helping the user set things up
- **The user** — the human you're working with, who knows their domain and data
- **The production agent** — the agent being built, which will serve end users

## What You'll Need

**The agent code needs only three values:**

| Value                                                    | Where to get it                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MCP endpoint URL** (`SANITY_CONTEXT_MCP_URL`)          | Shown on the endpoint in the Context app, or by `sanity context mcp get <name>`, once it's created ([Step 1](#step-1-create-the-mcp-endpoint))                                                                                                                                                                                                                                |
| **Organization API token** (`SANITY_ORGANIZATION_TOKEN`) | `npx sanity@latest tokens create "<label>" --organization <organizationId> --grant context=viewer`. Use `context=editor` if the agent also records Insights (Step 3). Or in [Manage](https://www.sanity.io/manage/org/api/tokens) → organization → API → Tokens → **Add API token**, with **Context** checked under **Organization permissions**. Project tokens do not work. |
| **LLM API key**                                          | From your LLM provider (Anthropic, OpenAI, etc.) — any provider works                                                                                                                                                                                                                                                                                                         |

**Setup also involves:**

| Requirement                    | When      | Where to get it                                                                                                                                          |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context enabled**            | Always    | An organization admin enables it from the organization's [Labs page](https://www.sanity.io/manage/org/labs) in Manage. This also enables Knowledge Bases |
| **Sanity project and dataset** | GROQ mode | Picked when creating the endpoint; also where the schema is deployed from (`sanity.config.ts`)                                                           |
| **Organization ID**            | Insights  | [Manage](https://www.sanity.io/manage) → organization settings, or the organization's URL                                                                |

The organization token is a server-side secret. It must never reach the browser.

## How Sanity Context Works

The Sanity Context MCP server gives AI agents structured, read-only access to Sanity content. The core integration pattern:

1. **Initial Context**: Fetch the initial context (the schema in GROQ mode, the Knowledge Base outline in Knowledge Base mode) via the `/initial-context` HTTP endpoint and inject it into the system prompt
2. **MCP Connection**: HTTP transport to the MCP endpoint URL
3. **Authentication**: Bearer token using the organization API token
4. **Tool Discovery**: Get available tools from MCP client, pass to LLM
5. **System Prompt**: Tell the production agent its role, tone, and boundaries

**Two retrieval modes.** The endpoint's content sources decide which it serves:

- **GROQ mode** (a dataset source): the agent queries the live dataset with GROQ, guided by the schema. Fits structured, consistent content where the schema tells the agent where to look: catalogs, articles, FAQs. For in-between content (a catalog with useful details in prose fields), enable [dataset embeddings](https://www.sanity.io/docs/content-lake/dataset-embeddings) and stay in GROQ mode.
- **Knowledge Base mode** (Knowledge Base sources, beta): the agent reads a pre-built index built ahead of time from datasets, websites, and files. Fits answers spread across prose from several places, where finding the answer is the hard part. See [Context retrieval modes](https://www.sanity.io/docs/ai/sanity-context-retrieval-modes).

An endpoint with both a dataset source and Knowledge Base sources serves both: the agent gets the tools of both modes. Ask the user which fits; GROQ mode is the default for content that lives in a Sanity dataset.

**MCP endpoints** are created and changed in the **Context app** in the Sanity Dashboard, or with the Sanity CLI (`sanity context mcp create`, `update`, `get`). Each endpoint has these fields:

| Field              | Purpose                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Title**          | Human-readable label. The agent also sees it as the heading of its initial context                          |
| **Name**           | URL identifier (lowercase, numbers, hyphens). Unique in the organization and **immutable** after creation   |
| **Content source** | What the endpoint serves: a dataset (GROQ mode), one or more Knowledge Bases (Knowledge Base mode), or both |
| **Instructions**   | Domain-specific guidance for the agent, injected into the initial context                                   |
| **GROQ filter**    | A GROQ filter expression scoping which documents the agent can read. Dataset sources only                   |

**MCP URL:**

```
https://api.sanity.io/v2026-11-03/context/organizations/:organizationId/mcp/:endpointName
```

The Context app and `sanity context mcp get <name>` show the URL once the endpoint is created. Changes to instructions or the filter take effect without redeploying the agent. If the agent caches `/initial-context` (recommended below), instruction changes show up when that cache refreshes.

**Initial context:**

Always fetch the initial context via the `/initial-context` HTTP endpoint and inject it into the system prompt. This gives a significant latency improvement on the first message—the agent already knows the schema and available tools without needing a tool call. It also enables better prompt caching since the schema prefix is stable across conversations.

Append `/initial-context` to the MCP URL path, using the same auth header:

```bash
# SANITY_CONTEXT_MCP_URL=https://api.sanity.io/v2026-11-03/context/organizations/:organizationId/mcp/:endpointName
curl "$SANITY_CONTEXT_MCP_URL/initial-context" \
  -H "Authorization: Bearer $SANITY_ORGANIZATION_TOKEN"
```

In a long-running server, cache the result with a short TTL (the reference implementation uses 5 minutes) and include it in your system prompt. A short TTL keeps schema, Instructions, and Knowledge Base rebuilds flowing through without a redeploy.

> **Critical: the model must always get the initial context.** It's either inlined into the system prompt, or available as the `initial_context` tool. Never neither: without it the agent has no schema or outline and guesses.
>
> - Fetch succeeded and inlined → remove the `initial_context` tool, so the model doesn't fetch it again.
> - Fetch failed, or you don't control the system prompt (e.g. a third-party MCP client) → keep the `initial_context` tool; the agent calls it on the first message.
>
> Never remove the tool unless the payload is actually in the system prompt.

## Available MCP Tools

The endpoint's mode decides which tools it serves:

- **GROQ mode:** tools to read the schema, run GROQ queries (with optional semantic search), and read large array fields. Queries are always subject to the endpoint's GROQ filter.
- **Knowledge Base mode:** tools to search and read Knowledge Base entries.

An endpoint with both sources serves both sets. Every endpoint serves `initial_context`: the schema overview for a dataset, the outline for each Knowledge Base, plus the endpoint's Instructions. It's the same payload as the `/initial-context` HTTP endpoint.

Don't hardcode the tool list. The set grows over time, so take it from the MCP client (`mcpClient.tools()` or `tools/list`). For what each tool does, see [Context MCP tools](https://www.sanity.io/docs/ai/sanity-context-mcp-tools).

**For development and debugging:** The general Sanity MCP provides broader access to your Sanity project (schema deployment, document management, etc.). Useful during development but not intended for customer-facing applications.

## Before You Start: Understand the User's Situation

A complete integration has **four distinct components** that may live in different places:

| Component                   | What it is                                                                                                           | Examples                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. MCP Endpoint**         | A deployed schema (GROQ mode) or a built Knowledge Base, plus an endpoint created in the Context app or with the CLI | Studio (v5.1.0+) for the schema deploy, Sanity CLI or the Context app for Knowledge Bases and the endpoint                                                                          |
| **2. Agent Implementation** | Code that connects to Sanity Context and handles LLM interactions                                                    | Next.js API route, Express server, Python service, or any MCP-compatible client                                                                                                     |
| **3. Frontend**             | UI for users to interact with the agent                                                                              | Chat widget, search interface, CLI—or none for backend services                                                                                                                     |
| **4. Functions**            | Scheduled classification via Sanity Blueprints (only with Insights, Step 3)                                          | `sanity.blueprint.ts` + `functions/` directory — has its own placement constraints (see [Insights: Project Structure](references/conversation-classification.md#project-structure)) |

An MCP endpoint is always required, backed by a deployed schema (GROQ mode, Studio v5.1.0+) or a built Knowledge Base: the agent has nothing to connect to without them. Frontend depends on the use case (many agents run as backend services or integrate into existing UIs).

**Before writing any code, inspect the project to understand:**

1. **Project layout**: Read the top-level `package.json` (check for `workspaces` or a `pnpm-workspace.yaml`), locate the lockfile, and map out the distinct apps/packages. This determines where `sanity.blueprint.ts` and `functions/` will go — see [Insights: Project Structure](references/conversation-classification.md#project-structure).
2. **Their stack**: What framework/runtime? (Next.js, Remix, Node server, Python, etc.)
3. **Their AI library**: Vercel AI SDK, LangChain, direct API calls, etc.
4. **Their domain**: What will the agent help with? (Shopping, docs, support, search, etc.)
5. **Which components they need help with**: They may only need one or two.

- **Components in different repos** (most common): You may only have access to one component. Complete what you can, then tell the user what steps remain for the other repos.
- **Co-located components**: All in the same project—work through them based on what the user wants to tackle first.
- **No Studio in the codebase?** For GROQ mode, ask the user whether the schema is already deployed from a Studio elsewhere. If it isn't, it has to be deployed before the endpoint will serve. Knowledge Base mode doesn't need a deployed schema.

## Workflow

**Always present the full workflow.** Even if the user's request seems narrow, inform them of all four steps — you don't have to implement everything, but they should know what's available. Step 3 is optional and Step 4 is recommended once the agent works; make sure the user knows both exist, then let them decide. Walk the user through the steps, explaining what each unlocks:

1. **Create the MCP Endpoint** — Deploy the schema or build a Knowledge Base, then create an endpoint with the CLI or in the Context app
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

**Knowledge Base mode: create and build the Knowledge Base.** It needs the Administrator or Developer role in the organization. Write the purpose with the user first: it decides which sources are kept and how entries are organized, so a specific purpose produces a better build. Use three lines:

```text
Answer setup and troubleshooting questions from developers using our API.
Focus on: configuration steps, error references, and known issues.
Leave out: marketing pages, pricing, and release notes.
```

Then run the CLI yourself:

```bash
npx sanity@latest context create --organization <organizationId> --title "Support docs" --description "<purpose>"
# Add sources, one per command: --url (crawl a website), --file, --text with --title,
# or --sanity-project-id, --sanity-dataset-id and --query for a dataset
npx sanity@latest context sources create <knowledgeBaseId> --url https://example.com/docs
npx sanity@latest context build <knowledgeBaseId> --watch
```

Start with a focused set of current material. `build --watch` waits for the sources and the build, and exits non-zero if the build fails. Then skim the entries and issues in the Context app.

The user can do the same in the Context app instead: **New knowledge base** with a **Title** and **Purpose**, **Add source**, then **Build entries** and wait for **Entries up to date**.

For details on sources, issues, and keeping it current, point the user to [Create a Knowledge Base](https://www.sanity.io/docs/ai/sanity-context-create-knowledge-base).

**Create the endpoint.** It needs the Administrator or Developer role in the organization. Attaching a dataset also needs the Administrator or Developer role on the dataset's project, with unrestricted read access to that dataset.

Create it yourself with the Sanity CLI, logged in as the user (`npx sanity@latest login`):

```bash
# GROQ mode
npx sanity@latest context mcp create product-assistant --title "Product Assistant" \
  --project <projectId> --dataset <dataset>

# Knowledge Base mode (repeat --knowledge-base to serve several)
npx sanity@latest context mcp create product-assistant --title "Product Assistant" \
  --knowledge-base <knowledgeBaseId>
```

The name becomes part of the URL and can't be changed later, so agree on it with the user first. To scope a dataset, add `--groq-filter '_type in ["product", "category"]'`; start broad, since the `dial-your-context` skill helps narrow it. Leave instructions empty for now; Step 4 covers them. The command prints the endpoint URL; `npx sanity@latest context mcp get product-assistant` shows it again. Pass `--organization <organizationId>` to each command unless it runs in a Sanity project directory whose CLI config sets one; without it, the CLI stops with an error.

If the user would rather use the Context app, tell them what to enter:

1. Open the **Context** app in the Sanity Dashboard and select **New MCP endpoint**
2. **Title**: something readable, e.g. "Product Assistant"
3. **Name**: short and stable, e.g. `product-assistant`. It becomes part of the URL and can't be changed later
4. **Content source**:
   - GROQ mode: choose the **Dataset** tab, then pick the project and dataset. Projects where the user lacks that role are disabled
   - Knowledge Base mode: choose the **Knowledge bases** tab and check the Knowledge Bases to serve
5. **GROQ filter** (dataset sources, optional): a filter expression such as `_type in ["product", "category"]`. Start broad; the `dial-your-context` skill helps narrow it
6. **Instructions**: leave empty for now; Step 4 covers them
7. Select **Create endpoint**, and copy the endpoint URL from its detail page

**Get the organization token** if the user doesn't have one yet: `npx sanity@latest tokens create` (see [What You'll Need](#what-youll-need)). Store it as `SANITY_ORGANIZATION_TOKEN` next to the agent's other secrets.

**Validate the endpoint:**

```bash
curl -X POST "$SANITY_CONTEXT_MCP_URL" \
  -H "Authorization: Bearer $SANITY_ORGANIZATION_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
```

The response should return a `result.tools` array that includes `initial_context`. If it returns an error or an empty list, see [Troubleshooting](#troubleshooting).

### Step 2: Build the Agent (Adapt to user's stack)

**The user already has an agent or MCP client?** They just need to connect it to the MCP endpoint URL with the organization token as a Bearer token. The tools will appear automatically.

**Building from scratch?** Help the user set up the MCP connection and LLM integration. Whatever the stack, the model must get the initial context: inlined into the system prompt, or as the `initial_context` tool (see [Initial context](#how-sanity-context-works)). The snippets and reference implementations use Vercel AI SDK v7 with Anthropic, but the pattern works with any LLM provider (OpenAI, local models, etc.). Start with the basics and add advanced patterns as needed.

**Follow [references/connecting-an-agent.md](references/connecting-an-agent.md)**: install, the initial context fetch, a request/response pattern for CLIs and APIs, a streaming route for chat UIs with where it goes in each framework, framework pitfalls, and a map of the full Next.js reference implementation.

**Check it end to end:** ask the agent "What content do you have access to?" With the initial context inlined, it answers straight away without calling the `initial_context` tool.

**System prompt:** keep it short and focused on behavior; the `shape-your-agent` skill covers what to put in it.

### Step 3: Conversation Insights (Optional)

**Offer Insights; the user decides.** Without tracking, there's no easy way to know whether the agent is helping users or failing silently. Insights shows what users ask, where the agent struggles, and what content is missing. It adds a Context Editor token and a scheduled function, so skip it if the user doesn't want that yet.

**If the user wants it, setup is two parts — do both:**

1. **Telemetry** — Add one integration to your existing `streamText` call (stores conversation transcripts in the organization's Context store). Recording conversations needs a Context **Editor** token; one Editor token can serve both the MCP and Insights
2. **Classification** — Deploy a scheduled function that analyzes conversations with the user's own AI SDK model and records verdicts back through the Context API

Telemetry without classification just stores raw conversations. Classification is what extracts success scores, sentiment, and content gaps — the actual insights. Set up both together.

**Follow [references/conversation-classification.md](references/conversation-classification.md) to set this up.** The guide covers both parts end-to-end. Insights appears in the Context app in the Sanity Dashboard once conversations are classified.

### Step 4: Tune Your Agent (Recommended)

Once the production agent works:

1. **Tune the Instructions field** using the `dial-your-context` skill — an interactive session where you explore the user's dataset together, verify findings, and produce concise Instructions that teach the production agent what the schema alone doesn't make obvious: counter-intuitive field names, second-order reference chains, data quality issues, required filters, and query patterns. The skill can also help configure the endpoint's GROQ filter to scope what content the production agent sees. It tunes on a draft endpoint and saves the results on the production endpoint with the CLI once the user approves them.

   **Knowledge Base mode:** `dial-your-context` targets GROQ mode. For a Knowledge Base, answers improve in the Context app by resolving issues and fixing sources; see [Resolve Knowledge Base issues](https://www.sanity.io/docs/ai/sanity-context-resolve-issues).

2. **Shape the system prompt** (optional) using the `shape-your-agent` skill — if the user controls the production agent's system prompt, this helps define tone, boundaries, and guardrails. Skip this if the user doesn't control the system prompt.

## Best Practices

- **Content filters**: Use the endpoint's GROQ filter to scope what the production agent sees — start broad, then narrow based on what it actually needs. The filter is a GROQ filter expression, the part inside `*[...]`, not a full query or projection. Examples: `_type in ["product", "article"]`, `_type == "article" && language == "en"`, `_type == "product" && references(*[_type == "category" && slug.current == "electronics"]._id)`
- **Instructions field**: Keep it concise — only include what the auto-generated schema doesn't make obvious. Don't duplicate schema information. See the `dial-your-context` skill.
- **System prompts**: Be explicit about forbidden behaviors and formatting rules. Less is more — an over-engineered prompt can interfere with the Instructions content. See the `shape-your-agent` skill.
- **Package versions**: `@sanity/context` is only needed for Insights (Step 3); an agent without Insights doesn't install it. When you do use it, use the latest version — run `npm info @sanity/context version` to get it. For other packages, use `npm info <package> version` for the latest release, but stay on the major versions the reference `package.json` uses (the snippets are written for those majors, e.g. AI SDK v7). AI SDK and Sanity packages update frequently, and using outdated versions will cause errors that are hard to debug.

## Troubleshooting

### "401 Unauthorized" from MCP

- **"Missing Sanity session":** no token, or no `Bearer` header.
- **"Not a member of this organization":** an invalid token, or a token that isn't in the organization from the URL.

On the MCP route both come back as JSON-RPC `-32001` with that message. `/initial-context` errors also include a code: `missingCredential` or `organizationAccessDenied`. Confirm `SANITY_ORGANIZATION_TOKEN` is set, is read by the agent code, is sent as `Authorization: Bearer <token>`, and that the organization ID in the URL is right.

### "404": MCP endpoint not found

HTTP 404 with JSON-RPC `-32001` and the message "MCP endpoint not found: <name>". The endpoint name or organization ID in the URL is wrong. Copy the URL from the endpoint in the Context app or from `sanity context mcp get <name>`; the name is lowercase and can't be changed. (`-32001` is also used for the 401 above, so check the HTTP status.)

### "403 Forbidden": JSON-RPC `-32007` (`contextGrantRequired`) or `-32006` (`knowledgeBaseAccessDenied`)

The token is not an organization API token with Context access. `-32007` comes from the check on endpoints with a dataset source; `-32006` ("No access to knowledge base 'kb…'") comes from the check on each Knowledge Base an endpoint serves. A project token is the most common first-run failure: it is refused however broad its permissions. Create an organization token as described in [What You'll Need](#what-youll-need).

The `-32007` message reads "Serving a dataset requires an organization API token with Context access ('sanity.knowledge-base.read'). Create one under your organization's API settings in Manage." On `/initial-context` the same failure shows the code `contextGrantRequired`.

### `-32004`: "Only datasets with deployed Studio applications are supported"

The schema isn't deployed for the endpoint's project and dataset. Deploy it from a Studio on v5.1.0+ (see [Step 1](#step-1-create-the-mcp-endpoint)), then reconnect.

### `-32005`: "No knowledge bases to serve: the endpoint has none, or none of them could be found."

The endpoint has no Knowledge Base it can serve: it has no sources at all, or every Knowledge Base on it was deleted (this fails even with a dataset source). Remove deleted ones with `npx sanity@latest context mcp update <name> --remove-knowledge-base <knowledgeBaseId>`, add one with `--add-knowledge-base`, or give an endpoint with no sources a dataset with `--project <projectId> --dataset <dataset>`. The Context app can do the same.

### "No documents found" / Empty results

Check the endpoint's GROQ filter, in `sanity context mcp get <name>` or the Context app:

- Is the GROQ filter correct?
- Are the document types spelled correctly?
- Are there published documents matching the filter? The endpoint reads the `published` perspective by default

A filter that matches nothing looks like a broken connection, so check it before debugging the connection. If several Studio workspaces point at the same dataset, the endpoint uses the first one unless the dataset source's **Workspace** setting picks another, which can serve the wrong schema.

### Tools not appearing

1. Check that `mcpClient.tools()` returns tools (log it)
2. Ensure the MCP URL is correct: organization ID and endpoint name
3. If the URL has a `tools` param, it narrows the tool list; drop it to see everything
