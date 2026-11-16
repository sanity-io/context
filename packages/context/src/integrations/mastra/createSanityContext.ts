import {createHash} from 'node:crypto'

import type {ToolsInput} from '@mastra/core/agent'
import {MCPClient} from '@mastra/mcp'

import {connectionError} from '../describeError'
import {type SanityContextOptions, validateOptions} from '../options'

/** @public */
export interface SanityContextMastra {
  /**
   * Pass as the agent's `tools`. Lists the endpoint's current tools on every run, prefixed with
   * `sanity_` (such as `sanity_initial_context`), and fails the run if they can't be listed.
   *
   * Set the agent's `defaultOptions.maxSteps` to 20 or more. Loading the initial context and then
   * querying takes several steps, and an agent that reaches the limit stops without an answer.
   *
   * A durable agent catches the error and runs without tools, so it answers without Sanity Context.
   */
  tools: () => Promise<ToolsInput>
  /**
   * Closes the connection to the endpoint. Optional: the process exits without it. Mastra keeps one
   * connection per endpoint and token for the whole process, so this also closes it for any other
   * instance with the same endpoint and token.
   */
  close: () => Promise<void>
}

/**
 * Connects a Mastra agent to a Context MCP endpoint. Nothing is fetched until the agent runs.
 * Create one per endpoint and token, for example at startup, and reuse it across runs.
 *
 * @public
 */
export function createSanityContext(options: SanityContextOptions): SanityContextMastra {
  validateOptions(options)
  const {url, token} = options
  const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 12)
  const client = new MCPClient({
    // Mastra replaces any client with the same id but a different config, so include the token.
    id: `sanity-context:${url}:${tokenHash}`,
    servers: {
      sanity: {
        url: new URL(url),
        requestInit: {headers: {Authorization: `Bearer ${token}`}},
        // A cold endpoint can take a few seconds on its first request; Mastra's default is 3.
        connectTimeout: 10_000,
      },
    },
    // The hooks exit the process on SIGTERM, cutting short the host app's own shutdown.
    registerProcessHooks: false,
  })
  return {
    tools: async () => {
      const {tools, errorDetails} = await client.listToolsWithErrors({perServerTimeoutMs: 10_000})
      const error = errorDetails['sanity']
      if (error) throw connectionError(error)
      // Without this, Mastra sends the model the whole MCP result as escaped JSON.
      for (const tool of Object.values(tools)) tool.toModelOutput ??= toText
      return tools
    },
    close: () => client.disconnect(),
  }
}

function toText(output: unknown) {
  // Mastra returns its own error object, not an MCP result, when the model's input fails the schema.
  const content = (output as {content?: {type?: unknown; text?: string}[]} | null)?.content
  if (!Array.isArray(content) || !content.every((block) => typeof block?.type === 'string'))
    return {type: 'json', value: output}
  const text = content.filter((block) => block.type === 'text').map((block) => block.text)
  return {type: 'text', value: text.join('\n')}
}
