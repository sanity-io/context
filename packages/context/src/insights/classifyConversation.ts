import {generateText, type LanguageModel, Output} from 'ai'
import {z} from 'zod'

import {type ContextInsightsOptions, requireClient} from './types'

/** @public */
export type Sentiment = 'positive' | 'neutral' | 'negative'

/** @public */
export interface CoreMetrics {
  /** How successfully the agent addressed user needs (1-10). */
  successScore: number
  /** Overall emotional tone of the user throughout the conversation. */
  sentiment: Sentiment
  /** Topics where the agent lacked information. Empty if none. */
  contentGaps: string[]
}

/** @public */
export interface ClassificationResult {
  coreMetrics: CoreMetrics
  classifiedAt: string
}

/** @public */
export interface ClassifyConversationOptions extends ContextInsightsOptions {
  /** Thread ID of the conversation to classify. */
  threadId: string
  /** AI SDK model for classification (e.g., `anthropic('claude-haiku-4-5')`). */
  model: LanguageModel
  /** Previously observed content gaps to encourage consistent terminology. Use `getPreviousContentGaps` to fetch these. */
  previousContentGaps?: string[]
  /**
   * Messages to classify. When omitted, the full transcript is fetched
   * from the Context document store before classification.
   */
  messages?: {role: string; content?: string | null}[]
}

const MAX_ERROR_LENGTH = 500

const coreMetricsSchema = z.object({
  successScore: z
    .number()
    .describe(
      'Integer from 1-10 indicating how successfully the agent addressed user needs. 1=complete failure, 5=partially addressed, 10=perfect resolution',
    ),
  sentiment: z
    .enum(['positive', 'neutral', 'negative'])
    .describe('Overall emotional tone of the user throughout the conversation'),
  contentGaps: z
    .array(z.string())
    .describe(
      'Topics where the assistant lacked information in its knowledge base. Only include gaps where the assistant could not provide information — not refusals, off-topic requests, or tool errors. Be specific (e.g., "international return policy" not "returns"). Empty array if no content gaps.',
    ),
})

function formatMessagesForPrompt(messages: {role: string; content?: string | null}[]): string {
  return messages
    .map((m) => {
      const role = m.role.charAt(0).toUpperCase() + m.role.slice(1)
      return `[${role}]: ${m.content || '(no content)'}`
    })
    .join('\n\n')
}

function buildSystemPrompt(previousContentGaps?: string[]): string {
  let prompt = `You are analyzing a conversation between a user and an AI assistant.
Classify the conversation according to the schema provided.

Guidelines:
- successScore: How well did the assistant resolve the user's needs? 1=complete failure, 5=partially addressed, 10=fully resolved.
- sentiment: The user's overall emotional tone across the entire conversation.
- contentGaps: Topics where the assistant lacked information in its knowledge base. Only include gaps where the assistant could not provide information — not refusals, off-topic requests, or tool errors. Be specific (e.g., "international return policy" not "returns"). Empty array if no content gaps.`

  if (previousContentGaps && previousContentGaps.length > 0) {
    prompt += `\n\nPreviously identified content gaps (reuse these exact terms when they match the gaps you find — only create new terms for genuinely new topics):\n${previousContentGaps.map((g) => `- ${g}`).join('\n')}`
  }

  return prompt
}

/**
 * Classifies a conversation using AI to extract metrics.
 *
 * Sends the messages to an AI model for analysis and records the
 * classification verdict on the conversation through the Context API.
 * When `messages` is omitted, the transcript is fetched first.
 *
 * If classification fails, the error is recorded on the conversation
 * (which removes it from the pending queue) and the error is re-thrown.
 *
 * For most use cases, prefer `classifyConversations` (plural) which handles
 * fetching, batching, and error handling automatically.
 *
 * @example
 * ```ts
 * import {classifyConversation} from '@sanity/context/insights'
 * import {anthropic} from '@ai-sdk/anthropic'
 *
 * await classifyConversation({
 *   client,
 *   threadId: 'thread-123',
 *   model: anthropic('claude-haiku-4-5'),
 * })
 * ```
 *
 * @returns The classification result with core metrics.
 * @throws If the conversation has no messages or classification fails.
 * @public
 */
export async function classifyConversation(
  options: ClassifyConversationOptions,
): Promise<ClassificationResult> {
  const {threadId, model} = options
  const client = requireClient('classifyConversation', options)

  if (!threadId || typeof threadId !== 'string') {
    throw new Error('classifyConversation: threadId must be a non-empty string')
  }

  const messages =
    options.messages ?? (await client.context.conversations.get({threadId}))?.messages

  if (!messages || messages.length === 0) {
    throw new Error(`Conversation has no messages: ${threadId}`)
  }

  const systemPrompt = buildSystemPrompt(options.previousContentGaps)

  const userPrompt = `Analyze this conversation:

---
${formatMessagesForPrompt(messages)}
---`

  try {
    const schema = z.object({coreMetrics: coreMetricsSchema})
    const result = await generateText({
      model,
      output: Output.object({schema}),
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: AbortSignal.timeout(5 * 60 * 1000),
    })

    if (!result.output) {
      throw new Error('Model returned no output')
    }

    const updated = await client.context.conversations.classify({
      threadId,
      coreMetrics: result.output.coreMetrics,
    })

    return {
      coreMetrics: result.output.coreMetrics,
      classifiedAt: updated.classifiedAt ?? new Date().toISOString(),
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Record the failure so the conversation leaves the pending queue instead
    // of being retried forever against a transcript the model cannot classify.
    try {
      await client.context.conversations.classify({
        threadId,
        classificationError: errorMessage.slice(0, MAX_ERROR_LENGTH),
      })
    } catch (storageError) {
      console.error('[classifyConversation] Failed to record classification error:', storageError)
    }

    throw error
  }
}
