import {beforeEach, describe, expect, it, vi} from 'vitest'

const listToolsWithErrors = vi.fn()

vi.mock('@mastra/mcp', () => ({
  MCPClient: class {
    listToolsWithErrors = listToolsWithErrors
  },
}))

import {createSanityContext} from './createSanityContext'

type Tools = Awaited<ReturnType<ReturnType<typeof createSanityContext>['tools']>>
const modelOutput = (tools: Tools, output: unknown) =>
  (tools['sanity_groq_query'] as {toModelOutput?: (output: unknown) => unknown}).toModelOutput?.(
    output,
  )

const options = {
  url: 'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/s',
  token: 't',
}

beforeEach(() => {
  listToolsWithErrors.mockReset()
  listToolsWithErrors.mockResolvedValue({
    tools: {sanity_groq_query: {}},
    errorDetails: {},
  })
})

describe('createSanityContext (Mastra)', () => {
  it('refuses a URL that would send the token in clear text', () => {
    expect(() => createSanityContext({...options, url: 'http://api.sanity.io/x'})).toThrow(
      'Sanity Context needs an https URL.',
    )
  })

  it('connects only when the agent runs', () => {
    createSanityContext(options)
    expect(listToolsWithErrors).not.toHaveBeenCalled()
  })

  it("returns the endpoint's current tools on every run", async () => {
    const sanity = createSanityContext(options)
    expect(Object.keys(await sanity.tools())).toEqual(['sanity_groq_query'])
    listToolsWithErrors.mockResolvedValue({
      tools: {sanity_knowledge_base_search: {}},
      errorDetails: {},
    })
    expect(Object.keys(await sanity.tools())).toEqual(['sanity_knowledge_base_search'])
  })

  it('shows the model the text of a tool result', async () => {
    const tools = await createSanityContext(options).tools()
    const output = {content: [{type: 'text', text: '# Schema\n"post"'}]}
    expect(modelOutput(tools, output)).toEqual({
      type: 'text',
      value: '# Schema\n"post"',
    })
  })

  it("passes Mastra's own input validation errors through as JSON", async () => {
    const tools = await createSanityContext(options).tools()
    const output = {error: true, message: 'Tool input validation failed'}
    expect(modelOutput(tools, output)).toEqual({
      type: 'json',
      value: output,
    })
  })

  it('passes a value whose content is not MCP blocks through as JSON', async () => {
    const tools = await createSanityContext(options).tools()
    const output = {_id: 'post-1', content: [{_type: 'block', children: []}]}
    expect(modelOutput(tools, output)).toEqual({
      type: 'json',
      value: output,
    })
  })

  it('throws when the connection fails', async () => {
    listToolsWithErrors.mockResolvedValue({
      tools: {},
      errorDetails: {
        sanity: {
          httpStatus: 401,
          message: 'Error POSTing to endpoint: {"error":"Unauthorized","message":"Invalid token"}',
        },
      },
    })
    await expect(createSanityContext(options).tools()).rejects.toThrow(
      'Sanity Context rejected the token (HTTP 401: Invalid token). Use an organization API token with Context access.',
    )
  })

  it('throws when the endpoint is unreachable', async () => {
    listToolsWithErrors.mockResolvedValue({
      tools: {},
      errorDetails: {sanity: {message: 'fetch failed'}},
    })
    await expect(createSanityContext(options).tools()).rejects.toThrow(
      /^Could not connect to Sanity Context: fetch failed$/,
    )
  })
})
