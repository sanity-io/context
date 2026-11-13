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
  })

  it('hands tool errors to the model and lets interrupts through', async () => {
    const {wrapToolCall} = hooks(createSanityContext(options))
    const request = {toolCall: {name: 'own', id: 'call_1'}, tool: {name: 'own'}}
    const result = (await wrapToolCall(request, async () => {
      throw new Error('own tool failed')
    })) as {content: string; status: string}
    expect(result.status).toBe('error')
    expect(result.content).toContain('own tool failed')
    const interrupt = Object.assign(new Error('interrupt'), {is_bubble_up: true})
    await expect(
      wrapToolCall(request, async () => {
        throw interrupt
      }),
    ).rejects.toBe(interrupt)
  })
})
