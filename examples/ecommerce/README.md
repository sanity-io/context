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

## Anonymous conversation sessions

Set `SANITY_CHAT_SESSION_SECRET` to 32 random bytes encoded as base64url (see `.env.example`). Keep it server-only and identical across app instances. Missing or malformed configuration disables chat session creation.

The chat transport bootstraps a signed, server-issued session cookie before sending messages. In production it is a Secure, HttpOnly, SameSite=Lax, host-only cookie on `/`; serve the app over HTTPS. Development uses a separate cookie name for local HTTP. Chat and bootstrap POSTs compare Origin with the HTTP Host and request URL scheme. Next may normalize the URL hostname, so it is not used as the authority when Host is present. Reverse proxies must preserve the public Host and scheme; forwarded-host headers are not trusted.

Insights thread IDs are derived on the server from the organization, verified anonymous session and browser chat ID. A browser-supplied ID alone cannot select another session's recorded conversation. Existing raw-ID conversations are not looked up or migrated. Session cookies expire after 24 hours. Losing the cookie or rotating the secret starts a new anonymous namespace. This is browser-session isolation, not account authentication or recovery, and a stolen valid cookie grants that session's access.

Simultaneous sends in one browser realm share initialization. Independent tabs making their first cookie-free bootstrap concurrently may receive different sessions; subsequent requests use the cookie currently held by the browser. This can split initial telemetry but cannot select an unrelated session by chat ID. Cross-device continuity requires an authenticated application identity. Snapshot replacement and concurrent snapshot ordering are unchanged.

Run session tests with `pnpm --dir app test:unit`.
