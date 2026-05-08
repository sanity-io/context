import type {SanityClient} from '@sanity/client'
import {generateText, type LanguageModel, Output} from 'ai'
import {z} from 'zod'

import type {Message, TokenUsage} from './saveConversation'
import {
  buildTelemetryPayload,
  sendInsightsTelemetry,
  type TelemetryConfig,
} from './sendInsightsTelemetry'

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
export interface ClassifyConversationOptions {
  /** Sanity client with read/write permissions. */
  client: SanityClient
  /** Document ID to classify. */
  conversationId: string
  /** AI SDK model for classification (e.g., `anthropic('claude-haiku-4-5')`). */
  model: LanguageModel
  /** Messages to classify. */
  messages: Message[]
  /** Previously observed content gaps to encourage consistent terminology. Use `getPreviousContentGaps` to fetch these. */
  previousContentGaps?: string[]
  /** Telemetry configuration. When enabled, shares metadata-only classification metrics with Sanity. */
  telemetry?: TelemetryConfig
  /** LLM provider used for this conversation (e.g. `"anthropic"`). Stored on the conversation document. */
  modelProvider?: string
  /** Model ID used for this conversation (e.g. `"claude-sonnet-4-5"`). Stored on the conversation document. */
  modelId?: string
  /** Token usage stats for this conversation. Stored on the conversation document. */
  tokenUsage?: TokenUsage
}

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

/** @internal Exported for testing */
export function formatMessagesForPrompt(messages: {role: string; content?: string}[]): string {
  return messages
    .map((m) => {
      const role = m.role.charAt(0).toUpperCase() + m.role.slice(1)
      return `[${role}]: ${m.content || '(no content)'}`
    })
    .join('\n\n')
}

/** @internal Exported for testing */
export function buildSystemPrompt(previousContentGaps?: string[]): string {
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
 * Sends the provided messages to an AI model for analysis and stores the
 * classification results back on the document.
 *
 * If classification fails, an error is stored on the document and the error is re-thrown.
 *
 * For most use cases, prefer `classifyConversations` (plural) which handles
 * fetching, batching, and error handling automatically.
 *
 * @example
 * ```ts
 * import {classifyConversation} from '@sanity/agent-context/insights'
 * import {anthropic} from '@ai-sdk/anthropic'
 *
 * await classifyConversation({
 *   client,
 *   conversationId: 'agentconversation-bot-thread-123',
 *   model: anthropic('claude-haiku-4-5'),
 *   messages: [{role: 'user', content: 'Hello'}, {role: 'assistant', content: 'Hi!'}],
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
  const {client, conversationId, model, messages, telemetry} = options
  const now = new Date().toISOString()

  if (!messages || messages.length === 0) {
    throw new Error(`Conversation has no messages: ${conversationId}`)
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

    await client
      .patch(conversationId)
      .set({
        coreMetrics: result.output.coreMetrics,
        classifiedAt: now,
        ...(options.modelProvider && {modelProvider: options.modelProvider}),
        ...(options.modelId && {modelId: options.modelId}),
        ...(options.tokenUsage && {tokenUsage: options.tokenUsage}),
      })
      .unset(['classificationError'])
      .commit()

    if (telemetry?.shareMetrics || telemetry?.shareConversations) {
      const projectId = client.config().projectId
      if (projectId) {
        const payload = buildTelemetryPayload(
          conversationId,
          now,
          projectId,
          result.output.coreMetrics,
          {
            messages,
            modelProvider: options.modelProvider,
            modelId: options.modelId,
            tokenUsage: options.tokenUsage,
          },
          telemetry,
        )
        await sendInsightsTelemetry(client, payload)
      }
    }

    return {coreMetrics: result.output.coreMetrics, classifiedAt: now}
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Store the error but don't set classifiedAt — this allows the conversation
    // to be picked up again by getConversationsToClassify on the next run.
    // Transient errors (API rate limits, network issues) will resolve themselves.
    try {
      await client.patch(conversationId).set({classificationError: errorMessage}).commit()
    } catch (storageError) {
      console.error('[classifyConversation] Failed to store error on document:', storageError)
    }

    throw error
  }
}
