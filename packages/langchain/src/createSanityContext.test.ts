import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const listTools = vi.fn()
const fetchMock = vi.fn()
const adapterConfigs: unknown[] = []

vi.mock('@langchain/mcp-adapters', () => ({
  MCPAdapter: class {
    constructor(config: unknown) {
      adapterConfigs.push(config)
    }
    listTools = listTools
    close = async () => {}
  },
  ToolException: class extends Error {},
}))

import {BaseChatModel} from '@langchain/core/language_models/chat_models'
import {AIMessage, SystemMessage, ToolMessage} from '@langchain/core/messages'
import {DynamicStructuredTool} from '@langchain/core/tools'
import {ToolException} from '@langchain/mcp-adapters'
import {createAgent} from 'langchain'

import {createSanityContext} from './createSanityContext'

/** Answers each model call with the next scripted message. */
class ScriptedModel extends BaseChatModel {
  replies: AIMessage[]
  constructor(replies: AIMessage[]) {
    super({})
    this.replies = replies
  }
  _llmType() {
    return 'scripted'
  }
  override bindTools() {
    return this
  }
  async _generate() {
    const message = this.replies.shift() ?? new AIMessage('Done.')
    return {generations: [{message, text: String(message.content)}]}
  }
}

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
  fetchMock.mockReset()
  fetchMock.mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createSanityContext (LangChain)', () => {
  it('refuses a URL that would send the token in clear text', () => {
    expect(() => createSanityContext({...options, url: 'http://api.sanity.io/x'})).toThrow(
      'Sanity Context needs an https URL.',
    )
  })

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

  it('adds the initial context to the system prompt and keeps the initial_context tool', async () => {
    fetchMock.mockResolvedValue(new Response('## Shop: Context'))
    const {wrapModelCall} = hooks(createSanityContext(options))
    const sent = (await wrapModelCall(
      {tools: [], systemMessage: new SystemMessage('You are a support agent.')},
      async (request) => request,
    )) as {tools: {name: string}[]; systemMessage: SystemMessage}
    expect(sent.systemMessage.content).toBe('You are a support agent.\n\n## Shop: Context')
    expect(sent.tools.map((t) => t.name)).toContain('initial_context')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`${options.url}/initial-context`)
    expect(init.headers).toEqual({Authorization: 'Bearer t'})
  })

  it('leaves the system prompt alone when the initial context fails to load', async () => {
    fetchMock.mockResolvedValue(new Response('nope', {status: 502}))
    const systemMessage = new SystemMessage('You are a support agent.')
    const {wrapModelCall} = hooks(createSanityContext(options))
    const sent = (await wrapModelCall({tools: [], systemMessage}, async (request) => request)) as {
      systemMessage: SystemMessage
    }
    expect(sent.systemMessage).toBe(systemMessage)
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

  it('lets LangChain tell the model which field an invalid input breaks', async () => {
    listTools.mockResolvedValue([
      new DynamicStructuredTool({
        name: 'groq_query',
        description: 'Run a GROQ query.',
        schema: {type: 'object', properties: {query: {type: 'string'}}, required: ['query']},
        func: async () => 'ok',
      }),
    ])
    const agent = createAgent({
      model: new ScriptedModel([
        new AIMessage({content: '', tool_calls: [{id: 'c1', name: 'groq_query', args: {}}]}),
      ]),
      middleware: [createSanityContext(options).middleware],
    })
    const {messages} = await agent.invoke({messages: [{role: 'user', content: 'Hi'}]})
    const result = messages.find((m) => ToolMessage.isInstance(m)) as ToolMessage
    expect(result.status).toBe('error')
    expect(result.content).toContain(
      'Details: #/required: Instance does not have required property "query".',
    )
    expect(messages.at(-1)?.content).toBe('Done.')
  })

  it('connects with the initialize handshake and no SSE fallback', () => {
    createSanityContext(options)
    expect(adapterConfigs.at(-1)).toMatchObject({
      servers: {sanity: {mode: 'legacy', automaticSSEFallback: false}},
    })
  })

  it('passes a tool the endpoint does not have to the next handler once it has listed', async () => {
    const {wrapModelCall, wrapToolCall} = hooks(createSanityContext(options))
    await wrapModelCall({tools: []}, async (r) => r)
    listTools.mockRejectedValue(new Error('HTTP 502'))
    const request = {toolCall: {id: 'c1', name: 'other_middleware_tool'}, tool: undefined}
    expect(await wrapToolCall(request, async (r) => r)).toBe(request)
    expect(listTools).toHaveBeenCalledTimes(1)
  })

  it('tells the model when listing fails during a tool call', async () => {
    listTools.mockRejectedValue(new Error('Unauthorized (HTTP 401)'))
    const {wrapToolCall} = hooks(createSanityContext(options))
    const sent = (await wrapToolCall(
      {toolCall: {id: 'c1', name: 'groq_query'}, tool: undefined},
      async (r) => r,
    )) as {content: string; status: string}
    expect(sent.status).toBe('error')
    expect(sent.content).toBe('Could not connect to Sanity Context: Unauthorized (HTTP 401)')
  })

  it('tells the model when a Sanity tool call fails', async () => {
    const {wrapToolCall} = hooks(createSanityContext(options))
    const sent = (await wrapToolCall(
      {toolCall: {id: 'c1', name: 'groq_query'}, tool: undefined},
      () => Promise.reject(new ToolException('Error calling tool groq_query: HTTP 502')),
    )) as {content: string; status: string}
    expect(sent.status).toBe('error')
    expect(sent.content).toBe('Error calling tool groq_query: HTTP 502')
  })

  it('gives the model the HTTP status and server message when a Sanity tool call fails', async () => {
    const {wrapToolCall} = hooks(createSanityContext(options))
    const body =
      '{"jsonrpc":"2.0","error":{"code":-32602,"message":"No schema deployed"},"id":null}'
    const cause = Object.assign(new Error(`Error POSTing to endpoint: ${body}`), {
      status: 400,
      data: {status: 400, text: body},
    })
    const failure = new ToolException('Error calling tool groq_query: SdkHttpError: …', {cause})
    const sent = (await wrapToolCall(
      {toolCall: {id: 'c1', name: 'groq_query'}, tool: undefined},
      () => Promise.reject(failure),
    )) as {content: string}
    expect(sent.content).toBe('Error calling tool groq_query: HTTP 400: No schema deployed')
  })

  it("keeps the adapter's message when the cause has no HTTP status", async () => {
    const {wrapToolCall} = hooks(createSanityContext(options))
    const failure = new ToolException(
      'Invalid arguments for MCP tool "groq_query": query is required',
      {
        cause: new Error('[\n  {"code": "invalid_type"}\n]'),
      },
    )
    const sent = (await wrapToolCall(
      {toolCall: {id: 'c1', name: 'groq_query'}, tool: undefined},
      () => Promise.reject(failure),
    )) as {content: string}
    expect(sent.content).toBe('Invalid arguments for MCP tool "groq_query": query is required')
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
