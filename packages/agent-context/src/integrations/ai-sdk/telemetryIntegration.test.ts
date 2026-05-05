import {beforeEach, describe, expect, it, vi} from 'vitest'

import {sanityInsightsIntegration} from './telemetryIntegration'

// Mock saveConversation
vi.mock('../../insights/saveConversation', () => ({
  saveConversation: vi.fn().mockResolvedValue('doc-id'),
}))

import {saveConversation} from '../../insights/saveConversation'

const mockSaveConversation = vi.mocked(saveConversation)

function createMockClient() {
  return {} as never
}

/** Helper to extract onStart/onFinish from the bound integration */
function getHandlers(integration: ReturnType<typeof sanityInsightsIntegration>) {
  // bindTelemetryIntegration wraps the integration — the returned object has onStart/onFinish
  return integration as unknown as {
    onStart: (event: {messages?: Array<{role: string; content: unknown}>}) => void
    onFinish: (event: {
      response: {messages?: Array<{role: string; content: unknown}>}
      model?: {provider: string; modelId: string}
      totalUsage?: {inputTokens?: number; outputTokens?: number; totalTokens?: number}
    }) => Promise<void>
  }
}

const defaultFinishEvent = {
  model: {provider: 'openai', modelId: 'gpt-4o'},
  totalUsage: {inputTokens: 100, outputTokens: 50},
}

