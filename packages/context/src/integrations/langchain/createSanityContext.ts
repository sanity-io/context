import {ToolMessage} from '@langchain/core/messages'
import {MCPAdapter} from '@langchain/mcp-adapters'
import {type AgentMiddleware, createMiddleware} from 'langchain'

import type {InitialContextOptions} from '../../initialContext'
import {keepLastGood} from '../keepLastGood'

/** @public */
export type SanityContextLangChainOptions = Pick<InitialContextOptions, 'url' | 'token'>

/** @public */
export interface SanityContextLangChain {
  /**
   * Pass to `createAgent({middleware: [...]})`, first in the list so other middleware sees the Sanity
   * tools. Gives every model call the endpoint's current tools.
   */
  middleware: AgentMiddleware
  close: () => Promise<void>
}

/**
 * Connects a LangChain agent to a Context MCP endpoint. Nothing is fetched until the agent runs.
 *
 * @public
 */
export function createSanityContext({
  url,
  token,
}: SanityContextLangChainOptions): SanityContextLangChain {
  const client = new MCPAdapter({
    prefixToolNameWithServerName: false,
    servers: {sanity: {transport: 'http', url, headers: {Authorization: `Bearer ${token}`}}},
  })
  const listTools = keepLastGood('the Sanity Context tools', () => client.listTools())

  const middleware = createMiddleware({
    name: 'SanityContext',
    wrapModelCall: async (request, handler) =>
      handler({...request, tools: [...request.tools, ...(await listTools())]}),
    wrapToolCall: async (request, handler) => {
      // Tools are added per model call, so a run resumed in a new process looks them up here.
      const tool = request.tool ?? (await listTools()).find((t) => t.name === request.toolCall.name)
      try {
        return await handler(tool ? {...request, tool} : request)
      } catch (error) {
        // Middleware that wraps tool calls makes LangChain rethrow tool errors. Hand them to the
        // model instead, as LangChain does without middleware, but let interrupts through.
        if ((error as {is_bubble_up?: boolean}).is_bubble_up) throw error
        return new ToolMessage({
          name: request.toolCall.name,
          content: `${error}\n Please fix your mistakes.`,
          tool_call_id: request.toolCall.id ?? '',
          status: 'error',
        })
      }
    },
  })

  return {middleware, close: () => client.close()}
}
