import {createHash} from 'node:crypto'

import {MCPClient} from '@mastra/mcp'

import type {SanityContextOptions} from '../options'

/** @public */
export interface SanityContextMastra {
  /**
   * Pass as the agent's `tools`. Lists the endpoint's current tools on every run.
   *
   * Durable agents catch errors from `tools` and run with no tools, so a failure to reach Sanity
   * Context there doesn't fail the run.
   */
  tools: () => Promise<Awaited<ReturnType<MCPClient['listToolsWithErrors']>>['tools']>
  close: () => Promise<void>
}

/**
 * Connects a Mastra agent to a Context MCP endpoint. Nothing is fetched until the agent runs.
 *
 * @public
 */
export function createSanityContext({url, token}: SanityContextOptions): SanityContextMastra {
  const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 12)
  const client = new MCPClient({
    // Mastra replaces any client with the same id but a different config, so include the token.
    id: `sanity-context:${url}:${tokenHash}`,
    servers: {
      sanity: {
        url: new URL(url),
        requestInit: {headers: {Authorization: `Bearer ${token}`}},
        // A cold endpoint can take a few seconds on its first request; Mastra's default is 3.
        connectTimeout: 10_000,
      },
    },
    // The hooks exit the process on SIGTERM, cutting short the host app's own shutdown.
    registerProcessHooks: false,
  })
  return {
    tools: async () => {
      const {tools, errors} = await client.listToolsWithErrors({perServerTimeoutMs: 10_000})
      // The first line is the message; the rest can be a stack trace with node_modules paths.
      const error = errors['sanity']?.split('\n')[0]
      if (error) throw new Error(`Could not connect to Sanity Context: ${error}`)
      return tools
    },
    close: () => client.disconnect(),
  }
}
