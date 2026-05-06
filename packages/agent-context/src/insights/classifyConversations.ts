import type {SanityClient} from '@sanity/client'
import type {LanguageModel} from 'ai'

import {classifyConversation} from './classifyConversation'
import {getConversationsToClassify} from './getConversationsToClassify'
import {getPreviousContentGaps} from './getPreviousContentGaps'
import type {TelemetryConfig} from './sendInsightsTelemetry'

const DEFAULT_CONCURRENCY = 3

/** @public */
export interface ClassifyConversationsOptions {
  /** Sanity client with read/write permissions. */
  client: SanityClient
  /** AI SDK model for classification (e.g., `anthropic('claude-haiku-4-5')`). */
  model: LanguageModel
  /** Max conversations to classify concurrently. Defaults to `3`. */
  concurrency?: number
  /** Telemetry configuration. When enabled, shares classification metrics with Sanity. */
  telemetry?: TelemetryConfig
  /** Filter by agent ID. Applies to both conversation fetching and content gap fetching. */
  agentId?: string
  /** Max conversations to process. No limit by default. */
  limit?: number
  /**
   * Minimum idle time (in minutes) before a conversation becomes eligible for classification.
   * Only conversations where `messagesUpdatedAt` is older than this cooldown period will be returned.
   * Defaults to `10` minutes.
   */
  cooldownMinutes?: number
}

/** @public */
export interface ClassifyConversationsResult {
  /** Number of successfully classified conversations. */
  successCount: number
  /** Number of failed classifications. */
  errorCount: number
  /** Total conversations found to classify. */
  totalFound: number
}

/**
 * Classifies all eligible conversations in a single call.
 *
 * This is a convenience wrapper around the lower-level primitives:
 * `getConversationsToClassify`, `getPreviousContentGaps`, and `classifyConversation`.
 *
 * @example
 * ```ts
 * import {classifyConversations} from '@sanity/agent-context/insights'
 * import {anthropic} from '@ai-sdk/anthropic'
 *
 * const result = await classifyConversations({
 *   client,
 *   model: anthropic('claude-haiku-4-5'),
 *   telemetry: {shareMetrics: true},
 * })
 *
 * console.log(`${result.successCount} classified, ${result.errorCount} failed`)
 * ```
 *
 * @returns Summary of classification results.
 * @public
 */
export async function classifyConversations(
  options: ClassifyConversationsOptions,
): Promise<ClassifyConversationsResult> {
  const {
    client,
    model,
    concurrency = DEFAULT_CONCURRENCY,
    telemetry,
    agentId,
    limit,
    cooldownMinutes,
  } = options

  const [conversations, previousContentGaps] = await Promise.all([
    getConversationsToClassify({client, agentId, limit, cooldownMinutes}),
    getPreviousContentGaps({client, agentId}),
  ])

  if (conversations.length === 0) {
    return {successCount: 0, errorCount: 0, totalFound: 0}
  }

  let successCount = 0
  let errorCount = 0
  const active = new Set<Promise<void>>()

  for (const conv of conversations) {
    if (active.size >= concurrency) {
      await Promise.race(active)
    }

    const task = classifyConversation({
      client,
      conversationId: conv._id,
      model,
      messages: conv.messages,
      modelProvider: conv.modelProvider,
      modelId: conv.modelId,
      tokenUsage: conv.tokenUsage,
      previousContentGaps,
      telemetry,
    })
      .then(() => {
        successCount++
      })
      .catch((err) => {
        errorCount++
        console.error('[classifyConversation] Failed to classify:', err)
      })
      .finally(() => {
        active.delete(task)
      })

    active.add(task)
  }

  await Promise.all(active)

  return {successCount, errorCount, totalFound: conversations.length}
}
