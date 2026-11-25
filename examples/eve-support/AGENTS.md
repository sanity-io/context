# eve Agent App

This project uses the eve framework: an agent is a directory of files under `agent/`, and eve compiles and runs it.

For a content-only change to the root agent's identity, purpose, tone, or response guidelines, edit its existing authored instructions. Fresh projects use `agent/instructions.md`; a project may instead use `agent/instructions.ts` or files under `agent/instructions/`. You do not need to read the framework docs for a content-only instructions change. A fresh project already has its selected model in `agent/agent.ts`; preserve that file unless the user asks to change the model.

## Read the docs before writing code

```sh
ls node_modules/eve/docs
```

Start with `docs/README.md`: it maps each task to the page that covers it. Read that page before authoring tools, connections, channels, skills, subagents, schedules, or deployment. In a workspace or local package install, resolve the installed `eve` package location first. If the package docs are missing, use https://eve.dev/docs.

Use a bounded authoring loop:

1. Read the relevant page and inspect only files you will modify or need to imitate.
2. Stop discovery once the file location, imports, and definition shape are clear. Implement the smallest complete behavior the user requested.
3. Run one narrow verification. Expand investigation only when it fails or the request needs project-specific details.

Follow links or inspect public types only when the routed page leaves the task unanswered. Do not recursively glob `node_modules`, enumerate the entire docs tree, or read unrelated scaffold files when the direct path is known. Package-manager links can hide files from recursive glob tools even though direct reads work.

## Prefer an existing integration

When a task names an external product or service, search the registry before implementing its integration. For a generic capability, author a tool instead.

```sh
eve registry search <query> --json
eve registry view <item>
```

Prefer items whose `implementation` is `native`; use Chat SDK adapters when no native channel fits. `registry view` links the item's documentation.

Install without driving interactive prompts:

```sh
eve add <item> --non-interactive
```

Exit code 0 means setup completed, 1 failed, and 2 needs an answer or a prerequisite. On exit 2, run the `next.command` from the final NDJSON event. For a non-secret question, replace its `<JSON value>` answer placeholder with the answer you collected; string values need JSON quotes. Never pass a secret in `--answer`. See `docs/install-integrations.mdx` for setup prerequisites.

## Use eve for Vercel operations

Use eve to link and deploy Vercel projects:

```sh
eve link --non-interactive --project <name-or-id> [--team <team-id-or-slug>]
eve deploy --non-interactive --yes [--project <name-or-id>]
```

A setup may report `eve link` as a prerequisite; run it, then retry the continuation. When a completed setup event has `deploymentRequired: true`, run the `next` command it reports.

## Validate the change

Run the validation the task requests. When it does not establish the behavior you changed, run the narrowest relevant check.

## This template: Jev decides, code enforces, the model writes

The agent answers customer questions from a Sanity Context MCP endpoint, with a decision step before each answer. Keep these parts working when you change it:

- `agent/hooks/decide.ts` runs on `turn.started`: it loads the Knowledge Base index (`agent/lib/knowledge-base.ts`), asks Jev three questions with eve's `decide()` (`agent/lib/decide.ts`), turns the answers into a route with `agent/lib/rules.ts`, and saves it in eve state. If Jev fails, the route falls back to searching with the careful model. Keep that fallback: Jev must never block an answer.
- `agent/agent.ts` reads the route's `model`; `agent/instructions/route.ts` adds its instruction (system role); `agent/instructions/content.ts` adds the looked-up entries as a user-role instruction, so they stay in the conversation for later turns; `agent/connections/sanity.ts` offers the search tools only when the route says so. Change routing behavior in `agent/lib/rules.ts`, not in these files.
- Jev only knows each option by its description in `agent/lib/decide.ts`. When you add or rename an option, update `routeFor` in `agent/lib/rules.ts` and `evals/routing.eval.ts` too.
- `SANITY_CONTEXT_MCP_URL` and `SANITY_ORGANIZATION_TOKEN` are read at runtime. The token must be an organization token with the Context permission; project tokens are refused with `403 contextGrantRequired`. The dynamic connection needs `instanceKey`; keep it a non-secret value.
- `agent/agent.ts` sets `defaultTools: false` so the agent answers only from Sanity.
- To change what the agent knows, change the endpoint in the Sanity Context app (its sources or its Instructions field), not this code.
- `apps/web/` is eve's generated Next.js web chat. Visitor-facing copy and the `showModel` note are in `apps/web/app/support-config.ts`. `vercel.ts` deploys the web chat and the agent as one project.
- `agent/channels/eve.ts` ends with `none()`, so the chat is public. Keep it only while the endpoint serves public content, and recommend a Vercel Firewall rate limit and an AI Gateway spend limit.
- After a change, run `pnpm typecheck` and `pnpm eval`.
