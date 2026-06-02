import type {
  CoreMetrics as PrimitiveCoreMetrics,
  Sentiment as PrimitiveSentiment,
} from '../../../insights/classifyConversation'

/**
 * Sort options for conversation list.
 * @internal
 */
export type SortField = 'date' | 'score' | 'sentiment' | 'gaps'
export type SortDirection = 'asc' | 'desc'
export type SortOption = `${SortField}-${SortDirection}`

/**
 * Re-export Sentiment from insights for dashboard use.
 * @internal
 */
export type Sentiment = PrimitiveSentiment

/**
 * Score range buckets matching the overview distribution.
 * @internal
 */
export type ScoreRange = 'good' | 'okay' | 'poor' | 'critical'

/**
 * Core metrics as they appear on conversation documents.
 * Fields are optional because documents may not be analyzed yet.
 * @internal
 */
export type CoreMetrics = Partial<PrimitiveCoreMetrics>

/**
 * A message in a conversation thread.
 * @internal
 */
export interface ConversationMessage {
  _key: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  toolName: string | null
  toolType: 'call' | 'result' | null
}

/**
 * Full conversation document structure used in the detail view.
 * @internal
 */
export interface Conversation {
  _id: string
  agentId: string
  threadId: string
  startedAt: string | null
  messagesUpdatedAt: string | null
  classifiedAt: string | null
  classificationError: string | null
  firstMessage: string | null
  messages: ConversationMessage[]
  coreMetrics: CoreMetrics | null
}

/**
 * Summary data for a conversation displayed in the list.
 * @internal
 */
export interface ConversationSummary {
  _id: string
  agentId: string
  messagesUpdatedAt: string | null
  messageCount: number
  coreMetrics: Pick<CoreMetrics, 'successScore' | 'sentiment' | 'contentGaps'> | null
  firstMessage: string | null
}
