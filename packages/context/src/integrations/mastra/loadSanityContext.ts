import {MCPClient} from '@mastra/mcp'

import {fetchInitialContext, type InitialContextOptions} from '../../initialContext'

/** @public */
export type SanityContextMastraOptions = InitialContextOptions

/** @public */
export interface SanityContextMastra {
  /** The endpoint's tools, discovered from the server. */
  tools: Awaited<ReturnType<MCPClient['listToolsWithErrors']>>['tools']
  /** Add to the agent's instructions. `null` if it couldn't be fetched; the agent then keeps the `initial_context` tool. */
  initialContext: string | null
  close: () => Promise<void>
}

/**
 * Connects to a Context MCP endpoint and returns its tools and initial context for a Mastra agent.
 *
 * @public
 */
export async function loadSanityContext(
  options: SanityContextMastraOptions,
): Promise<SanityContextMastra> {
  const initialContext = await fetchInitialContext(options)
  const client = new MCPClient({
    servers: {
      sanity: {
        url: new URL(options.url),
        requestInit: {headers: {Authorization: `Bearer ${options.token}`}},
      },
    },
  })
  const {tools, errors} = await client.listToolsWithErrors()
  if (errors['sanity']) {
    await client.disconnect()
    throw new Error(`Could not connect to Sanity Context: ${errors['sanity']}`)
  }
  if (initialContext) delete tools['sanity_initial_context']
  return {tools, initialContext, close: () => client.disconnect()}
}
