import type {DynamicStructuredTool} from '@langchain/core/tools'
import {MCPAdapter} from '@langchain/mcp-adapters'

import {fetchInitialContext, type InitialContextOptions} from '../../initialContext'

/** @public */
export type SanityContextLangChainOptions = InitialContextOptions

/** @public */
export interface SanityContextLangChain {
  /** The endpoint's tools, discovered from the server. */
  tools: DynamicStructuredTool[]
  /** Add to the system prompt. `null` if it couldn't be fetched; the agent then keeps the `initial_context` tool. */
  initialContext: string | null
  close: () => Promise<void>
}

/**
 * Connects to a Context MCP endpoint and returns its tools and initial context for a LangChain agent.
 *
 * @public
 */
export async function loadSanityContext(
  options: SanityContextLangChainOptions,
): Promise<SanityContextLangChain> {
  const initialContext = await fetchInitialContext(options)
  const client = new MCPAdapter({
    prefixToolNameWithServerName: false,
    servers: {
      sanity: {
        transport: 'http',
        url: options.url,
        headers: {Authorization: `Bearer ${options.token}`},
      },
    },
  })
  const tools = (await client.listTools()).filter(
    (tool) => !(initialContext && tool.name === 'initial_context'),
  )
  return {tools, initialContext, close: () => client.close()}
}
