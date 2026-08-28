import type {SanityClient} from '@sanity/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {makeClientStub} from './clientStub'
import {type ConversationSummary, getConversationsToClassify} from './getConversationsToClassify'

const summary: ConversationSummary = {
  threadId: 't1',
  messagesUpdatedAt: '2026-08-24T10:00:00Z',
  messageCount: 4,
  firstMessage: 'Hello',
}

describe('getConversationsToClassify', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs one pending-queue GROQ query with defaults and returns the rows', async () => {
    const {client, fetch} = makeClientStub()
    fetch.mockResolvedValue([summary])

    const result = await getConversationsToClassify({client})

    expect(result).toEqual([summary])
    expect(fetch).toHaveBeenCalledTimes(1)
    const [query, params] = fetch.mock.calls[0]!
    expect(query).toContain('!defined(classifiedAt)')
    expect(query).toContain('!defined(classificationError)')
    expect(query).toContain('count(messages) > 0')
    expect(query).toContain('[0...100]')
    expect(query).not.toContain('metadata.mcpEndpoints')
    expect(params).toEqual({organizationId: 'org-123', settledBefore: '2026-08-24T09:50:00.000Z'})
  })

  it('options shape the query: limit, settledForMinutes, and mcpEndpoint', async () => {
    const {client, fetch} = makeClientStub()
    fetch.mockResolvedValue([])

    await getConversationsToClassify({
      client,
      limit: 5,
      settledForMinutes: 30,
      mcpEndpoint: 'support-agent',
    })

    const [query, params] = fetch.mock.calls[0]!
    expect(query).toContain('[0...5]')
    expect(query).toContain('$mcpEndpoint in metadata.mcpEndpoints')
    expect(params).toEqual({
      organizationId: 'org-123',
      settledBefore: '2026-08-24T09:30:00.000Z',
      mcpEndpoint: 'support-agent',
    })
  })

  it('rejects invalid options before querying', async () => {
    const {client, fetch} = makeClientStub()

    await expect(getConversationsToClassify({client, limit: 3.5})).rejects.toThrow(
      'limit must be a positive integer',
    )
    await expect(getConversationsToClassify({client, settledForMinutes: -1})).rejects.toThrow(
      'settledForMinutes must be a non-negative number',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a client that is missing or unconfigured', async () => {
    const {client} = makeClientStub({organizationId: undefined})

    await expect(getConversationsToClassify({client})).rejects.toThrow(
      'the client must be configured with context.organizationId',
    )
    await expect(
      getConversationsToClassify({client: {} as unknown as SanityClient}),
    ).rejects.toThrow('options.client must be a configured Sanity client')
  })
})
