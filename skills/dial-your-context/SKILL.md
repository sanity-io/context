---
name: dial-your-context
description: Interactive session to create Instructions field content for the Sanity Context MCP server. Use this skill whenever users mention tuning agent context, improving agent responses to Sanity data, configuring MCP instructions, setting up content filters, or when their agent gives wrong results from Sanity queries. Also trigger when users say their agent is confused about schema relationships, needs data-specific guidance, or wants to optimize which content the agent can access.
---

# Dial Your Context

Help a user create the Instructions field content for the Sanity Context MCP server. The goal is a concise set of **pure deltas** — only information the agent can't figure out from the auto-generated schema.

This skill is for **GROQ mode** endpoints (a dataset source). For a Knowledge Base mode endpoint, answers improve in the Context app instead, by resolving issues and fixing sources; see [Resolve Knowledge Base issues](https://www.sanity.io/docs/ai/sanity-context-resolve-issues).

## What you're building

The Sanity Context MCP server already provides the agent with:

- A compressed schema of all document types and fields
- Efficiency and accuracy guidance
- A GROQ query tutorial in the `groq_query` tool description
- Tool descriptions for GROQ queries, semantic search, etc.

The Instructions field you're crafting is the MCP endpoint's **Instructions** field in the Context app. It appears under a `Context Instructions` heading at the top of the initial context, ahead of the efficiency, accuracy, tools, and schema sections. It should contain **only what the schema doesn't make obvious**:

- Counter-intuitive field names (e.g., `body` is actually a slug, `hero` is a reference to `mediaAsset`)
- Second-order reference chains the schema doesn't connect (e.g., "to find products with Dolby Atmos, chain `product → productFeature` and match on the feature's `id` field — the schema shows each hop but not the full path")
- Data quality issues the schema can't reveal (e.g., "the `product` type has a `features` array but it's always empty — use `support-product` instead")
- Required filters the agent must always apply (locale, an editorial status field, etc.)
- Known data gaps confirmed by the user (e.g., "the `subtitle` field is unused — ignore it")
- Query patterns for common use cases that aren't obvious from the schema
- Fallback strategies when primary approaches fail

**Never duplicate** what the schema already communicates clearly.

## Prerequisites

You need:

- **The MCP endpoint URL**: `https://api.sanity.io/v1/context/organizations/:organizationId/mcp/:endpointName`, shown on the endpoint in the Context app
- **An organization API token** with Context access (Viewer is enough for this session)

You test everything through URL query params on the endpoint, so the production agent is never touched during the session:

- `?instructions=<URL-encoded>` replaces the endpoint's instructions for that request. An empty `?instructions=` gives a blank slate (don't write `?instructions=""`: that sends two quote characters as the instructions)
- `?groqFilter=<URL-encoded>` **narrows** the endpoint's saved filter: the two are combined with `&&`. It can't widen what the saved filter allows

Saving the result happens in the Context app, by the user. You never write the endpoint configuration yourself.

**Calling the tools.** If you don't have the endpoint connected as an MCP server, call it over HTTP. Put the query params on the URL:

```bash
curl -X POST "$MCP_URL?instructions=" \
  -H "Authorization: Bearer $SANITY_ORGANIZATION_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"groq_query","arguments":{"query":"*[0...3]._type"}}}'
```

Read the initial context (schema plus instructions) with `GET $MCP_URL/initial-context` (same auth header, same query params).

## Critical rules

1. **Pure deltas only.** If the schema makes it obvious, don't put it in Instructions.
2. **Never generalize from small samples.** Querying 3 docs and concluding "field X is always null" is the #1 failure mode. Every claim must be verified with the user before inclusion.
3. **The user knows their data.** Schema dialogue beats data exploration. Present the schema, ask questions, listen.
4. **Verify every claim with evidence.** For each line in the draft Instructions, show the query + result that supports it. The user confirms or corrects.
5. **Keep it concise and factual.** The compaction step (summarizing findings into Instructions) is where information gets lost or distorted. No creative interpretation. Short declarative sentences.

## Workflow

### Step 1: Connect & Clean Slate

**Goal:** Establish MCP access, set up a safe working environment.

