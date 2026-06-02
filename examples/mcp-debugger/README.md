# MCP Debugger

A minimal chat UI for debugging a **Sanity Context MCP** server. You talk to an
agent that has the MCP's tools, and the UI shows **every tool call and its raw
JSON input/output** inline, plus the full conversation history. Use it to see
how the agent uses your MCP tools and to ask follow-up questions like
_"why did you query like that?"_.

No storefront, no Studio, no schemas — just the agent loop and a chat box.

## How it works

```
src/        Vite + React frontend (renders text + tool calls as JSON)
server/     Tiny Node server: connects to the MCP, runs streamText, streams back
```

The frontend posts to `/api/chat`, which Vite proxies to the local agent server.
The server connects to your MCP (`MCP_URL`) over HTTP, exposes its tools to the
model, and streams the result — including tool calls — using the AI SDK UI
Message Stream protocol.

A fresh MCP connection is opened per request and closed when the turn finishes.
Conversation state lives entirely in the browser and is replayed on each request.

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - `MCP_URL` — the Context MCP server to debug (must be reachable and serving HTTP)
   - `MCP_TOKEN` — bearer token, if your MCP requires auth (leave blank otherwise)
   - `ANTHROPIC_API_KEY` — your Anthropic key
   - `SYSTEM_PROMPT` — optional; mirror your production agent's prompt for realistic behavior
2. Install dependencies: `pnpm install`
3. Run it: `pnpm dev`

This starts both the agent server and the Vite frontend. Open the printed Vite
URL (default <http://localhost:5180>).

> **Note:** the agent only works if `MCP_URL` points at a server that is actually
> running and serving HTTP. If you get `fetch failed` / `ECONNRESET`, nothing is
> listening there — start your MCP server first.

## Debugging workflow

1. Ask something that exercises the tools: _"suggest 5 speakers for a conference on AI safety"_.
2. Expand the 🔧 tool-call boxes to see the exact tool name, input args, and raw output.
3. Ask a follow-up — _"why did you query like that?"_ — the agent can introspect
   its own prior tool calls because they're in the conversation history.
