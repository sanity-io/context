import type {SanityClient} from '@sanity/client'

import {CONVERSATION_SCHEMA_TYPE_NAME} from './constants'

/** @public */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/** @public */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** @public */
export interface Message {
  /**
   * The role of the message sender.
   */
  role: MessageRole

  /**
   * The content of the message.
   */
  content: string

  /**
   * For tool messages: the name of the tool.
   */
  toolName?: string

  /**
   * For tool messages: whether this is a tool call or a tool result.
   */
  toolType?: 'call' | 'result'
}

/** @public */
export interface SaveConversationOptions {
  /**
   * A Sanity client with write permissions.
   */
  client: SanityClient

  /**
   * Identifier for the agent that handled this conversation.
   * Used to group conversations by agent in the dashboard.
   */
  agentId: string

  /**
   * Unique identifier for this conversation thread.
   * Used for upserting - subsequent calls with the same threadId
   * will update the existing conversation document.
   */
  threadId: string

  /**
   * The messages in the conversation.
   * On upsert, these replace all existing messages.
   */
  messages: Message[]

  /**
   * The AI model provider (e.g. "openai", "anthropic").
   * Populated by the AI SDK telemetry integration.
   */
  modelProvider?: string

  /**
   * The AI model identifier (e.g. "gpt-4o").
   * Populated by the AI SDK telemetry integration.
   */
  modelId?: string

  /**
   * Aggregated token usage for the conversation.
   * Populated by the AI SDK telemetry integration.
   */
  tokenUsage?: TokenUsage
}

/**
 * FNV-1a 64-bit hash for generating deterministic IDs.
 * @internal
 */
function fnv1a64(str: string): string {
  // FNV-1a 64-bit parameters (using BigInt for 64-bit precision)
  const FNV_PRIME = 0x00000100000001b3n
  const FNV_OFFSET = 0xcbf29ce484222325n
  const MASK_64 = 0xffffffffffffffffn

  let hash = FNV_OFFSET
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(36)
}

/**
 * Generates a deterministic document ID from agentId and threadId.
 * This ensures the same conversation always maps to the same document.
 *
 * @example
 * ```ts
 * const id = generateConversationId('support-bot', 'thread-123')
 * // Returns: 'agentconversation-support-bot-thread-123-abc123'
 * ```
 *
 * @public
 */
export function generateConversationId(agentId: string, threadId: string): string {
  // Sanitize inputs to create valid document IDs
  const sanitizedAgentId = agentId.replace(/[^a-zA-Z0-9-_]/g, '-')
  const sanitizedThreadId = threadId.replace(/[^a-zA-Z0-9-_]/g, '-')
  // Add hash suffix to prevent collisions from sanitization
  const hashSuffix = fnv1a64(`${agentId}:${threadId}`)
  return `agentconversation-${sanitizedAgentId}-${sanitizedThreadId}-${hashSuffix}`
}

/**
 * Saves or updates a conversation in Sanity.
 *
 * This function uses an upsert pattern:
 * - Creates a new conversation document if one doesn't exist for the threadId
 * - Updates the existing document if it does exist
 *
 * The document ID is deterministic based on agentId and threadId,
 * so repeated calls with the same IDs will update the same document.
 *
 * @example
 * ```ts
 * import {saveConversation} from '@sanity/agent-context/insights'
 *
 * await saveConversation({
 *   client: sanityClient,
 *   agentId: 'my-support-agent',
 *   threadId: 'thread-123',
 *   messages: [
 *     {role: 'user', content: 'Hello!'},
 *     {role: 'assistant', content: 'Hi there! How can I help?'},
 *   ],
 * })
 * ```
 *
 * @returns The document ID of the saved conversation.
 * @throws Error if required parameters are missing or invalid.
 * @public
 */
export async function saveConversation(options: SaveConversationOptions): Promise<string> {
  const {client, agentId, threadId, messages, modelProvider, modelId, tokenUsage} = options

  if (!agentId || typeof agentId !== 'string') {
    throw new Error('saveConversation: agentId must be a non-empty string')
  }
  if (!threadId || typeof threadId !== 'string') {
    throw new Error('saveConversation: threadId must be a non-empty string')
  }
  if (!Array.isArray(messages)) {
    throw new Error('saveConversation: messages must be an array')
  }
  const now = new Date().toISOString()
  const documentId = generateConversationId(agentId, threadId)

  const formattedMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.toolName !== undefined && {toolName: m.toolName}),
    ...(m.toolType !== undefined && {toolType: m.toolType}),
  }))

  await client
    .transaction()
    .createIfNotExists({
      _id: documentId,
      _type: CONVERSATION_SCHEMA_TYPE_NAME,
      agentId,
      threadId,
      startedAt: now,
      messages: [],
    })
    .patch(documentId, (p) =>
      p.set({
        messages: formattedMessages,
        messagesUpdatedAt: now,
        ...(modelProvider !== undefined && {modelProvider}),
        ...(modelId !== undefined && {modelId}),
        ...(tokenUsage !== undefined && {tokenUsage}),
      }),
    )
    .commit({autoGenerateArrayKeys: true})

  return documentId
}
