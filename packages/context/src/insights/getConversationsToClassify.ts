import {type ContextInsightsOptions, requireClient} from './types'

/** @public */
export interface GetConversationsToClassifyOptions extends ContextInsightsOptions {
  /** Maximum number of conversations to return. Defaults to `100`. */
  limit?: number
  /**
   * How long a conversation must have been idle before it is considered
   * settled and ready to classify, so a thread still being written is never
   * scored mid-write. Defaults to `10` minutes.
   */
  settledForMinutes?: number
  /**
   * Only conversations tagged with this MCP endpoint name
   * (`metadata.mcpEndpoints`). When omitted, all conversations qualify.
   */
  mcpEndpoint?: string
}

/** @public */
export interface ConversationSummary {
  /** Unique thread identifier. */
  threadId: string
  /** When the transcript was last updated. */
  messagesUpdatedAt: string
  /** Number of messages in the transcript. */
  messageCount: number
  /** The first message of the conversation, for display purposes. */
  firstMessage: string | null
}

const DEFAULT_LIMIT = 100
const DEFAULT_SETTLED_FOR_MINUTES = 10

/**
 * Finds conversations that need classification: threads with messages, no
 * verdict, no recorded failure, and a transcript that has settled. Ordered
 * oldest first, so the longest-waiting conversations come up before a live
 * thread that may still receive messages.
 *
 * Returns summaries only — use `classifyConversation` to fetch the full
 * transcript and classify it.
 *
 * For most use cases, prefer `classifyConversations` (plural) which handles
 * fetching, batching, and error handling automatically.
 *
 * @example
 * ```ts
 * import {createClient} from '@sanity/client'
 * import {getConversationsToClassify} from '@sanity/context/insights'
 *
 * const client = createClient({
 *   apiVersion: 'v2025-11-27',
 *   token: process.env.SANITY_API_TOKEN,
 *   context: {organizationId: 'org-id'},
 * })
 *
 * const conversations = await getConversationsToClassify({client, limit: 500})
 * console.log(`${conversations.length} conversations need classification`)
 * ```
 *
 * @returns Array of conversation summaries that need classification.
 * @public
 */
export async function getConversationsToClassify(
  options: GetConversationsToClassifyOptions,
): Promise<ConversationSummary[]> {
  const {
    limit = DEFAULT_LIMIT,
    settledForMinutes = DEFAULT_SETTLED_FOR_MINUTES,
    mcpEndpoint,
  } = options
  const client = requireClient('getConversationsToClassify', options)

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('getConversationsToClassify: limit must be a positive integer')
  }
  if (!Number.isFinite(settledForMinutes) || settledForMinutes < 0) {
    throw new Error('getConversationsToClassify: settledForMinutes must be a non-negative number')
  }

  const settledBefore = new Date(Date.now() - settledForMinutes * 60_000).toISOString()

  const organizationId = client.config().context?.organizationId
  const params = {
    organizationId,
    settledBefore,
    ...(mcpEndpoint === undefined ? {} : {mcpEndpoint}),
  }

  return client.context.fetch<ConversationSummary[]>(
    `*[_type == "sanity.context.conversation" && organizationId == $organizationId
      && !defined(classifiedAt) && !defined(classificationError)
      && count(messages) > 0 && messagesUpdatedAt < $settledBefore
      ${mcpEndpoint === undefined ? '' : '&& $mcpEndpoint in metadata.mcpEndpoints'}]
      | order(messagesUpdatedAt asc) [0...${limit}]
      {threadId, messagesUpdatedAt, "messageCount": count(messages), "firstMessage": messages[0].content}`,
    params,
  )
}
