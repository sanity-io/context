import type {LanguageModel} from 'ai'

import {classifyConversation} from './classifyConversation'
import {getConversationsToClassify} from './getConversationsToClassify'
import {getPreviousContentGaps} from './getPreviousContentGaps'
import type {ContextInsightsOptions} from './types'

const DEFAULT_CONCURRENCY = 3

/** @public */
export interface ClassifyConversationsOptions extends ContextInsightsOptions {
  /** AI SDK model for classification (e.g., `anthropic('claude-haiku-4-5')`). */
  model: LanguageModel
  /** Max conversations to classify concurrently. Defaults to `3`. */
  concurrency?: number
  /** Max conversations to process per run. Defaults to `100`. */
  limit?: number
  /**
   * How long a conversation must have been idle before it is considered
   * settled and ready to classify. Defaults to `10` minutes.
   */
  settledForMinutes?: number
  /**
   * Only classify conversations tagged with this MCP endpoint name
   * (`metadata.mcpEndpoints`). When omitted, all conversations qualify.
   */
  mcpEndpoint?: string
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
 * import {createClient} from '@sanity/client'
 * import {classifyConversations} from '@sanity/context/insights'
 * import {anthropic} from '@ai-sdk/anthropic'
 *
 * const client = createClient({
 *   apiVersion: 'v2025-11-27',
 *   token: process.env.SANITY_API_TOKEN,
 *   context: {organizationId: 'org-id'},
 * })
 *
 * const result = await classifyConversations({client, model: anthropic('claude-haiku-4-5')})
 * console.log(`${result.successCount} classified, ${result.errorCount} failed`)
 * ```
 *
 * @returns Summary of classification results.
 * @public
 */
export async function classifyConversations(
  options: ClassifyConversationsOptions,
): Promise<ClassifyConversationsResult> {
  const {client, model, concurrency = DEFAULT_CONCURRENCY} = options

  const [conversations, previousContentGaps] = await Promise.all([
    getConversationsToClassify({
      client,
      limit: options.limit,
      settledForMinutes: options.settledForMinutes,
      mcpEndpoint: options.mcpEndpoint,
    }),
    getPreviousContentGaps({client}),
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
      threadId: conv.threadId,
      model,
      previousContentGaps,
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
