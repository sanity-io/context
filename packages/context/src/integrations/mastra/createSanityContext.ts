import {MCPClient} from '@mastra/mcp'

import {fetchInitialContext, type InitialContextOptions} from '../../initialContext'

/** @public */
export type SanityContextMastraOptions = InitialContextOptions

/** @public */
export interface SanityContextMastra {
  /** Pass as the agent's `tools`. Lists the endpoint's tools on every call. */
  tools: () => Promise<Awaited<ReturnType<MCPClient['listToolsWithErrors']>>['tools']>
  /** Use in the agent's `instructions`. Cached after the first successful fetch; `null` if it couldn't be fetched. */
  initialContext: () => Promise<string | null>
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

  let cached: Promise<string | null> | undefined
  const initialContext = () => {
    cached ??= fetchInitialContext(options).then(
      (text) => {
        if (text === null) cached = undefined
        return text
      },
      (error: unknown) => {
        cached = undefined
        throw error
      },
    )
    return cached
  }

  const tools = async () => {
    const [{tools: listed, errors}, inlined] = await Promise.all([
      client.listToolsWithErrors(),
      initialContext(),
    ])
    if (errors['sanity'])
      throw new Error(`Could not connect to Sanity Context: ${errors['sanity']}`)
    if (inlined) delete listed['sanity_initial_context']
    return listed
  }

  return {tools, initialContext, close: () => client.disconnect()}
}
