import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {object: vi.fn(() => ({}))},
}))

import {generateText} from 'ai'

import {classifyConversation} from './classifyConversation'
import {makeClientStub} from './clientStub'

const mockGenerateText = vi.mocked(generateText)

const coreMetrics = {
  successScore: 8,
  sentiment: 'positive' as const,
  contentGaps: ['return policy'],
}

const defaultMessages = [
  {role: 'user', content: 'Hello'},
  {role: 'assistant', content: 'Hi there!'},
]

const model = 'mock-model' as never

describe('classifyConversation', () => {
  beforeEach(() => {
    mockGenerateText.mockResolvedValue({output: {coreMetrics}} as never)
  })

  afterEach(() => {
    mockGenerateText.mockReset()
  })

  it('records the verdict and returns the result', async () => {
    const {client, classify} = makeClientStub()
    classify.mockResolvedValue({threadId: 't1', classifiedAt: '2026-08-24T10:00:00Z'})

    const result = await classifyConversation({
      client,
      threadId: 't1',
      model,
      messages: defaultMessages,
    })

    expect(result).toEqual({coreMetrics, classifiedAt: '2026-08-24T10:00:00Z'})
    expect(classify).toHaveBeenCalledExactlyOnceWith({threadId: 't1', coreMetrics})
  })

  it('falls back to now when the classify response has no classifiedAt', async () => {
    const {client, classify} = makeClientStub()
    classify.mockResolvedValue({threadId: 't1'})

    const result = await classifyConversation({
      client,
      threadId: 't1',
      model,
      messages: defaultMessages,
    })

    expect(Number.isNaN(Date.parse(result.classifiedAt))).toBe(false)
  })

  it('fetches the transcript when messages are not provided and prompts with it', async () => {
    const {client, classify, get} = makeClientStub()
    get.mockResolvedValue({threadId: 't1', messages: defaultMessages})
    classify.mockResolvedValue({classifiedAt: '2026-08-24T10:00:00Z'})

    await classifyConversation({client, threadId: 't1', model, previousContentGaps: ['billing']})

    expect(get).toHaveBeenCalledWith({threadId: 't1'})
    const args = mockGenerateText.mock.calls[0]![0] as {prompt: string; system: string}
    expect(args.prompt).toContain('[User]: Hello')
    expect(args.prompt).toContain('[Assistant]: Hi there!')
    expect(args.system).toContain('Previously identified content gaps')
    expect(args.system).toContain('- billing')
  })

  it('throws without classifying when the transcript is missing or empty', async () => {
    const {client, classify, get} = makeClientStub()
    get.mockResolvedValue(null)

    await expect(classifyConversation({client, threadId: 't1', model})).rejects.toThrow(
      'Conversation has no messages: t1',
    )
    await expect(
      classifyConversation({client, threadId: 't1', model, messages: []}),
    ).rejects.toThrow('Conversation has no messages: t1')
    expect(classify).not.toHaveBeenCalled()
  })

  it('records a truncated classificationError and rethrows on model failure', async () => {
    const {client, classify} = makeClientStub()
    classify.mockResolvedValue({})
    mockGenerateText.mockRejectedValue(new Error('boom '.repeat(200)))

    await expect(
      classifyConversation({client, threadId: 't1', model, messages: defaultMessages}),
    ).rejects.toThrow('boom')

    const call = classify.mock.calls[0]![0] as {classificationError: string}
    expect(call.classificationError).toHaveLength(500)
  })

  it('rethrows the original error even when recording the failure fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const {client, classify} = makeClientStub()
    classify.mockRejectedValue(new Error('storage down'))
    mockGenerateText.mockRejectedValue(new Error('model exploded'))

    await expect(
      classifyConversation({client, threadId: 't1', model, messages: defaultMessages}),
    ).rejects.toThrow('model exploded')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('throws if threadId is empty', async () => {
    const {client} = makeClientStub()

    await expect(
      classifyConversation({client, threadId: '', model, messages: defaultMessages}),
    ).rejects.toThrow('threadId must be a non-empty string')
  })
})