Get the MCP endpoint URL and an organization token from the user (see [Prerequisites](#prerequisites)).

**Decide whether you need a draft endpoint.** Because `?groqFilter=` can only narrow, ask the user what the endpoint's saved GROQ filter is (it's shown on the endpoint in the Context app):

- **No saved filter, or a saved filter you only expect to narrow further:** work against the existing endpoint with URL params. Nothing else to set up.
- **A saved filter you may need to widen:** ask the user to create a draft endpoint in the Context app (**New MCP endpoint**) with the same dataset source, a name like `tuning-draft`, and no GROQ filter. Creating it needs the Administrator or Developer role in the organization and on the dataset's project (the project role is the same one Step 7 needs to change the filter). Run the session against the draft's URL. The production endpoint stays untouched.

Use an empty `?instructions=` on every call until you're testing draft instructions, so existing instructions don't mask what the schema alone gets wrong.

Check if the endpoint already has instructions (ask the user to copy them from the Context app, or fetch `/initial-context` without the `instructions` param and look for the `Context Instructions` section):

- If yes, present the existing instructions to the user verbatim
- Ask: "Do you want to keep any of this, or start fresh?"
- Let the user decide — don't assume existing instructions are wrong
- If they have existing instructions from a previous session, you'll verify and refine each finding rather than starting from scratch

Verify you can query the dataset by running a simple GROQ query like `*[0...3]._type` to confirm access.

**Output:** Confirmed MCP access, safe working environment established (URL params, plus a draft endpoint if needed), any existing instructions surfaced to user.

### Step 2: Schema Dialogue

**Goal:** Understand the dataset through conversation, not just exploration.

Retrieve the schema (the MCP provides this). Present the document types to the user in a clear list:

> Here are the document types in your dataset:
>
> - `article` (14 fields)
> - `author` (8 fields)
> - `category` (5 fields)
> - ...
>
> Which of these are the ones your agent will need to work with?

This is a **conversation**, not a monologue. Ask the user:

1. **Which types matter?** "Which of these will your agent need to query? Any types here that are internal/system types the agent should ignore?"
2. **What's misleading?** "Any field names that don't mean what they sound like? Fields that are unused or deprecated?"
3. **What are the relationships?** "How do these types connect? For example, do articles reference authors? How — direct reference, array of references, something else?"
4. **Any required filters?** "Does the agent need to always filter by locale, an editorial status field, or anything else?"
5. **What's the primary content language?** If i18n is involved, clarify the pattern.

**Suggest a filter.** The endpoint's GROQ filter scopes which documents the agent can access. This is high-leverage — it reduces noise significantly and prevents the agent from querying irrelevant types. It's also a hard boundary: it applies server-side, so nothing in a conversation can widen it.

The filter is a GROQ filter expression (the part inside `*[...]`), not just a type list. This means you can carve out exactly the document set you want:

- Simple type filter: `_type in ["product", "support-article", "productFeature"]`
- Locale filter: `_type in ["product", "article"] && lang == "en-us"`
- Complex: `_type in ["product", "article"] && lang == "en-us" && defined(title)`

Don't write a full query (`*[...]`), a projection (`{ name, price }`), or ordering/slicing: those are rejected or match nothing, which looks like a broken connection. Drafts don't need filtering: the endpoint reads the published perspective by default.

Based on the conversation, propose a filter:

> Based on what you've told me, I'd suggest this filter:
>
> ```
> _type in ["article", "author", "category", "tag"]
> ```
>
> This means the agent won't see `siteSettings`, `redirect`, `migration`, etc. Does that sound right?

**Apply the filter immediately.** Once the user agrees, add `?groqFilter=<URL-encoded expression>` to all subsequent MCP calls.

All exploration from this point forward should use the agreed filter.

**Output:** A shared understanding of which types matter, known quirks, relationships, and an active filter. There's no point exploring types the production agent won't see.

### Step 3: Expected Questions

**Goal:** Get concrete examples of what the production agent will be asked.

Ask the user:

> What questions will people ask the agent that uses this context? Give me 5-20 examples — the more realistic, the better.

Examples might be:

- "Which speakers support Dolby Atmos?"
- "How do I fix WiFi connection issues?"
- "What's the return policy for refurbished products?"
- "Compare the features of product X and product Y"

These questions drive the exploration in Step 4. They tell you what query patterns actually matter.

For simple datasets, 5 questions is fine. For complex ones, push for 15-20.

**Output:** A numbered list of expected questions.

### Step 4: Explore & Verify

**Goal:** Answer each expected question using the MCP, track what works and what doesn't.

> **Steps 4–6 are iterative, not sequential.** Verify findings with the user as you go. Don't explore 15 questions, draft everything, then discover half your claims don't hold up.

Work through the expected questions one by one (or in logical groups). For each question:

1. **Write a GROQ query** to answer it
2. **Run the query** via the MCP
3. **Note the result** — did it work? Was the data what you expected?
4. **Track findings** in a running list:
   - ✅ Worked as expected (no instruction needed)
   - ⚠️ Worked but required non-obvious pattern (instruction needed)
   - ❌ Failed or returned unexpected results (investigate, then verify with user)

**Critical: Do not assume.** If a query returns empty results or unexpected data:

- Do NOT conclude "this field is always empty" from a small sample
- Instead, ask the user **immediately** — don't batch null-field findings: "When I query for X, I get Y. Is that expected? Is the data actually there?"
- The user confirms or explains the discrepancy

Track your findings in a simple table:

| #   | Question             | Query                                                    | Result       | Finding                                                    |
| --- | -------------------- | -------------------------------------------------------- | ------------ | ---------------------------------------------------------- |
| 1   | "Recent articles"    | `*[_type == "article"] \| order(publishedAt desc)[0..4]` | ✅ 5 results | Works with schema alone                                    |
| 2   | "Articles by author" | `*[_type == "article" && references(authorId)]`          | ⚠️ Empty     | Authors linked via `contributors[].person`, not direct ref |
| 3   | "Guides only"        | `*[_type == "article" && category == "guide"]`           | ❌ Empty     | User confirms: guides are `articleType == "howto"`         |

**Adapt to scale:**

- Simple dataset (3-5 types, 5 questions): This step might take 10 minutes
- Complex dataset (50 types, 20 questions): Group related questions, explore systematically, but still verify each finding

**Output:** A findings table with verified results for each expected question.

### Step 5: Draft Instructions

**Goal:** Distill findings into concise, factual Instructions content.

Review the findings table from Step 4. Include **only** items marked ⚠️ or ❌ — things that required non-obvious patterns or failed with the obvious approach.

Write the Instructions as short, declarative statements organized by category:

```markdown
### Rules

- Guides are `article` documents with `articleType == "howto"` — there is no `guide` category
- Always include `[_lang == "en"]` for localized content unless user specifies otherwise

### Schema notes

- `contributors` on `article` is an array of objects with a `person` reference to `author` — not a direct author reference
- `hero` on `article` is a reference to `mediaAsset`, not an image field
- `body` on `page` is a Portable Text array, not a string — use `pt::text(body)` for plain text search

### Query patterns

- Articles by author: `*[_type == "article" && contributors[].person._ref == $authorId]`
- Recent guides: `*[_type == "article" && articleType == "howto"] | order(publishedAt desc)`

### Known limitations

- `subtitle` field on `article` is unused — ignore it
- `relatedArticles` is manually curated and often empty for older content
```

**Keep it tight.** Each line should pass this test: "Would an agent with the schema alone get this wrong?" If you're unsure, test it — try answering 2-3 questions with an empty `?instructions=` and see what the model gets wrong on its own. That's your empirical baseline for what actually needs to be here. If no, cut it.

**Do not include:**

- General GROQ syntax (the tutorial covers this)
- Field lists or type descriptions (the schema covers this)
- Response formatting guidance (that belongs in the system prompt; see the `shape-your-agent` skill)
- Anything the agent would figure out on its own

**Output:** A draft Instructions block, typically 10-40 lines depending on dataset complexity.

### Step 6: Verify Claims

**Goal:** Ensure every line in the draft is backed by evidence.

Go through the draft Instructions line by line. For each claim, show the user:

1. **The claim:** e.g., "contributors on article is an array of objects with a person reference"
2. **The evidence:** The GROQ query and result that demonstrates it
3. **Ask for confirmation:** "Is this accurate? Anything to add or correct?"

Example:

> **Claim:** "Guides are `article` documents with `articleType == "howto"` — there is no `guide` category"
>
> **Evidence:** `*[_type == "article" && category == "guide"][0...3]` → 0 results. `array::unique(*[_type == "article"].articleType)` → `["howto", "news", "opinion"]`.
>
> **Is this correct?**

If the user corrects a claim, update the draft immediately.

If the user adds new information ("oh, and you should also know that..."), add it to the draft and verify it the same way.

**Output:** A verified Instructions block where every claim has been confirmed by the user.

### Step 7: Deploy

**Goal:** Get the Instructions and filter into production safely.

Present the final Instructions content and filter to the user for one last review:

> Here's the final configuration:
>
> **Filter (GROQ expression):**
>
> ```
> _type in ["article", "author", "category", "tag"]
> ```
>
> **Instructions:**
> [final instructions block]
>
> Ready to deploy?

The user saves the configuration in the Context app. Give them exactly what to paste:

1. Open the **Context** app in the Sanity Dashboard and select the **production** endpoint
2. **Instructions** field: [final instructions block]
3. **GROQ filter** field: [final GROQ expression]. The new value replaces the saved one. If you tuned with `?groqFilter=` on an endpoint that already had a filter, the filter you tested was `(<saved filter>) && (<your filter>)`, so paste that combined expression. If the user wants to drop the old filter, that widens scope beyond what you tested: re-test on a draft endpoint (Step 1) before saving
4. Save. Changes take effect on the next connection, with no redeploy of the agent. If the agent caches `/initial-context`, instruction changes show up when that cache refreshes

Changing the GROQ filter also needs the Administrator or Developer role on every attached dataset's project. If the user gets a 403 on save, someone with that role has to make the change.

Paste into the production endpoint rather than pointing the agent at the draft: the endpoint name is part of the URL and can't be renamed, so switching endpoints means changing the agent's configuration.

**After saving, verify:** fetch `/initial-context` from the production endpoint **without** any `instructions` or `groqFilter` params, and confirm the `Context Instructions` section matches. Run one of the expected questions to confirm the filter is active. If a `tuning-draft` endpoint was created, remind the user they can delete it in the Context app.

**Output:** Instructions and filter live in production, verified working.

## Adaptation guidelines

This workflow scales to any dataset size:

**Small dataset (3-5 types, 5 questions):**

- Step 2 might be a 2-minute conversation
- Step 4 might find zero non-obvious patterns
- Final Instructions might be 5 lines or even empty (which is fine — it means the schema is self-explanatory)

**Large dataset (50+ types, 20 questions):**

- Step 2 needs more structure — group types by domain area
- Step 3 is critical — without good questions, you'll explore aimlessly
- Step 4 should group related questions to avoid redundant exploration
- Final Instructions might be 30-40 lines with multiple sections

**The filter matters more for large datasets.** A 50-type dataset where the agent only needs 8 types benefits enormously from a filter.

## Anti-patterns to avoid

- **Don't explore without the user.** Running 50 queries silently and presenting a wall of findings is overwhelming and error-prone. Explore interactively.
- **Don't assume from samples.** "I checked 3 articles and none had a subtitle" ≠ "subtitle is unused." Ask the user.
- **Don't duplicate the schema.** "The article type has fields: title, body, author, publishedAt..." — the agent already knows this.
- **Don't write prose.** Instructions should be scannable bullet points, not paragraphs.
- **Don't over-engineer.** If the dataset is simple and the schema is clear, the Instructions might be 3 lines. That's a success, not a failure.
- **Don't skip verification.** Every claim needs evidence + user confirmation. This is the quality gate.

## Session state tracking

Throughout the session, maintain a mental model of:

```
- [ ] MCP access verified
- [ ] Working environment set up (URL params, plus a draft endpoint if needed)
- [ ] Existing instructions reviewed (if any)
- [ ] Schema discussed with user
- [ ] Filter agreed and applied
- [ ] Expected questions collected
- [ ] Questions explored and findings tracked
- [ ] Draft instructions written
- [ ] Each claim verified with evidence
- [ ] Instructions and filter saved in the Context app
- [ ] Production deployment verified
```

This checklist is your progress tracker. Share it with the user periodically so they know where you are in the process.
