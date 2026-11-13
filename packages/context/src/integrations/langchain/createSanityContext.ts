import {MCPAdapter} from '@langchain/mcp-adapters'
import {type AgentMiddleware, createMiddleware} from 'langchain'

import type {SanityContextOptions} from '../options'

/** @public */
export interface SanityContextLangChain {
  /**
   * Pass to `createAgent({middleware: [...]})` as the first entry: other middleware then sees the
   * Sanity tools, and a tool filter running before it could make LangChain reject them. Gives every
   * model call the endpoint's current tools.
   * Like any middleware that wraps tool calls, it makes LangChain rethrow tool errors; add LangChain's
   * `toolErrorMiddleware` to send them to the model instead.
   */
  middleware: AgentMiddleware
  close: () => Promise<void>
}

/**
 * Connects a LangChain agent to a Context MCP endpoint. Nothing is fetched until the agent runs.
 *
 * @public
 */
export function createSanityContext({url, token}: SanityContextOptions): SanityContextLangChain {
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
          timer = setTimeout(() => {
            // Later runs would otherwise wait on the same stuck connection attempt.
            void client.close()
            reject(new Error('Sanity Context did not list its tools within 10 seconds'))
          }, 10_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const warnedCollisions = new Set<string>()
  let shown = new Map<string, Awaited<ReturnType<typeof listTools>>[number]>()

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
      shown = new Map(tools.map((tool) => [tool.name, tool]))
      return handler({...request, tools: [...request.tools, ...tools]})
    },
    wrapToolCall: async (request, handler) => {
      // LangChain only knows the agent's own tools, so run the Sanity tool the model was shown. A run
      // resumed in a new process has seen no model call yet, so list the tools then.
      const name = request.toolCall.name
      const tool =
        request.tool ??
        shown.get(name) ??
        (await listTools().catch(() => [])).find((t) => t.name === name)
      return handler(tool ? {...request, tool} : request)
    },
  })

  return {middleware, close: () => client.close()}
}
