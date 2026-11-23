# @sanity/context-eve

Sanity Context for [eve](https://eve.dev) agents. This extension connects an eve agent to a Sanity Context MCP endpoint, so it can answer from your Sanity content.

The agent gets the endpoint's current tools on every run, so changes to the endpoint's sources in the Context app reach it without a redeploy. The extension fetches the endpoint's initial context once per session and adds it to the system prompt, so the model doesn't spend a tool call loading it.

## Install

```bash
npm install @sanity/context-eve
```

Requires eve 1.0 or later and Node.js 24 or later.

## Mount it

```ts
// agent/extensions/sanity-context.ts
import sanityContext from '@sanity/context-eve'

export default sanityContext({
  url: process.env.SANITY_CONTEXT_MCP_URL!,
  token: process.env.SANITY_ORGANIZATION_TOKEN!,
  description: "Acme's product catalog and support articles.",
})
```

| Option        | Description                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `url`         | The Context MCP endpoint URL. Must use https.                                                                 |
| `token`       | An organization API token with Context access. Keep it server-side.                                           |
| `description` | What the endpoint's content covers. The model reads it to decide when to use this connection, so be specific. |

eve reads the extension's configuration when it builds the agent, so set the environment variables in the build environment too.

## Notes

- eve shows a connection's tools to the model only after it searches for them. Tool names start with the mount's file name, so this example's tools are `sanity-context__sanity__initial_context`, `sanity-context__sanity__groq_query`, and so on.
- If the token is rejected, eve tells the model the connection needs authorization, and the run doesn't fail. The agent then answers without Sanity Context.
- The `initial_context` tool stays available as a safety net.
- Tool results contain your content, so anyone who can edit that content can influence what the agent does.

See the [Sanity Context guide for eve](https://www.sanity.io/docs/context/connect-vercel-eve) for setting up an endpoint and a token.
