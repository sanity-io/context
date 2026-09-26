import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {makeClientStub} from '../../insights/clientStub'
import {sanityInsightsIntegration} from './telemetryIntegration'

function makeIntegration(config?: {
  metadata?: {mcpEndpoints: string}
  sharing?: {metrics?: boolean; conversations?: boolean; contact?: string}
}) {
  const {client, save} = makeClientStub()
  save.mockResolvedValue({threadId: 'thread-1'})
  const {onStart, onFinish, onEnd} = sanityInsightsIntegration({
    client,
    threadId: 'thread-1',
    ...config,
  })
  return {save, onStart, onFinish, onEnd}
}

function savedMessages(save: ReturnType<typeof vi.fn>) {
  return save.mock.calls[0]![0].messages as Array<{
    role: string
    content: string
    toolName?: string
    toolType?: string
  }>
}

describe('sanityInsightsIntegration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves the combined transcript with model info and computed token total', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: [{role: 'user', content: 'Question'}]})
    await onFinish({
      response: {messages: [{role: 'assistant', content: 'Answer'}]},
      model: {provider: 'openai', modelId: 'gpt-4o'},
      totalUsage: {inputTokens: 100, outputTokens: 50},
    })

    expect(save).toHaveBeenCalledExactlyOnceWith({
      threadId: 'thread-1',
      messages: [
        {role: 'user', content: 'Question'},
        {role: 'assistant', content: 'Answer'},
      ],
      modelProvider: 'openai',
      modelId: 'gpt-4o',
      tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
    })
  })

  it('prefers the event totalTokens over the computed sum', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: [{role: 'user', content: 'Q'}]})
    await onFinish({
      response: {messages: []},
      totalUsage: {inputTokens: 200, outputTokens: 100, totalTokens: 500},
    })

    expect(save.mock.calls[0]![0].tokenUsage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 500,
    })
  })

  it('passes metadata and sharing through to save', async () => {
    const {save, onStart, onFinish} = makeIntegration({
      metadata: {mcpEndpoints: 'support-agent'},
      sharing: {conversations: true, contact: 'me@acme.dev'},
    })

    onStart({messages: [{role: 'user', content: 'test'}]})
    await onFinish({response: {messages: []}})

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {mcpEndpoints: 'support-agent'},
        sharing: {conversations: true, contact: 'me@acme.dev'},
      }),
    )
  })

  it('joins array content from string and {text} parts', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: [{role: 'user', content: ['Hello', {text: 'World'}]}]})
    await onFinish({response: {messages: []}})

    expect(savedMessages(save)).toEqual([{role: 'user', content: 'Hello\nWorld'}])
  })

  it('splits tool calls out of mixed content and serializes their args', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: []})
    await onFinish({
      response: {
        messages: [
          {
            role: 'assistant',
            content: [{text: 'Let me search'}, {toolName: 'search', args: {q: 'test'}}],
          },
        ],
      },
    })

    expect(savedMessages(save)).toEqual([
      {role: 'assistant', content: 'Let me search'},
      {role: 'tool', toolName: 'search', toolType: 'call', content: '{"q":"test"}'},
    ])
  })

  it('skips tool result messages', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: [{role: 'user', content: 'Hi'}]})
    await onFinish({
      response: {
        messages: [
          {role: 'tool', content: [{result: 'some result'}]},
          {role: 'assistant', content: 'Done'},
        ],
      },
    })

    expect(savedMessages(save)).toEqual([
      {role: 'user', content: 'Hi'},
      {role: 'assistant', content: 'Done'},
    ])
  })

  it('normalizes odd input: unknown roles, null content, oversized and null tool args', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: [{role: 'unknown-role', content: null}]})
    await onFinish({
      response: {
        messages: [
          {
            role: 'assistant',
            content: [
              {toolName: 'big-tool', args: {data: 'x'.repeat(600)}},
              {toolName: 'null-tool', args: null},
            ],
          },
        ],
      },
    })

    const messages = savedMessages(save)
    expect(messages[0]).toEqual({role: 'assistant', content: 'null'})
    const bigTool = messages.find((m) => m.toolName === 'big-tool')!
    expect(bigTool.content).toMatch(/\.\.\.\(truncated\)$/)
    expect(bigTool.content.length).toBeLessThanOrEqual(500 + '...(truncated)'.length)
    expect(messages.find((m) => m.toolName === 'null-tool')!.content).toBe('')
  })

  it('resolves threadId functions at save time', async () => {
    const {client, save} = makeClientStub()
    save.mockResolvedValue({})
    const {onStart, onFinish} = sanityInsightsIntegration({client, threadId: () => 'thread-fn'})

    onStart({messages: [{role: 'user', content: 'test'}]})
    await onFinish({response: {messages: []}})

    expect(save).toHaveBeenCalledWith(expect.objectContaining({threadId: 'thread-fn'}))
  })

  it('skips save when no messages are collected', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: []})
    await onFinish({response: {messages: []}})

    expect(save).not.toHaveBeenCalled()
  })

  it('logs save errors without throwing', async () => {
    const {save, onStart, onFinish} = makeIntegration()
    save.mockRejectedValueOnce(new Error('network error'))

    onStart({messages: [{role: 'user', content: 'test'}]})
    await onFinish({response: {messages: [{role: 'assistant', content: 'reply'}]}})

    expect(console.error).toHaveBeenCalledWith(
      '[sanity-insights] Failed to save conversation:',
      expect.any(Error),
    )
  })

  it('saves the transcript via the v7 onEnd hook with responseMessages and usage', async () => {
    const {save, onStart, onEnd} = makeIntegration()

    onStart({callId: 'call-1', messages: [{role: 'user', content: 'Question'}]})
    await onEnd({
      callId: 'call-1',
      responseMessages: [{role: 'assistant', content: 'Answer'}],
      model: {provider: 'openai', modelId: 'gpt-4o'},
      usage: {inputTokens: 100, outputTokens: 50},
    })

    expect(save).toHaveBeenCalledExactlyOnceWith({
      threadId: 'thread-1',
      messages: [
        {role: 'user', content: 'Question'},
        {role: 'assistant', content: 'Answer'},
      ],
      modelProvider: 'openai',
      modelId: 'gpt-4o',
      tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
    })
  })

  it('prefers all-step responseMessages over the final-step response.messages', async () => {
    const {save, onStart, onEnd} = makeIntegration()

    onStart({messages: [{role: 'user', content: 'Q'}]})
    await onEnd({
      responseMessages: [
        {role: 'assistant', content: 'step 1'},
        {role: 'assistant', content: 'step 2'},
      ],
      response: {messages: [{role: 'assistant', content: 'step 2'}]},
    })

    expect(savedMessages(save)).toEqual([
      {role: 'user', content: 'Q'},
      {role: 'assistant', content: 'step 1'},
      {role: 'assistant', content: 'step 2'},
    ])
  })

  it('prefers all-step totalUsage over the final-step usage', async () => {
    const {save, onStart, onEnd} = makeIntegration()

    onStart({messages: [{role: 'user', content: 'Q'}]})
    await onEnd({
      responseMessages: [],
      totalUsage: {inputTokens: 300, outputTokens: 150},
      usage: {inputTokens: 100, outputTokens: 50},
    })

    expect(save.mock.calls[0]![0].tokenUsage).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
    })
  })

  it('isolates concurrent calls by callId without warning', async () => {
    const {save, onStart, onEnd} = makeIntegration()

    onStart({callId: 'call-a', messages: [{role: 'user', content: 'first'}]})
    onStart({callId: 'call-b', messages: [{role: 'user', content: 'second'}]})
    await onEnd({callId: 'call-a', responseMessages: [{role: 'assistant', content: 'reply a'}]})
    await onEnd({callId: 'call-b', responseMessages: [{role: 'assistant', content: 'reply b'}]})

    expect(console.warn).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[0]![0].messages).toEqual([
      {role: 'user', content: 'first'},
      {role: 'assistant', content: 'reply a'},
    ])
    expect(save.mock.calls[1]![0].messages).toEqual([
      {role: 'user', content: 'second'},
      {role: 'assistant', content: 'reply b'},
    ])
  })

  it('warns on instance reuse and keeps the latest input messages', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: [{role: 'user', content: 'first'}]})
    onStart({messages: [{role: 'user', content: 'second'}]})
    await onFinish({response: {messages: [{role: 'assistant', content: 'reply'}]}})

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Integration instance reused'),
    )
    expect(savedMessages(save)).toEqual([
      {role: 'user', content: 'second'},
      {role: 'assistant', content: 'reply'},
    ])
  })
})
