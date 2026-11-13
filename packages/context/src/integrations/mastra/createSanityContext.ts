import {createHash} from 'node:crypto'

import {MCPClient} from '@mastra/mcp'

import type {SanityContextOptions} from '../options'

/** @public */
export type SanityContextMastraOptions = SanityContextOptions

/** @public */
export interface SanityContextMastra {
  /** Pass as the agent's `tools`. Lists the endpoint's current tools on every run. */
  tools: () => Promise<Awaited<ReturnType<MCPClient['listToolsWithErrors']>>['tools']>
  close: () => Promise<void>
}

/**
 * Connects a Mastra agent to a Context MCP endpoint. Nothing is fetched until the agent runs.
 *
 * @public
 */
export function createSanityContext({url, token}: SanityContextMastraOptions): SanityContextMastra {
  const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 12)
  const client = new MCPClient({
    // Mastra replaces any client with the same id but a different config, so include the token.
    id: `sanity-context:${url}:${tokenHash}`,
    servers: {
      sanity: {url: new URL(url), requestInit: {headers: {Authorization: `Bearer ${token}`}}},
    },
    // The hooks exit the process on SIGTERM, cutting short the host app's own shutdown.
    registerProcessHooks: false,
  })
  return {
    tools: async () => {
      const {tools, errors} = await client.listToolsWithErrors({perServerTimeoutMs: 10_000})
      if (errors['sanity'])
        throw new Error(`Could not connect to Sanity Context: ${errors['sanity']}`)
      return tools
    },
    close: () => client.disconnect(),
  }
}
