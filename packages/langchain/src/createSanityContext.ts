import {MCPAdapter, ToolException} from '@langchain/mcp-adapters'
import {type AgentMiddleware, createMiddleware, ToolMessage} from 'langchain'

import {connectionError, describeError, httpError} from './describeError'
import {type SanityContextOptions, validateOptions} from './options'

/** @public */
export interface SanityContextLangChain {
  /**
   * Pass to `createAgent({middleware: [...]})` as the first entry, so other middleware sees the
   * Sanity tools. Before every model call it lists the endpoint's current tools, one request to the
   * endpoint per step, and the call fails if they can't be listed.
   *
   * Errors from the Sanity tools go to the model. Like any middleware that wraps tool calls, it
   * makes LangChain rethrow errors from the agent's own tools; add LangChain's
   * `toolErrorMiddleware` to send those to the model instead.
   */
  middleware: AgentMiddleware
  /** Closes the connection to the endpoint. Optional: the process exits without it. */
  close: () => Promise<void>
}

/**
 * Connects a LangChain agent to a Context MCP endpoint. Nothing is fetched until the agent runs.
 * Create one per endpoint and token, and reuse it across runs.
 *
 * @public
 */
export function createSanityContext(options: SanityContextOptions): SanityContextLangChain {
  validateOptions(options)
  const {url, token} = options
  const client = new MCPAdapter({
    prefixToolNameWithServerName: false,
    servers: {
      sanity: {
        transport: 'http',
        url,
        headers: {Authorization: `Bearer ${token}`},
        // The endpoint speaks the initialize handshake over streamable HTTP. Probing for newer
        // protocols and falling back to SSE costs requests and hides a 404 behind the SSE error.
        mode: 'legacy',
        automaticSSEFallback: false,
      },
    },
  })
  const listTools = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const tools = await Promise.race([
        client.listTools(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out after 10 seconds')), 10_000)
        }),
      ])
      // LangChain's own message for an invalid input then names the field and the rule it breaks.
      for (const tool of tools) tool.verboseParsingErrors = true
      return tools
    } catch (error) {
      throw connectionError(error)
    } finally {
      clearTimeout(timer)
    }
  }
  const initialContextUrl = new URL(url)
  initialContextUrl.pathname = `${initialContextUrl.pathname.replace(/\/$/, '')}/initial-context`
  let warnedInitialContext = false
  // Fetched on every model call, like the tools, so it's never stale. Null when it can't be: the
  // `initial_context` tool stays, and its description tells the model to call it first.
  const fetchInitialContext = async () => {
    try {
      const res = await fetch(initialContextUrl, {
        headers: {Authorization: `Bearer ${token}`},
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.text()) || null
    } catch (error) {
      if (!warnedInitialContext) {
        warnedInitialContext = true
        console.warn(
          `[sanity-context] Could not load the initial context, so the model loads it with the initial_context tool: ${(error as Error).message}`,
        )
      }
      return null
    }
  }
  const warnedCollisions = new Set<string>()
  let shown: Map<string, Awaited<ReturnType<typeof listTools>>[number]> | undefined

  const middleware = createMiddleware({
    name: 'SanityContext',
    wrapModelCall: async (request, handler) => {
      // LangChain rejects a middleware tool that shares a name with one of the agent's own tools.
      const taken = new Set(request.tools.map((t) => t.name))
      const [listed, initialContext] = await Promise.all([listTools(), fetchInitialContext()])
      const tools = listed.filter((tool) => {
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
      return handler({
        ...request,
        tools: [...request.tools, ...tools],
        ...(initialContext && {
          systemMessage: request.systemMessage.concat(`\n\n${initialContext}`),
        }),
      })
    },
    wrapToolCall: async (request, handler) => {
      // LangChain only knows the agent's own tools, so run the Sanity tool the model was shown. A run
      // resumed in a new process has seen no model call yet, so list the tools then. Any other name,
      // such as a tool another middleware adds, goes on to the next handler.
      if (request.tool) return handler(request)
      const name = request.toolCall.name
      // LangChain rethrows errors from tools a middleware runs, which would end the run.
      const toolError = (content: string) =>
        new ToolMessage({
          content,
          tool_call_id: request.toolCall.id ?? '',
          name,
          status: 'error',
        })
      if (!shown) {
        try {
          shown = new Map((await listTools()).map((tool) => [tool.name, tool]))
        } catch (error) {
          return toolError((error as Error).message)
        }
      }
      const tool = shown.get(name)
      if (!tool) return handler(request)
      try {
        return await handler({...request, tool})
      } catch (error) {
        if (!(error instanceof ToolException)) throw error
        const http = httpError(error)?.text
        return toolError(http ? `Error calling tool ${name}: ${http}` : describeError(error))
      }
    },
  })

  return {middleware, close: () => client.close()}
}
