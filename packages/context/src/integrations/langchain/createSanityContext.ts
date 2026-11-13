import {ToolMessage} from '@langchain/core/messages'
import {MCPAdapter} from '@langchain/mcp-adapters'
import {type AgentMiddleware, createMiddleware} from 'langchain'

import type {SanityContextOptions} from '../options'

/** @public */
export type SanityContextLangChainOptions = SanityContextOptions

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
  const listTools = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        client.listTools(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Sanity Context did not list its tools within 10 seconds')),
            10_000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const warnedCollisions = new Set<string>()

  const middleware = createMiddleware({
    name: 'SanityContext',
    wrapModelCall: async (request, handler) => {
      // LangChain rejects a middleware tool that shares a name with one of the agent's own tools.
      const taken = new Set(request.tools.map((t) => t.name))
      const tools = (await listTools()).filter((tool) => {
        if (!taken.has(tool.name)) return true
        if (!warnedCollisions.has(tool.name)) {
          warnedCollisions.add(tool.name)
          console.warn(
            `[sanity-context] Skipping the Sanity Context tool "${tool.name}": the agent already has a tool with that name.`,
          )
        }
        return false
      })
      return handler({...request, tools: [...request.tools, ...tools]})
    },
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
