import {beforeEach, describe, expect, it, vi} from 'vitest'

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
  listToolsWithErrors.mockReset()
  listToolsWithErrors.mockResolvedValue({tools: {sanity_groq_query: {}}, errors: {}})
})

describe('createSanityContext (Mastra)', () => {
  it('connects only when the agent runs', () => {
    createSanityContext(options)
    expect(listToolsWithErrors).not.toHaveBeenCalled()
  })

  it("returns the endpoint's current tools on every run", async () => {
    const sanity = createSanityContext(options)
    expect(Object.keys(await sanity.tools())).toEqual(['sanity_groq_query'])
    listToolsWithErrors.mockResolvedValue({tools: {sanity_knowledge_base_search: {}}, errors: {}})
    expect(Object.keys(await sanity.tools())).toEqual(['sanity_knowledge_base_search'])
  })

  it('throws when the connection fails', async () => {
    listToolsWithErrors.mockResolvedValue({tools: {}, errors: {sanity: 'HTTP 401'}})
    await expect(createSanityContext(options).tools()).rejects.toThrow('HTTP 401')
  })
})
