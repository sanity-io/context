# Harness

Runs `@sanity/context-eve` and `@sanity/context-langchain` end to end. Not published. Needs Node.js 24 and `openssl`.

```bash
pnpm harness langchain          # stub endpoint, scripted model
pnpm harness eve 502            # a fault scenario
pnpm harness check              # every scenario with its expected outcome (CI runs this)
pnpm harness eve --chat         # chat in the terminal, with a real model
pnpm harness eve --live --model claude-haiku-5-5,claude-sonnet-5-5 --questions q.json --repeat 2
                                # compare models: tools called, steps, and the initial context received
pnpm harness --help             # all options
```

`--live` reads `SANITY_CONTEXT_MCP_URL` and `SANITY_CONTEXT_TOKEN`; `--model` and `--chat` read `ANTHROPIC_API_KEY`. Set them in `.env` (see `.env.example`).

Each run writes `captures/<run>/`: `transcript.md` (what the model saw), every model request, and every endpoint request (`mcp.jsonl`). LangChain runs in-process. eve runs as a server built from `eve-agent/`, one build per run, because eve reads the extension's configuration at build time.
