# @sanity/context-langchain

Sanity Context for [LangChain](https://js.langchain.com) agents. Connect a LangChain agent to a Context MCP endpoint. The agent gets the endpoint's current tools on every run, so changes to the endpoint's sources in the Context app reach it without a restart. The agent loads the initial context itself, through the `initial_context` tool.

It takes the endpoint URL and an organization API token with Context access (Viewer is enough). Keep the token server-side. Create one connector per endpoint and token, and reuse it across runs.

## Install

```bash
npm install @sanity/context-langchain langchain @langchain/core @langchain/langgraph @langchain/mcp-adapters @langchain/anthropic
```

Install the package for your model provider; the example uses `@langchain/anthropic`.

## Use it

```ts
import {createSanityContext} from '@sanity/context-langchain'
import {createAgent} from 'langchain'

const sanity = createSanityContext({
  url: process.env.SANITY_CONTEXT_MCP_URL!,
  token: process.env.SANITY_ORGANIZATION_TOKEN!,
})

const agent = createAgent({
  model: 'anthropic:claude-sonnet-5-5',
  systemPrompt: 'You are a support agent.',
  // First, so other middleware sees the Sanity tools.
  middleware: [sanity.middleware],
})
```

- Requires `langchain` 1.6 or later.
- Before every model call, the middleware lists the endpoint's tools, one request per step.
- A Sanity tool call that fails reaches the model as an error it can act on. Like any middleware that wraps tool calls, it makes LangChain rethrow errors from your own tools; add LangChain's `toolErrorMiddleware` to send those to the model.

## Errors

- A missing URL or token, or a URL that isn't https, throws when you create the connector.
- When the tools can't be listed, the agent run fails with `Could not connect to Sanity Context: …`, or `Sanity Context rejected the token …` for a 401 or 403.
- Tool results contain your content, so anyone who can edit that content can influence what the agent does.

See the [Sanity Context guide for LangChain](https://www.sanity.io/docs/context/connect-langchain) for setting up an endpoint and a token.
