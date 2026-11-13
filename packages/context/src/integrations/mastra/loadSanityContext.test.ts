import {afterEach, describe, expect, it, vi} from 'vitest'

const listToolsWithErrors = vi.fn()

vi.mock('@mastra/mcp', () => ({
  MCPClient: class {
    listToolsWithErrors = listToolsWithErrors
    disconnect = async () => {}
  },
}))

import {loadSanityContext} from './loadSanityContext'

const options = {
  url: 'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/s',
  token: 't',
}

afterEach(() => vi.unstubAllGlobals())

describe('loadSanityContext', () => {
  it('drops sanity_initial_context when the initial context is inlined', async () => {
    listToolsWithErrors.mockResolvedValue({
      tools: {sanity_groq_query: {}, sanity_initial_context: {}},
      errors: {},
    })
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    const {tools, initialContext} = await loadSanityContext(options)
    expect(initialContext).toBe('# Schema')
    expect(Object.keys(tools)).toEqual(['sanity_groq_query'])
  })

  it('keeps sanity_initial_context when the fetch fails', async () => {
    listToolsWithErrors.mockResolvedValue({
      tools: {sanity_groq_query: {}, sanity_initial_context: {}},
      errors: {},
    })
    vi.stubGlobal('fetch', async () => new Response('', {status: 502}))
    const {tools} = await loadSanityContext(options)
    expect(Object.keys(tools)).toEqual(['sanity_groq_query', 'sanity_initial_context'])
  })

  it('throws when the connection fails', async () => {
    listToolsWithErrors.mockResolvedValue({tools: {}, errors: {sanity: 'HTTP 401'}})
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    await expect(loadSanityContext(options)).rejects.toThrow('HTTP 401')
  })
})
