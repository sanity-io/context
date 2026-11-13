import {MCPClient} from '@mastra/mcp'

import {createInitialContextCache, type SanityContextOptions} from '../../sanityContextOptions'

/** @public */
export type SanityContextMastraOptions = SanityContextOptions

/** @public */
export interface SanityContextMastra {
  /**
   * Pass as the agent's `instructions`, with your own instructions as the argument. Adds the initial
   * context unless `inlineInitialContext` is `false`. If you don't use it, the agent keeps the
   * `initial_context` tool instead.
   */
  instructions: (own: string) => () => Promise<string>
  /** Pass as the agent's `tools`. Lists the endpoint's tools on every call. */
  tools: () => Promise<Awaited<ReturnType<MCPClient['listToolsWithErrors']>>['tools']>
  close: () => Promise<void>
}

/**
 * Connects a Mastra agent to a Context MCP endpoint. Nothing is fetched until the agent first runs.
 *
 * @public
 */
export function createSanityContext(options: SanityContextMastraOptions): SanityContextMastra {
  const client = new MCPClient({
    id: `sanity-context:${options.url}`,
    servers: {
      sanity: {
        url: new URL(options.url),
        requestInit: {headers: {Authorization: `Bearer ${options.token}`}},
      },
    },
  })
  const getInitialContext =
    options.inlineInitialContext === false ? async () => null : createInitialContextCache(options)
  // Only hide the tool once our instructions are in use, so the agent never ends up with neither.
  let instructionsInUse = false

  const instructions = (own: string) => async () => {
    instructionsInUse = true
    const initialContext = await getInitialContext()
    return initialContext ? `${own}\n\n${initialContext}` : own
  }

  const tools = async () => {
    const [{tools: listed, errors}, initialContext] = await Promise.all([
      client.listToolsWithErrors(),
      instructionsInUse ? getInitialContext() : null,
    ])
    if (errors['sanity'])
      throw new Error(`Could not connect to Sanity Context: ${errors['sanity']}`)
    if (initialContext) delete listed['sanity_initial_context']
    return listed
  }

  return {instructions, tools, close: () => client.disconnect()}
}
