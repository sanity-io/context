# Harness

Runs the framework packages (`@sanity/context-eve`, `@sanity/context-langchain`) end to end, against a stub Context MCP endpoint or a real one, with a scripted model or a real one. Not published.

Requires Node.js 24 and `openssl`.

```bash
pnpm harness langchain              # one run: stub endpoint, scripted model
pnpm harness eve 502                # a fault scenario
pnpm harness check                  # every scenario, with the checks CI runs
pnpm harness eve --chat             # chat with the agent in the terminal
pnpm harness langchain --live --model claude-haiku-5-5
```

Run from the repo root. `pnpm harness` builds the packages first.

## Modes

|                | Endpoint                                         | Model                                     |
| -------------- | ------------------------------------------------ | ----------------------------------------- |
| Default        | A fictional shop served by `src/stub.ts`         | Scripted: calls each Sanity tool in order |
| `--live`       | `SANITY_CONTEXT_MCP_URL`, `SANITY_CONTEXT_TOKEN` | Scripted                                  |
| `--model <id>` | Stub, or live with `--live`                      | Anthropic, with `ANTHROPIC_API_KEY`       |
| `--chat`       | Stub, or live with `--live`                      | Anthropic, `--model` or Sonnet            |

Copy `.env.example` to `.env` for the live and model modes. Git ignores `.env` and `captures/`.

`--questions <file>` takes a JSON array of questions, runs each one, and prints a table of the tools the model called. Use it with `--model` to see how a change affects model behavior.

## Scenarios

A proxy between the agent and the endpoint records every request and replaces some with faults: `502`, `500`, `401`, `400` and `reset` break a `groq_query` call; `list-400`, `list-401` and `list-502` break the second tool listing; `bad-token` rejects everything. `check` asserts what each package decides in these cases, such as the error text the model sees. Faults the framework handles itself aren't checked.

## Output

Each run writes to `captures/<mode>-<framework>-<scenario>/`:

- `transcript.md`: the system prompt, tools, and conversation the model saw last.
- `model-*.json`: every model request, verbatim.
- `mcp.jsonl`: every endpoint request and response.
- `eve.log`: the eve server's output.

The eve runs build their own copy of `eve-agent/`, because eve reads the extension's configuration when it builds the agent.
