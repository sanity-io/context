import {defineDynamic, defineMcpClientConnection} from 'eve/connections'

import extension from '../extension'
import {getInitialContext} from '../lib/initial-context'

export default defineDynamic(async (ctx) => {
  const inlined = (await getInitialContext(ctx)) !== null
  return defineMcpClientConnection({
    url: extension.config.url,
    description: 'Content from Sanity Context.',
    instanceKey: extension.config.url,
    auth: {getToken: async () => ({token: extension.config.token})},
    // The instructions already carry the initial context; keep the tool only as a fallback.
    ...(inlined ? {tools: {block: ['initial_context']}} : {}),
  })
})
