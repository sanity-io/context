import {afterEach, describe, expect, it, vi} from 'vitest'

vi.mock('@langchain/mcp-adapters', () => ({
  MCPAdapter: class {
    listTools = async () => [{name: 'groq_query'}, {name: 'initial_context'}]
    close = async () => {}
  },
}))

import {loadSanityContext} from './loadSanityContext'

const options = {
  url: 'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/s',
  token: 't',
}

afterEach(() => vi.unstubAllGlobals())

describe('loadSanityContext', () => {
  it('drops initial_context when the initial context is inlined', async () => {
    vi.stubGlobal('fetch', async () => new Response('# Schema'))
    const {tools, initialContext} = await loadSanityContext(options)
    expect(initialContext).toBe('# Schema')
    expect(tools.map((t) => t.name)).toEqual(['groq_query'])
  })

  it('keeps initial_context when the fetch fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('', {status: 502}))
    const {tools, initialContext} = await loadSanityContext(options)
    expect(initialContext).toBeNull()
    expect(tools.map((t) => t.name)).toEqual(['groq_query', 'initial_context'])
  })
})
