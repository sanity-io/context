import type {TelemetryIntegration} from 'ai'
import type {Telemetry} from 'ai-v7'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {makeClientStub} from '../../insights/clientStub'
import {sanityInsightsIntegration} from './telemetryIntegration'

function makeIntegration(config?: {
  metadata?: {mcpEndpoints: string}
  sharing?: {metrics?: boolean; conversations?: boolean; contact?: string}
}) {
  const {client, save} = makeClientStub()
  save.mockResolvedValue({threadId: 'thread-1'})
  const {onStart, onFinish, onEnd, onAbort, onError} = sanityInsightsIntegration({
    client,
    threadId: 'thread-1',
    ...config,
  })
  return {save, onStart, onFinish, onEnd, onAbort, onError}
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

  it('skips successful tool results and keeps failed ones with their error', async () => {
    const {save, onStart, onFinish} = makeIntegration()

    onStart({messages: [{role: 'user', content: 'Hi'}]})
    await onFinish({
      response: {
        messages: [
          {role: 'tool', content: [{result: 'some result'}]},
          {
            role: 'tool',
            content: [
              {toolName: 'search', output: {type: 'error-text', value: 'timeout'}},
              {toolName: 'fetch', output: {type: 'error-json', value: {code: 503}}},
            ],
          },
          {role: 'assistant', content: 'Done'},
        ],
      },
    })

    expect(savedMessages(save)).toEqual([
      {role: 'user', content: 'Hi'},
      {role: 'tool', toolName: 'search', toolType: 'result', content: null, error: 'timeout'},
      {role: 'tool', toolName: 'fetch', toolType: 'result', content: null, error: '{"code":503}'},
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

  it('is assignable to AI SDK v6 TelemetryIntegration and v7 Telemetry (compile-time contract)', () => {
    const {client} = makeClientStub()
    const v6: TelemetryIntegration = sanityInsightsIntegration({client, threadId: 't'})
    const v7: Telemetry = sanityInsightsIntegration({client, threadId: 't'})
    expect(v6.onStart).toBeDefined()
    expect(v7.onStart).toBeDefined()
  })

  it('saves a failed text generation as a failed turn, and nothing for other operations', async () => {
    const {save, onStart, onError} = makeIntegration()

    onStart({
      callId: 'obj',
      operationId: 'ai.generateObject',
      messages: [{role: 'user', content: 'x'}],
    })
    await onError({callId: 'obj', error: new Error('bad json')})
    expect(save).not.toHaveBeenCalled()

    onStart({
      callId: 'call-err',
      operationId: 'ai.streamText',
      messages: [{role: 'user', content: 'Hi'}],
    })
    await onError({callId: 'call-err', error: 'x'.repeat(30_000)})
    expect(savedMessages(save)).toEqual([
      {role: 'user', content: 'Hi'},
      {role: 'assistant', content: null, error: 'x'.repeat(20_000)},
    ])

    onStart({callId: 'call-err', messages: [{role: 'user', content: 'retry'}]})
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('skips the save for non-text operations that carry no response messages', async () => {
    const {save, onStart, onEnd} = makeIntegration()

    // v7 generateObject with messages: onStart carries the prompt, but the
    // end event has neither responseMessages nor response.messages
    onStart({callId: 'obj-1', messages: [{role: 'user', content: 'Extract data'}]})
    await onEnd({
      callId: 'obj-1',
      model: {provider: 'openai', modelId: 'gpt-4o'},
      usage: {inputTokens: 50, outputTokens: 20},
    })

    expect(save).not.toHaveBeenCalled()

    // and the pending entry was still cleaned up: reusing the callId doesn't warn
    onStart({callId: 'obj-1', messages: [{role: 'user', content: 'again'}]})
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('clears the pending entry on abort so the callId can be reused without warning', async () => {
    const {save, onStart, onEnd, onAbort} = makeIntegration()

    onStart({callId: 'call-a', messages: [{role: 'user', content: 'aborted turn'}]})
    onAbort({callId: 'call-a'})
    onStart({callId: 'call-a', messages: [{role: 'user', content: 'retry'}]})
    await onEnd({callId: 'call-a', responseMessages: [{role: 'assistant', content: 'reply'}]})

    expect(console.warn).not.toHaveBeenCalled()
    expect(savedMessages(save)).toEqual([
      {role: 'user', content: 'retry'},
      {role: 'assistant', content: 'reply'},
    ])
  })

  it('evicts the oldest pending entry with a warning once the cap is reached', async () => {
    const {save, onStart, onEnd} = makeIntegration()

    for (let i = 0; i < 1001; i++) {
      onStart({callId: `call-${i}`, messages: [{role: 'user', content: `turn ${i}`}]})
    }

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('evicting the oldest'))

    // call-0 was evicted: its input messages are gone, only the response saves
    await onEnd({
      callId: 'call-0',
      responseMessages: [{role: 'assistant', content: 'late reply'}],
    })
    expect(savedMessages(save)).toEqual([{role: 'assistant', content: 'late reply'}])

    // call-1 survived the eviction
    await onEnd({callId: 'call-1', responseMessages: [{role: 'assistant', content: 'reply 1'}]})
    expect(save.mock.calls[1]![0].messages).toEqual([
      {role: 'user', content: 'turn 1'},
      {role: 'assistant', content: 'reply 1'},
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
