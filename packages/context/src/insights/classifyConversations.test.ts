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
import {makeClientStub} from './clientStub'
import {getConversationsToClassify} from './getConversationsToClassify'
import {getPreviousContentGaps} from './getPreviousContentGaps'

const mockGetConversations = vi.mocked(getConversationsToClassify)
const mockGetGaps = vi.mocked(getPreviousContentGaps)
const mockClassify = vi.mocked(classifyConversation)

const model = {} as never

const makeSummary = (threadId: string) => ({
  threadId,
  messagesUpdatedAt: '2026-08-24T10:00:00Z',
  messageCount: 4,
  firstMessage: 'Hello',
})

const classified = {
  coreMetrics: {successScore: 8, sentiment: 'positive' as const, contentGaps: []},
  classifiedAt: '2026-08-24T10:00:00Z',
}

describe('classifyConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns zeros without classifying when the queue is empty', async () => {
    const {client} = makeClientStub()
    mockGetConversations.mockResolvedValue([])
    mockGetGaps.mockResolvedValue([])

    const result = await classifyConversations({client, model})

    expect(result).toEqual({successCount: 0, errorCount: 0, totalFound: 0})
    expect(mockClassify).not.toHaveBeenCalled()
  })

  it('wires options through the primitives and counts successes and failures', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const {client} = makeClientStub()
    mockGetConversations.mockResolvedValue([
      makeSummary('t1'),
      makeSummary('t2'),
      makeSummary('t3'),
    ])
    mockGetGaps.mockResolvedValue(['billing info'])
    mockClassify
      .mockResolvedValueOnce(classified)
      .mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce(classified)

    const result = await classifyConversations({
      client,
      model,
      limit: 100,
      settledForMinutes: 30,
      mcpEndpoint: 'support-agent',
    })

    expect(result).toEqual({successCount: 2, errorCount: 1, totalFound: 3})
    expect(mockGetConversations).toHaveBeenCalledWith({
      client,
      limit: 100,
      settledForMinutes: 30,
      mcpEndpoint: 'support-agent',
    })
    expect(mockGetGaps).toHaveBeenCalledWith({client})
    expect(mockClassify).toHaveBeenCalledWith({
      client,
      threadId: 't1',
      model,
      previousContentGaps: ['billing info'],
    })
    consoleSpy.mockRestore()
  })

  it('never runs more than `concurrency` classifications at once', async () => {
    const {client} = makeClientStub()
    mockGetConversations.mockResolvedValue(Array.from({length: 7}, (_, i) => makeSummary(`t${i}`)))
    mockGetGaps.mockResolvedValue([])

    let inFlight = 0
    let maxInFlight = 0
    mockClassify.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return classified
    })

    const result = await classifyConversations({client, model, concurrency: 3})

    expect(result).toEqual({successCount: 7, errorCount: 0, totalFound: 7})
    expect(maxInFlight).toBe(3)
  })
})
