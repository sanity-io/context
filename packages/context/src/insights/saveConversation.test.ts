import {describe, expect, it, vi} from 'vitest'

import {generateConversationId, saveConversation} from './saveConversation'

describe('generateConversationId', () => {
  it('generates deterministic ID from agentId and threadId', () => {
    const id = generateConversationId('support-bot', 'thread-123')
    // Should start with the expected prefix and sanitized parts
    expect(id).toMatch(/^agentconversation-support-bot-thread-123-[a-z0-9]+$/)
  })

  it('sanitizes special characters', () => {
    const id = generateConversationId('my agent!', 'thread@456')
    // Each special character is replaced with a hyphen individually
    expect(id).toMatch(/^agentconversation-my-agent--thread-456-[a-z0-9]+$/)
  })

  it('produces same ID for same inputs', () => {
    const id1 = generateConversationId('agent', 'thread')
    const id2 = generateConversationId('agent', 'thread')
    expect(id1).toBe(id2)
  })

  it('produces different IDs for inputs that sanitize to the same string', () => {
    // These would collide without the hash suffix
    const id1 = generateConversationId('my-agent', 'thread-1')
    const id2 = generateConversationId('my agent', 'thread-1')

    expect(id1).not.toBe(id2)
    // Both should start with the same sanitized prefix
    expect(id1).toMatch(/^agentconversation-my-agent-thread-1-/)
    expect(id2).toMatch(/^agentconversation-my-agent-thread-1-/)
  })
})

describe('saveConversation', () => {
  describe('input validation', () => {
    it('throws if agentId is empty', async () => {
      const mockClient = {transaction: vi.fn()} as never
      await expect(
        saveConversation({
          client: mockClient,
          agentId: '',
          threadId: 'thread',
          messages: [],
        }),
      ).rejects.toThrow('saveConversation: agentId must be a non-empty string')
    })

    it('throws if threadId is empty', async () => {
      const mockClient = {transaction: vi.fn()} as never
      await expect(
        saveConversation({
          client: mockClient,
          agentId: 'agent',
          threadId: '',
          messages: [],
        }),
      ).rejects.toThrow('saveConversation: threadId must be a non-empty string')
    })

    it('throws if messages is not an array', async () => {
      const mockClient = {transaction: vi.fn()} as never
      await expect(
        saveConversation({
          client: mockClient,
          agentId: 'agent',
          threadId: 'thread',
          messages: 'not an array' as never,
        }),
      ).rejects.toThrow('saveConversation: messages must be an array')
    })
  })

  describe('transaction behavior', () => {
    it('calls createIfNotExists and patch in a transaction', async () => {
      const commitMock = vi.fn().mockResolvedValue(undefined)
      const patchMock = vi.fn().mockReturnValue({commit: commitMock})
      const createIfNotExistsMock = vi.fn().mockReturnValue({patch: patchMock})
      const transactionMock = vi.fn().mockReturnValue({createIfNotExists: createIfNotExistsMock})

      const mockClient = {
        transaction: transactionMock,
      } as never

      const result = await saveConversation({
        client: mockClient,
        agentId: 'test-agent',
        threadId: 'test-thread',
        messages: [
          {role: 'user', content: 'Hello'},
          {role: 'assistant', content: 'Hi there!'},
        ],
      })

      // Should return deterministic document ID
      expect(result).toMatch(/^agentconversation-test-agent-test-thread-/)

      // Verify transaction was called
      expect(transactionMock).toHaveBeenCalled()
      expect(createIfNotExistsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: result,
          _type: 'sanity.agentContextConversation',
          agentId: 'test-agent',
          threadId: 'test-thread',
        }),
      )
      expect(patchMock).toHaveBeenCalledWith(result, expect.any(Function))
      expect(commitMock).toHaveBeenCalled()
    })

    it('includes toolName and toolType when provided', async () => {
      let patchedData: unknown = null
      const commitMock = vi.fn().mockResolvedValue(undefined)
      const patchMock = vi.fn().mockImplementation((_id, patchFn) => {
        const mockPatcher = {
          set: (data: unknown) => {
            patchedData = data
            return mockPatcher
          },
        }
        patchFn(mockPatcher)
        return {commit: commitMock}
      })
      const createIfNotExistsMock = vi.fn().mockReturnValue({patch: patchMock})
      const transactionMock = vi.fn().mockReturnValue({createIfNotExists: createIfNotExistsMock})

      const mockClient = {
        transaction: transactionMock,
      } as never

      await saveConversation({
        client: mockClient,
        agentId: 'agent',
        threadId: 'thread',
        messages: [
          {role: 'tool', content: '{"query":"shoes"}', toolName: 'search', toolType: 'call'},
          {role: 'user', content: 'Hello'},
        ],
      })

      const data = patchedData as {messages: Record<string, unknown>[]}
      expect(data.messages[0]).toMatchObject({
        role: 'tool',
        content: '{"query":"shoes"}',
        toolName: 'search',
        toolType: 'call',
      })
      // Regular message should not have tool fields
      expect(data.messages[1]).not.toHaveProperty('toolName')
      expect(data.messages[1]).not.toHaveProperty('toolType')
    })

    it('formats messages and sets messagesUpdatedAt', async () => {
      let patchedData: unknown = null
      const commitMock = vi.fn().mockResolvedValue(undefined)
      const patchMock = vi.fn().mockImplementation((_id, patchFn) => {
        // Capture the patch function result
        const mockPatcher = {
          set: (data: unknown) => {
            patchedData = data
            return mockPatcher
          },
        }
        patchFn(mockPatcher)
        return {commit: commitMock}
      })
      const createIfNotExistsMock = vi.fn().mockReturnValue({patch: patchMock})
      const transactionMock = vi.fn().mockReturnValue({createIfNotExists: createIfNotExistsMock})

      const mockClient = {
        transaction: transactionMock,
      } as never

      await saveConversation({
        client: mockClient,
        agentId: 'agent',
        threadId: 'thread',
        messages: [{role: 'user', content: 'Test message'}],
      })

      expect(patchedData).toMatchObject({
        messages: [
          {
            role: 'user',
            content: 'Test message',
          },
        ],
        messagesUpdatedAt: expect.any(String),
      })
    })
  })
})
