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

type Hook = (request: unknown, handler: (request: unknown) => Promise<unknown>) => Promise<unknown>

function hooks(sanity: ReturnType<typeof createSanityContext>) {
  return {
    wrapModelCall: sanity.middleware.wrapModelCall as unknown as Hook,
    wrapToolCall: sanity.middleware.wrapToolCall as unknown as Hook,
  }
}

beforeEach(() => {
  listTools.mockReset()
  listTools.mockResolvedValue([{name: 'groq_query'}, {name: 'initial_context'}])
})

afterEach(() => vi.restoreAllMocks())

describe('createSanityContext (LangChain)', () => {
  it('connects only when the agent runs', () => {
    createSanityContext(options)
    expect(listTools).not.toHaveBeenCalled()
  })

  it("adds the endpoint's current tools to every model call", async () => {
    const {wrapModelCall} = hooks(createSanityContext(options))
    const run = () =>
      wrapModelCall({tools: [{name: 'own'}]}, async (request) => request) as Promise<{
        tools: {name: string}[]
      }>
    expect((await run()).tools.map((t) => t.name)).toEqual(['own', 'groq_query', 'initial_context'])
    listTools.mockResolvedValue([{name: 'knowledge_base_search'}, {name: 'initial_context'}])
    expect((await run()).tools.map((t) => t.name)).toEqual([
      'own',
      'knowledge_base_search',
      'initial_context',
    ])
  })

  it('provides the implementation for a Sanity tool call in a fresh process', async () => {
    const {wrapToolCall} = hooks(createSanityContext(options))
    const sent = (await wrapToolCall(
      {toolCall: {name: 'groq_query'}, tool: undefined},
      async (request) => request,
    )) as {tool: {name: string}}
    expect(sent.tool.name).toBe('groq_query')
    expect(listTools).toHaveBeenCalledTimes(1)
  })

  it('skips Sanity tools whose name the agent already uses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {wrapModelCall} = hooks(createSanityContext(options))
    const sent = (await wrapModelCall(
      {tools: [{name: 'initial_context'}]},
      async (request) => request,
    )) as {tools: {name: string}[]}
    expect(sent.tools.map((t) => t.name)).toEqual(['initial_context', 'groq_query'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"initial_context"'))
  })

  it('runs the Sanity tool the model was shown without listing again', async () => {
    const sanity = createSanityContext(options)
    const {wrapModelCall, wrapToolCall} = hooks(sanity)
    await wrapModelCall({tools: []}, async (request) => request)
    const sent = (await wrapToolCall(
      {toolCall: {name: 'groq_query'}, tool: undefined},
      async (request) => request,
    )) as {tool: {name: string}}
    expect(sent.tool.name).toBe('groq_query')
    expect(listTools).toHaveBeenCalledTimes(1)
  })

  it('leaves an unknown tool to LangChain when listing fails', async () => {
    listTools.mockRejectedValue(new Error('HTTP 502'))
    const {wrapToolCall} = hooks(createSanityContext(options))
    const request = {toolCall: {name: 'made_up'}, tool: undefined}
    expect(await wrapToolCall(request, async (r) => r)).toBe(request)
  })

  it('fails the model call with a one-line message when listing fails', async () => {
    listTools.mockRejectedValue(
      new Error('Unauthorized (HTTP 401)\n    at classifyHttpError (x.js)'),
    )
    const {wrapModelCall} = hooks(createSanityContext(options))
    await expect(wrapModelCall({tools: []}, async (r) => r)).rejects.toThrow(
      /^Could not connect to Sanity Context: Unauthorized \(HTTP 401\)$/,
    )
  })

  it('fails the model call when listing hangs for 10 seconds', async () => {
    vi.useFakeTimers()
    listTools.mockReturnValue(new Promise(() => {}))
    const {wrapModelCall} = hooks(createSanityContext(options))
    const call = wrapModelCall({tools: []}, async (r) => r)
    vi.advanceTimersByTime(10_000)
    await expect(call).rejects.toThrow(
      'Could not connect to Sanity Context: Timed out after 10 seconds',
    )
    vi.useRealTimers()
  })
})
