import {describe, expect, it} from 'vitest'

import {buildTelemetryPayload} from './sendInsightsTelemetry'

describe('buildTelemetryPayload', () => {
  const baseCoreMetrics = {
    successScore: 8,
    sentiment: 'positive' as const,
    contentGaps: ['pricing info', 'return policy'],
  }

  const baseConversation = {
    messages: [
      {role: 'user', content: 'How much does it cost?'},
      {role: 'assistant', content: 'Let me check that for you.'},
      {role: 'tool', content: '{"price": 99}', toolName: 'lookup'},
    ],
  }

  it('builds metadata-only payload with message metadata but no content', () => {
    const payload = buildTelemetryPayload(
      'conv-123',
      '2025-01-01T00:00:00Z',
      'project-abc',
      baseCoreMetrics,
      baseConversation,
      {enabled: true},
    )

    expect(payload.coreMetrics).toEqual({
      successScore: 8,
      sentiment: 'positive',
      contentGapCount: 2,
    })
    expect(payload.conversation.messages).toHaveLength(3)
    expect(payload.conversation.messages[0]).toEqual({
      role: 'user',
      bytes: expect.any(Number),
    })
    expect(payload.conversation.messages[2]).toEqual({
      role: 'tool',
      bytes: expect.any(Number),
      toolName: 'lookup',
    })
    // No message contents in tier B
    expect(payload.conversation.messageContents).toBeUndefined()
    expect(payload.context.totalBytes).toBeGreaterThan(0)
    expect(payload.context.estimatedTokens).toBe(Math.round(payload.context.totalBytes / 4))
    expect(payload.projectId).toBe('project-abc')
    expect(payload.conversationId).toBe('conv-123')
    expect(payload.classifiedAt).toBe('2025-01-01T00:00:00Z')
  })

  it('builds full sharing payload with message contents and contact handle', () => {
    const payload = buildTelemetryPayload(
      'conv-123',
      '2025-01-01T00:00:00Z',
      'project-abc',
      baseCoreMetrics,
      baseConversation,
      {enabled: true, shareConversations: {enabled: true, contactHandle: '@testuser'}},
    )

    expect(payload.conversation.messageContents).toHaveLength(3)
    expect(payload.conversation.messageContents![0]).toEqual({
      role: 'user',
      content: 'How much does it cost?',
    })
    expect(payload.conversation.messageContents![2]).toEqual({
      role: 'tool',
      content: '{"price": 99}',
      toolName: 'lookup',
    })
    expect(payload.shareConversations).toEqual({contactHandle: '@testuser'})
  })

  it('includes model info when available', () => {
    const payload = buildTelemetryPayload(
      'conv-123',
      '2025-01-01T00:00:00Z',
      'project-abc',
      baseCoreMetrics,
      {
        ...baseConversation,
        modelProvider: 'openai',
        modelId: 'gpt-4o',
        tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
      },
      {enabled: true},
    )

    expect(payload.model).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o',
      tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
    })
  })

  it('omits model field when no model info is available', () => {
    const payload = buildTelemetryPayload(
      'conv-123',
      '2025-01-01T00:00:00Z',
      'project-abc',
      baseCoreMetrics,
      baseConversation,
      {enabled: true},
    )

    expect(payload.model).toBeUndefined()
  })

  it('handles empty content gaps', () => {
    const payload = buildTelemetryPayload(
      'conv-123',
      '2025-01-01T00:00:00Z',
      'project-abc',
      {...baseCoreMetrics, contentGaps: []},
      baseConversation,
      {enabled: true},
    )

    expect(payload.coreMetrics.contentGapCount).toBe(0)
  })

  it('handles messages with no content', () => {
    const payload = buildTelemetryPayload(
      'conv-123',
      '2025-01-01T00:00:00Z',
      'project-abc',
      baseCoreMetrics,
      {messages: [{role: 'user'}]},
      {enabled: true},
    )

    expect(payload.conversation.messages[0]!.bytes).toBe(0)
  })
})