describe('sanityInsightsIntegration', () => {
  beforeEach(() => {
    mockSaveConversation.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('message collection', () => {
    it('collects simple string content messages', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({
        messages: [{role: 'user', content: 'Hello'}],
      })
      await onFinish({
        response: {messages: [{role: 'assistant', content: 'Hi there!'}]},
      })

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {role: 'user', content: 'Hello'},
            {role: 'assistant', content: 'Hi there!'},
          ],
        }),
      )
    })

    it('joins array content with text parts', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({
        messages: [{role: 'user', content: ['Hello', 'World']}],
      })
      await onFinish({response: {messages: []}})

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{role: 'user', content: 'Hello\nWorld'}],
        }),
      )
    })

    it('extracts text from {text: "..."} object parts', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({
        messages: [{role: 'assistant', content: [{text: 'Part A'}, {text: 'Part B'}]}],
      })
      await onFinish({response: {messages: []}})

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{role: 'assistant', content: 'Part A\nPart B'}],
        }),
      )
    })

    it('extracts tool calls with toolName, toolType, and serialized args', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: []})
      await onFinish({
        response: {
          messages: [
            {
              role: 'assistant',
              content: [{toolName: 'search', args: {query: 'shoes'}}],
            },
          ],
        },
      })

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'tool',
              toolName: 'search',
              toolType: 'call',
              content: '{"query":"shoes"}',
            },
          ],
        }),
      )
    })

    it('skips tool result messages', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({
        messages: [{role: 'user', content: 'Hi'}],
      })
      await onFinish({
        response: {
          messages: [
            {role: 'tool', content: [{result: 'some result'}]},
            {role: 'assistant', content: 'Done'},
          ],
        },
      })

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {role: 'user', content: 'Hi'},
            {role: 'assistant', content: 'Done'},
          ],
        }),
      )
    })

    it('splits mixed content: text parts + tool calls in same message', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: []})
      await onFinish({
        response: {
          messages: [
            {
              role: 'assistant',
              content: [{text: 'Let me search for that'}, {toolName: 'search', args: {q: 'test'}}],
            },
          ],
        },
      })

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {role: 'assistant', content: 'Let me search for that'},
            {role: 'tool', toolName: 'search', toolType: 'call', content: '{"q":"test"}'},
          ],
        }),
      )
    })

    it('handles null content by serializing it', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({
        messages: [{role: 'user', content: null}],
      })
      await onFinish({response: {messages: []}})

      const savedMessages = mockSaveConversation.mock.calls[0]![0].messages
      // null goes through formatTextPart → JSON.stringify(null) → "null"
      expect(savedMessages[0]).toEqual({role: 'user', content: 'null'})
    })

    it('defaults unknown roles to assistant', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({
        messages: [{role: 'unknown-role', content: 'test'}],
      })
      await onFinish({response: {messages: []}})

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{role: 'assistant', content: 'test'}],
        }),
      )
    })
  })

  describe('content serialization', () => {
    it('truncates large tool args at 500 chars with suffix', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      const largeArgs = {data: 'x'.repeat(600)}
      onStart({messages: []})
      await onFinish({
        response: {
          messages: [{role: 'assistant', content: [{toolName: 'big-tool', args: largeArgs}]}],
        },
      })

      const savedMessages = mockSaveConversation.mock.calls[0]![0].messages
      const toolMsg = savedMessages.find((m) => m.toolName === 'big-tool')
      expect(toolMsg!.content.length).toBeLessThanOrEqual(500 + '...(truncated)'.length)
      expect(toolMsg!.content).toMatch(/\.\.\.\(truncated\)$/)
    })

    it('serializes null tool args as empty string', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: []})
      await onFinish({
        response: {
          messages: [{role: 'assistant', content: [{toolName: 'nulltool', args: null}]}],
        },
      })

      const savedMessages = mockSaveConversation.mock.calls[0]![0].messages
      const toolMsg = savedMessages.find((m) => m.toolName === 'nulltool')
      // serializeContent(null) returns '' because null check is first
      expect(toolMsg!.content).toBe('')
    })
  })

  describe('integration lifecycle', () => {
    it('onStart captures input, onFinish combines with response and saves', async () => {
      const client = createMockClient()
      const integration = sanityInsightsIntegration({
        client,
        agentId: 'my-agent',
        threadId: 'my-thread',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: [{role: 'user', content: 'Question'}]})
      await onFinish({
        response: {messages: [{role: 'assistant', content: 'Answer'}]},
        ...defaultFinishEvent,
      })

      expect(mockSaveConversation).toHaveBeenCalledWith({
        client,
        agentId: 'my-agent',
        threadId: 'my-thread',
        messages: [
          {role: 'user', content: 'Question'},
          {role: 'assistant', content: 'Answer'},
        ],
        modelProvider: 'openai',
        modelId: 'gpt-4o',
        tokenUsage: {inputTokens: 100, outputTokens: 50, totalTokens: 150},
      })
    })

    it('passes model info and token usage to saveConversation', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: [{role: 'user', content: 'test'}]})
      await onFinish({
        response: {messages: [{role: 'assistant', content: 'reply'}]},
        model: {provider: 'anthropic', modelId: 'claude-sonnet-4-20250514'},
        totalUsage: {inputTokens: 200, outputTokens: 100},
      })

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          modelProvider: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
          tokenUsage: {inputTokens: 200, outputTokens: 100, totalTokens: 300},
        }),
      )
    })

    it('prefers totalTokens from event over computed sum', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: [{role: 'user', content: 'test'}]})
      await onFinish({
        response: {messages: [{role: 'assistant', content: 'reply'}]},
        model: {provider: 'anthropic', modelId: 'claude-sonnet-4-20250514'},
        totalUsage: {inputTokens: 200, outputTokens: 100, totalTokens: 500},
      })

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenUsage: {inputTokens: 200, outputTokens: 100, totalTokens: 500},
        }),
      )
    })

    it('resolves agentId/threadId functions at save time', async () => {
      let callCount = 0
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: () => `agent-${++callCount}`,
        threadId: () => `thread-${callCount}`,
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: [{role: 'user', content: 'test'}]})
      await onFinish({response: {messages: []}})

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          threadId: 'thread-1',
        }),
      )
    })

    it('catches and logs save errors without throwing', async () => {
      mockSaveConversation.mockRejectedValueOnce(new Error('network error'))

      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: [{role: 'user', content: 'test'}]})
      // Should not throw
      await onFinish({response: {messages: [{role: 'assistant', content: 'reply'}]}})

      expect(console.error).toHaveBeenCalledWith(
        '[sanity-insights] Failed to save conversation:',
        expect.any(Error),
      )
    })

    it('skips save when no messages are collected', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: []})
      await onFinish({response: {messages: []}})

      expect(mockSaveConversation).not.toHaveBeenCalled()
    })

    it('logs reuse warning when onStart called twice without onFinish', async () => {
      const integration = sanityInsightsIntegration({
        client: createMockClient(),
        agentId: 'test-agent',
        threadId: 'thread-1',
      })
      const {onStart, onFinish} = getHandlers(integration)

      onStart({messages: [{role: 'user', content: 'first'}]})
      onStart({messages: [{role: 'user', content: 'second'}]})

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Integration instance reused'),
      )

      // Should still work — uses second call's messages
      await onFinish({response: {messages: [{role: 'assistant', content: 'reply'}]}})

      expect(mockSaveConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {role: 'user', content: 'second'},
            {role: 'assistant', content: 'reply'},
          ],
        }),
      )
    })
  })
})
