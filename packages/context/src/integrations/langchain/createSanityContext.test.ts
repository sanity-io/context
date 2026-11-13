import {SystemMessage} from '@langchain/core/messages'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const listTools = vi.fn()

vi.mock('@langchain/mcp-adapters', () => ({
  MCPAdapter: class {
    listTools = listTools
    close = async () => {}
  },
}))

import {createSanityContext} from './createSanityContext'

const options = {
  url: 'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/s',
  token: 't',
}

type Request = {tools: {name: string}[]; systemMessage: SystemMessage}

async function runModelCall(sanity: ReturnType<typeof createSanityContext>) {
  const handler = vi.fn(async (request: Request) => request)
  const wrap = sanity.middleware.wrapModelCall as unknown as (
    request: Request,
    handler: (request: Request) => Promise<Request>,
  ) => Promise<Request>
  await wrap({tools: [], systemMessage: new SystemMessage('Base.')}, handler)
  const sent = handler.mock.calls[0]![0]
  return {tools: sent.tools.map((t) => t.name), prompt: sent.systemMessage.content}
}

beforeEach(() => {
  listTools.mockResolvedValue([{name: 'groq_query'}, {name: 'initial_context'}])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createSanityContext (LangChain)', () => {
  it('fetches nothing until the agent runs', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    createSanityContext(options)
    expect(fetch).not.toHaveBeenCalled()
    expect(listTools).not.toHaveBeenCalled()
  })

  it('inlines the initial context and hides the tool', async () => {
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    expect(await runModelCall(createSanityContext(options))).toEqual({
      tools: ['groq_query'],
      prompt: 'Base.\n\n# Schema',
    })
  })

  it('keeps the tool and leaves the prompt alone when the fetch fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('', {status: 502}))
    expect(await runModelCall(createSanityContext(options))).toEqual({
      tools: ['groq_query', 'initial_context'],
      prompt: 'Base.',
    })
  })

  it('skips the fetch and keeps the tool when inlining is off', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(
      await runModelCall(createSanityContext({...options, inlineInitialContext: false})),
    ).toEqual({
      tools: ['groq_query', 'initial_context'],
      prompt: 'Base.',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('provides the implementation for a Sanity tool call', async () => {
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    const sanity = createSanityContext(options)
    await runModelCall(sanity)
    const handler = vi.fn(async (request: unknown) => request)
    const wrap = sanity.middleware.wrapToolCall as unknown as (
      request: unknown,
      handler: (request: unknown) => Promise<unknown>,
    ) => Promise<{tool: {name: string}}>
    const sent = await wrap({toolCall: {name: 'groq_query'}, tool: undefined}, handler)
    expect(sent.tool.name).toBe('groq_query')
  })
})
