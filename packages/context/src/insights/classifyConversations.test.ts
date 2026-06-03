import {beforeEach, describe, expect, it, vi} from 'vitest'

import {classifyConversations} from './classifyConversations'

vi.mock('./getConversationsToClassify', () => ({
  getConversationsToClassify: vi.fn(),
}))

vi.mock('./getPreviousContentGaps', () => ({
  getPreviousContentGaps: vi.fn(),
}))

vi.mock('./classifyConversation', () => ({
  classifyConversation: vi.fn(),
}))

import {classifyConversation} from './classifyConversation'
import {getConversationsToClassify} from './getConversationsToClassify'
import {getPreviousContentGaps} from './getPreviousContentGaps'

const mockGetConversations = vi.mocked(getConversationsToClassify)
const mockGetGaps = vi.mocked(getPreviousContentGaps)
const mockClassify = vi.mocked(classifyConversation)

const mockClient = {} as never
const mockModel = {} as never

const makeConversation = (id: string) => ({
  _id: id,
  agentId: 'bot',
  threadId: `thread-${id}`,
  messages: [{role: 'user' as const, content: 'Hello'}],
  modelProvider: 'anthropic',
  modelId: 'claude-sonnet-4-5',
  tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
})

describe('classifyConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns zeros when no conversations to classify', async () => {
    mockGetConversations.mockResolvedValue([])
    mockGetGaps.mockResolvedValue([])

    const result = await classifyConversations({client: mockClient, model: mockModel})

    expect(result).toEqual({successCount: 0, errorCount: 0, totalFound: 0})
    expect(mockClassify).not.toHaveBeenCalled()
  })

  it('classifies all conversations and returns counts', async () => {
    const conversations = [makeConversation('1'), makeConversation('2'), makeConversation('3')]
    mockGetConversations.mockResolvedValue(conversations)
    mockGetGaps.mockResolvedValue(['billing info'])
    mockClassify.mockResolvedValue({
      coreMetrics: {successScore: 8, sentiment: 'positive', contentGaps: []},
      classifiedAt: new Date().toISOString(),
    })

    const result = await classifyConversations({client: mockClient, model: mockModel})

    expect(result).toEqual({successCount: 3, errorCount: 0, totalFound: 3})
    expect(mockClassify).toHaveBeenCalledTimes(3)
  })

  it('counts errors without throwing', async () => {
    const conversations = [makeConversation('1'), makeConversation('2')]
    mockGetConversations.mockResolvedValue(conversations)
    mockGetGaps.mockResolvedValue([])
    mockClassify
      .mockResolvedValueOnce({
        coreMetrics: {successScore: 8, sentiment: 'positive', contentGaps: []},
        classifiedAt: new Date().toISOString(),
      })
      .mockRejectedValueOnce(new Error('API error'))

    const result = await classifyConversations({client: mockClient, model: mockModel})

    expect(result).toEqual({successCount: 1, errorCount: 1, totalFound: 2})
  })

  it('passes options through to getConversationsToClassify', async () => {
    mockGetConversations.mockResolvedValue([])
    mockGetGaps.mockResolvedValue([])

    await classifyConversations({
      client: mockClient,
      model: mockModel,
      agentId: 'support-bot',
      limit: 100,
      cooldownMinutes: 30,
    })

    expect(mockGetConversations).toHaveBeenCalledWith({
      client: mockClient,
      agentId: 'support-bot',
      limit: 100,
      cooldownMinutes: 30,
    })
  })

  it('passes agentId to getPreviousContentGaps', async () => {
    mockGetConversations.mockResolvedValue([])
    mockGetGaps.mockResolvedValue([])

    await classifyConversations({
      client: mockClient,
      model: mockModel,
      agentId: 'support-bot',
    })

    expect(mockGetGaps).toHaveBeenCalledWith({
      client: mockClient,
      agentId: 'support-bot',
    })
  })

  it('passes model, telemetry, and previousContentGaps to classifyConversation', async () => {
    const conv = makeConversation('1')
    mockGetConversations.mockResolvedValue([conv])
    mockGetGaps.mockResolvedValue(['billing info', 'return policy'])
    mockClassify.mockResolvedValue({
      coreMetrics: {successScore: 8, sentiment: 'positive', contentGaps: []},
      classifiedAt: new Date().toISOString(),
    })

    const telemetry = {shareMetrics: true}
    await classifyConversations({client: mockClient, model: mockModel, telemetry})

    expect(mockClassify).toHaveBeenCalledWith({
      client: mockClient,
      conversationId: '1',
      model: mockModel,
      messages: conv.messages,
      modelProvider: conv.modelProvider,
      modelId: conv.modelId,
      tokenUsage: conv.tokenUsage,
      previousContentGaps: ['billing info', 'return policy'],
      telemetry,
    })
  })

  it('respects concurrency by batching', async () => {
    const conversations = Array.from({length: 7}, (_, i) => makeConversation(`${i}`))
    mockGetConversations.mockResolvedValue(conversations)
    mockGetGaps.mockResolvedValue([])

    mockClassify.mockImplementation(async () => {
      return {
        coreMetrics: {successScore: 8, sentiment: 'positive', contentGaps: []},
        classifiedAt: new Date().toISOString(),
      }
    })

    // Concurrency of 3 should process batches: [0,1,2], [3,4,5], [6]
    const result = await classifyConversations({
      client: mockClient,
      model: mockModel,
      concurrency: 3,
    })

    expect(result).toEqual({successCount: 7, errorCount: 0, totalFound: 7})
    expect(mockClassify).toHaveBeenCalledTimes(7)
  })
})
