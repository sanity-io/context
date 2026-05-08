import {describe, expect, it, vi} from 'vitest'

import {getConversationsToClassify} from './getConversationsToClassify'

const createMockClient = (fetchResult: unknown = []) => ({
  fetch: vi.fn().mockResolvedValue(fetchResult),
})

describe('getConversationsToClassify', () => {
  it('fetches all conversations by default (no limit)', async () => {
    const mockClient = createMockClient([])

    await getConversationsToClassify({
      client: mockClient as never,
    })

    expect(mockClient.fetch).toHaveBeenCalledTimes(1)
    const [query, params] = mockClient.fetch.mock.calls[0] as [string, Record<string, unknown>]
    // No slice clause when no limit
    expect(query).not.toMatch(/\[0\.\.\.\d+\]/)
    expect(params['agentId']).toBeNull()
  })

  it('applies limit when provided', async () => {
    const mockClient = createMockClient([])

    await getConversationsToClassify({
      client: mockClient as never,
      limit: 50,
    })

    const [query] = mockClient.fetch.mock.calls[0] as [string]
    expect(query).toContain('[0...50]')
  })

  it('passes agentId filter to query', async () => {
    const mockClient = createMockClient([])

    await getConversationsToClassify({
      client: mockClient as never,
      agentId: 'support-bot',
    })

    const [, params] = mockClient.fetch.mock.calls[0] as [string, Record<string, unknown>]
    expect(params['agentId']).toBe('support-bot')
  })

  it('returns conversations from fetch result', async () => {
    const mockConversations = [
      {
        _id: 'conv-1',
        agentId: 'bot',
        threadId: 'thread-1',
        messages: [{role: 'user', content: 'Hello'}],
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
      },
      {
        _id: 'conv-2',
        agentId: 'bot',
        threadId: 'thread-2',
        messages: [{role: 'user', content: 'Hi'}],
      },
    ]
    const mockClient = createMockClient(mockConversations)

    const result = await getConversationsToClassify({
      client: mockClient as never,
    })

    expect(result).toEqual(mockConversations)
  })

  it('includes correct type in query params', async () => {
    const mockClient = createMockClient([])

    await getConversationsToClassify({
      client: mockClient as never,
    })

    const [, params] = mockClient.fetch.mock.calls[0] as [string, Record<string, unknown>]
    expect(params['type']).toBe('sanity.agentContextConversation')
  })

  it('query filters for unclassified or updated conversations using messagesUpdatedAt', async () => {
    const mockClient = createMockClient([])

    await getConversationsToClassify({
      client: mockClient as never,
    })

    const [query] = mockClient.fetch.mock.calls[0] as [string]
    // Check that query includes the classification conditions
    expect(query).toContain('!defined(classifiedAt)')
    expect(query).toContain('classifiedAt <= messagesUpdatedAt')
    expect(query).toContain('defined(messagesUpdatedAt)')
    expect(query).toContain('messagesUpdatedAt <= $cooldownCutoff')
  })

  it('query orders by messagesUpdatedAt ascending', async () => {
    const mockClient = createMockClient([])

    await getConversationsToClassify({
      client: mockClient as never,
    })

    const [query] = mockClient.fetch.mock.calls[0] as [string]
    expect(query).toContain('order(messagesUpdatedAt asc)')
  })

  it('query includes model info fields in projection', async () => {
    const mockClient = createMockClient([])

    await getConversationsToClassify({
      client: mockClient as never,
    })

    const [query] = mockClient.fetch.mock.calls[0] as [string]
    expect(query).toContain('modelProvider')
    expect(query).toContain('modelId')
    expect(query).toContain('tokenUsage')
  })

  it('passes cooldownCutoff param based on cooldownMinutes', async () => {
    const mockClient = createMockClient([])
    const before = Date.now()

    await getConversationsToClassify({
      client: mockClient as never,
      cooldownMinutes: 30,
    })

    const after = Date.now()
    const [, params] = mockClient.fetch.mock.calls[0] as [string, Record<string, unknown>]
    const cutoff = new Date(params['cooldownCutoff'] as string).getTime()
    // cutoff should be ~30 minutes before now
    expect(cutoff).toBeGreaterThanOrEqual(before - 30 * 60 * 1000 - 100)
    expect(cutoff).toBeLessThanOrEqual(after - 30 * 60 * 1000 + 100)
  })

  it('defaults cooldownMinutes to 10', async () => {
    const mockClient = createMockClient([])
    const before = Date.now()

    await getConversationsToClassify({
      client: mockClient as never,
    })

    const after = Date.now()
    const [, params] = mockClient.fetch.mock.calls[0] as [string, Record<string, unknown>]
    const cutoff = new Date(params['cooldownCutoff'] as string).getTime()
    // cutoff should be ~10 minutes before now
    expect(cutoff).toBeGreaterThanOrEqual(before - 10 * 60 * 1000 - 100)
    expect(cutoff).toBeLessThanOrEqual(after - 10 * 60 * 1000 + 100)
  })

  it('throws if cooldownMinutes is negative', async () => {
    const mockClient = createMockClient([])

    await expect(
      getConversationsToClassify({
        client: mockClient as never,
        cooldownMinutes: -5,
      }),
    ).rejects.toThrow('cooldownMinutes must be a non-negative number')
  })

  it('throws if cooldownMinutes is NaN', async () => {
    const mockClient = createMockClient([])

    await expect(
      getConversationsToClassify({
        client: mockClient as never,
        cooldownMinutes: NaN,
      }),
    ).rejects.toThrow('cooldownMinutes must be a non-negative number')
  })

  it('throws if cooldownMinutes is Infinity', async () => {
    const mockClient = createMockClient([])

    await expect(
      getConversationsToClassify({
        client: mockClient as never,
        cooldownMinutes: Infinity,
      }),
    ).rejects.toThrow('cooldownMinutes must be a non-negative number')
  })

  it('throws if limit is not a positive integer', async () => {
    const mockClient = createMockClient([])

    await expect(
      getConversationsToClassify({
        client: mockClient as never,
        limit: 0,
      }),
    ).rejects.toThrow('limit must be a positive integer')

    await expect(
      getConversationsToClassify({
        client: mockClient as never,
        limit: -5,
      }),
    ).rejects.toThrow('limit must be a positive integer')

    await expect(
      getConversationsToClassify({
        client: mockClient as never,
        limit: 3.5,
      }),
    ).rejects.toThrow('limit must be a positive integer')
  })
})
