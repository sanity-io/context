import type {DynamicStructuredTool} from '@langchain/core/tools'
import {MCPAdapter} from '@langchain/mcp-adapters'
import {type AgentMiddleware, createMiddleware} from 'langchain'

import {createInitialContextCache, type SanityContextOptions} from '../../sanityContextOptions'

/** @public */
export type SanityContextLangChainOptions = SanityContextOptions

/** @public */
export interface SanityContextLangChain {
  /**
   * Pass to `createAgent({middleware: [...]})`. Adds the endpoint's tools and, unless
   * `inlineInitialContext` is `false`, the initial context to every model call.
   */
  middleware: AgentMiddleware
  close: () => Promise<void>
}

/**
 * Connects a LangChain agent to a Context MCP endpoint. Nothing is fetched until the agent first runs.
 *
 * @public
 */
export function createSanityContext(
  options: SanityContextLangChainOptions,
): SanityContextLangChain {
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
  const getInitialContext =
    options.inlineInitialContext === false ? async () => null : createInitialContextCache(options)
  const toolsByName = new Map<string, DynamicStructuredTool>()

  const middleware = createMiddleware({
    name: 'SanityContext',
    wrapModelCall: async (request, handler) => {
      const [initialContext, tools] = await Promise.all([getInitialContext(), client.listTools()])
      // Either the initial context is in the prompt or the agent has the tool to load it, never both.
      const visible = initialContext ? tools.filter((t) => t.name !== 'initial_context') : tools
      for (const tool of visible) toolsByName.set(tool.name, tool)
      return handler({
        ...request,
        tools: [...request.tools, ...visible],
        systemMessage: initialContext
          ? request.systemMessage.concat(`\n\n${initialContext}`)
          : request.systemMessage,
      })
    },
    wrapToolCall: (request, handler) => {
      const tool = request.tool ?? toolsByName.get(request.toolCall.name)
      return handler(tool ? {...request, tool} : request)
    },
  })

  return {middleware, close: () => client.close()}
}
