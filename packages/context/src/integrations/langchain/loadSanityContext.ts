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
  try {
    const [initialContext, tools] = await Promise.all([
      fetchInitialContext(options),
      client.listTools(),
    ])
    return {
      tools: initialContext ? tools.filter((tool) => tool.name !== 'initial_context') : tools,
      initialContext,
      close: () => client.close(),
    }
  } catch (error) {
    await client.close()
    throw error
  }
}
