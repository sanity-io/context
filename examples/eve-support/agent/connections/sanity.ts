import {defineDynamic, defineMcpClientConnection} from 'eve/connections'

import {route} from '../lib/rules'

// The Sanity Context search tools. The agent only gets them when the rules ask it to search;
// when the answer is already in the prompt, or the reply needs no lookup, it gets no tools.
export default defineDynamic(() => {
  if (!route.get().tools) return null
  const url = process.env.SANITY_CONTEXT_MCP_URL!
  return defineMcpClientConnection({
    url,
    description:
      "The company's products, policies and help articles. Look things up here before answering.",
    auth: {getToken: async () => ({token: process.env.SANITY_ORGANIZATION_TOKEN!})},
    // eve needs a stable, non-secret id for an authenticated dynamic connection: the endpoint's path.
    instanceKey: new URL(url).pathname,
  })
})
