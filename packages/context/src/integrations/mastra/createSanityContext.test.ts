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

describe('createSanityContext (Mastra)', () => {
  it('fetches nothing until the agent runs', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    createSanityContext(options)
    expect(fetch).not.toHaveBeenCalled()
    expect(listToolsWithErrors).not.toHaveBeenCalled()
  })

  it('inlines the initial context and hides the tool', async () => {
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    const sanity = createSanityContext(options)
    expect(await sanity.instructions('Base.')()).toBe('Base.\n\n# Schema')
    expect(Object.keys(await sanity.tools())).toEqual(['sanity_groq_query'])
  })

  it('keeps the tool when the fetch fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('', {status: 502}))
    const sanity = createSanityContext(options)
    expect(await sanity.instructions('Base.')()).toBe('Base.')
    expect(Object.keys(await sanity.tools())).toEqual([
      'sanity_groq_query',
      'sanity_initial_context',
    ])
  })

  it('keeps the tool when our instructions are not used', async () => {
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    const sanity = createSanityContext(options)
    expect(Object.keys(await sanity.tools())).toEqual([
      'sanity_groq_query',
      'sanity_initial_context',
    ])
  })

  it('skips the fetch and keeps the tool when inlining is off', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const sanity = createSanityContext({...options, inlineInitialContext: false})
    expect(await sanity.instructions('Base.')()).toBe('Base.')
    expect(Object.keys(await sanity.tools())).toEqual([
      'sanity_groq_query',
      'sanity_initial_context',
    ])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws when the connection fails', async () => {
    listToolsWithErrors.mockResolvedValue({tools: {}, errors: {sanity: 'HTTP 401'}})
    await expect(createSanityContext(options).tools()).rejects.toThrow('HTTP 401')
  })
})
