import type {SanityClient} from '@sanity/client'

import {CONVERSATION_SCHEMA_TYPE_NAME} from './constants'
import type {Message, TokenUsage} from './saveConversation'

/** @public */
export interface GetConversationsToClassifyOptions {
  /** Sanity client with read permissions. */
  client: SanityClient
  /** Optional filter by agent ID. */
  agentId?: string
  /** Optional maximum number of conversations to return. By default, all matching conversations are returned. */
  limit?: number
  /**
   * Minimum idle time (in minutes) before a conversation becomes eligible for classification.
   * Only conversations where `messagesUpdatedAt` is older than this cooldown period will be returned.
   * Defaults to `10` minutes.
   */
  cooldownMinutes?: number
}

/** @public */
export interface ConversationToClassify {
  /** Document ID. */
  _id: string
  /** Agent that handled this conversation. */
  agentId: string
  /** Unique thread identifier. */
  threadId: string
  /** Conversation messages. */
  messages: Message[]
  /** LLM provider used for this conversation (e.g. `"anthropic"`). */
  modelProvider?: string
  /** Model ID used for this conversation (e.g. `"claude-sonnet-4-5"`). */
  modelId?: string
  /** Token usage stats for this conversation. */
  tokenUsage?: TokenUsage
}

/**
 * Finds conversations that need classification or re-classification.
 *
 * A conversation needs classification if:
 * - It has never been classified (`classifiedAt` is not set)
 * - It has been updated since last classification (`classifiedAt <= messagesUpdatedAt`)
 * - The conversation has been idle for at least `cooldownMinutes` (default 10)
 *
 * Results are ordered by `messagesUpdatedAt` ascending (oldest first) to prioritize
 * conversations that have been waiting longest.
 *
 * For most use cases, prefer `classifyConversations` (plural) which handles
 * fetching, batching, and error handling automatically.
 *
 * @example
 * ```ts
 * import {getConversationsToClassify} from '@sanity/agent-context/insights'
 *
 * const conversations = await getConversationsToClassify({client, agentId: 'support-bot', limit: 500})
 * console.log(`${conversations.length} conversations need classification`)
 * ```
 *
 * @returns Array of conversations that need classification.
 * @public
 */
export async function getConversationsToClassify(
  options: GetConversationsToClassifyOptions,
): Promise<ConversationToClassify[]> {
  const {client, agentId, limit, cooldownMinutes = 10} = options

  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('getConversationsToClassify: limit must be a positive integer')
  }

  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes < 0) {
    throw new Error('getConversationsToClassify: cooldownMinutes must be a non-negative number')
  }

  const cooldownCutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString()
  const sliceClause = limit !== undefined ? `[0...${limit}]` : ''

  const query = `*[
    _type == $type
    && defined(messagesUpdatedAt)
    && (!defined(classifiedAt) || classifiedAt <= messagesUpdatedAt)
    && messagesUpdatedAt <= $cooldownCutoff
    && ($agentId == null || agentId == $agentId)
  ] | order(messagesUpdatedAt asc)${sliceClause} {
    _id,
    agentId,
    threadId,
    "messages": messages[] {
      "role": role,
      "content": content,
      "toolName": toolName,
      "toolType": toolType
    },
    modelProvider,
    modelId,
    tokenUsage
  }`

  const conversations = await client.fetch<ConversationToClassify[]>(
    query,
    {
      type: CONVERSATION_SCHEMA_TYPE_NAME,
      agentId: agentId ?? null,
      cooldownCutoff,
    },
    {perspective: 'published'},
  )

  return conversations
}
