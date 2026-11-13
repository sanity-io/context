import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const listToolsWithErrors = vi.fn()

vi.mock('@mastra/mcp', () => ({
  MCPClient: class {
    listToolsWithErrors = listToolsWithErrors
    disconnect = async () => {}
  },
}))

import {createSanityContext} from './createSanityContext'

const options = {
  url: 'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/s',
  token: 't',
}

beforeEach(() => {
  listToolsWithErrors.mockImplementation(async () => ({
    tools: {sanity_groq_query: {}, sanity_initial_context: {}},
    errors: {},
  }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createSanityContext', () => {
  it('fetches nothing until used', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    createSanityContext(options)
    expect(fetch).not.toHaveBeenCalled()
    expect(listToolsWithErrors).not.toHaveBeenCalled()
  })

  it('drops sanity_initial_context when the initial context is inlined', async () => {
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    const sanity = createSanityContext(options)
    expect(Object.keys(await sanity.tools())).toEqual(['sanity_groq_query'])
    expect(await sanity.initialContext()).toBe('# Schema')
  })

  it('keeps sanity_initial_context when the fetch fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('', {status: 502}))
    const sanity = createSanityContext(options)
    expect(Object.keys(await sanity.tools())).toEqual([
      'sanity_groq_query',
      'sanity_initial_context',
    ])
  })

  it('caches a successful fetch and retries a failed one', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', {status: 502}))
      .mockResolvedValue(new Response('# Schema'))
    vi.stubGlobal('fetch', fetch)
    const sanity = createSanityContext(options)
    expect(await sanity.initialContext()).toBeNull()
    expect(await sanity.initialContext()).toBe('# Schema')
    expect(await sanity.initialContext()).toBe('# Schema')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('throws when the connection fails', async () => {
    listToolsWithErrors.mockResolvedValue({tools: {}, errors: {sanity: 'HTTP 401'}})
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    await expect(createSanityContext(options).tools()).rejects.toThrow('HTTP 401')
  })
})
