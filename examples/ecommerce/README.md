# Ecommerce Example

A complete e-commerce demo with AI shopping assistant powered by Sanity Context MCP.

## Structure

- `app/` - Next.js frontend with AI chat integration
- `studio/` - Sanity Studio with product schemas

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials
2. Install dependencies: `pnpm install`
3. Deploy the schema: `pnpm --dir studio exec dotenv -e ../.env -- sanity schema deploy`
4. Create an MCP endpoint in the Context app in the Sanity Dashboard with your dataset as its content source, and put its URL in `SANITY_CONTEXT_MCP_URL`
5. Start the studio: `pnpm --dir studio dev`
6. Start the app, in a second terminal: `pnpm --dir app dev`

## About `_index.md`

The `_index.md` file in this directory is an **agent navigation file** for the `create-agent-with-sanity-context` skill. It provides a structured index that helps AI agents understand the codebase and find relevant files without loading everything into context.

This file is synced (along with the rest of this example) to `skills/create-agent-with-sanity-context/references/ecommerce/` via the `pnpm sync-skill-example` script. Human-facing README files are excluded from that sync.
