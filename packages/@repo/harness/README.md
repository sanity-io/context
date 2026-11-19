# Harness

Runs `@sanity/context-eve` and `@sanity/context-langchain` end to end. Not published. Needs Node.js 24 and `openssl`.

```bash
pnpm harness langchain          # stub endpoint, scripted model
pnpm harness eve 502            # a fault scenario
pnpm harness check              # every scenario with its expected outcome (CI runs this)
pnpm harness eve --chat         # chat in the terminal, with a real model
pnpm harness --help             # all options
```

`--live`, `--model` and `--chat` read `SANITY_CONTEXT_MCP_URL`, `SANITY_CONTEXT_TOKEN` and `ANTHROPIC_API_KEY` from `.env` (see `.env.example`).

Each run writes `captures/<run>/`: `transcript.md` (what the model saw), every model request, and every endpoint request (`mcp.jsonl`). LangChain runs in-process. eve runs as a server built from `eve-agent/`, one build per run, because eve reads the extension's configuration at build time.
