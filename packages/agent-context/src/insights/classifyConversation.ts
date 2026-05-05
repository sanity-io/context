import type {SanityClient} from '@sanity/client'
import {generateText, type LanguageModel, Output} from 'ai'
import {z} from 'zod'

import {CONVERSATION_SCHEMA_TYPE_NAME} from './constants'
import type {Message} from './saveConversation'
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
  /** AI SDK model for classification (e.g., `openai('gpt-4o-mini')`). */
  model: LanguageModel
  /**
   * Messages to classify directly.
   * @deprecated No longer needed — messages are fetched internally from the conversation document. Will be removed in a future release.
   */
  messages?: Message[]
  /** Previously observed content gaps to encourage consistent terminology. Use `getPreviousContentGaps` to fetch these. */
  previousContentGaps?: string[]
  /** Telemetry configuration. When enabled, shares metadata-only classification metrics with Sanity. */
  telemetry?: TelemetryConfig
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

interface StoredMessage {
  role: string
  content: string
}

interface ConversationDocument {
  _id: string
  agentId: string
  threadId: string
  messages: StoredMessage[]
  modelProvider?: string
  modelId?: string
  tokenUsage?: {inputTokens?: number; outputTokens?: number; totalTokens?: number}
}

/** @internal Exported for testing */
export function formatMessagesForPrompt(messages: StoredMessage[]): string {
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
 * This function fetches the conversation, sends it to an AI model for analysis,
 * and stores the classification results back on the document.
 *
 * Core metrics (successScore, sentiment, contentGaps) are always extracted.
 *
 * If classification fails, an error is stored on the document and the error is re-thrown.
 *
 * @example
 * ```ts
 * import {classifyConversation} from '@sanity/agent-context/insights'
 * import {openai} from '@ai-sdk/openai'
 *
 * await classifyConversation({
 *   client: sanityClient,
 *   conversationId: 'agentconversation-support-bot-thread-123',
 *   model: openai('gpt-4o-mini'),
 * })
 * ```
 *
 * @returns The classification result with core metrics.
 * @throws If the conversation doesn't exist, has no messages, or classification fails.
 * @public
 */
export async function classifyConversation(
  options: ClassifyConversationOptions,
): Promise<ClassificationResult> {
  const {client, conversationId, model, messages: providedMessages, telemetry} = options
  const now = new Date().toISOString()

  const conversation = await client.fetch<ConversationDocument | null>(
    `*[_type == $type && _id == $id][0]{
      _id,
      agentId,
      threadId,
      messages,
      modelProvider,
      modelId,
      tokenUsage
    }`,
    {type: CONVERSATION_SCHEMA_TYPE_NAME, id: conversationId},
  )

  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`)
  }

  // Use provided messages (deprecated path) or fetched messages
  const messagesToClassify = providedMessages ?? conversation.messages

  if (!messagesToClassify || messagesToClassify.length === 0) {
    throw new Error(`Conversation has no messages: ${conversationId}`)
  }

  const systemPrompt = buildSystemPrompt(options.previousContentGaps)

  const userPrompt = `Analyze this conversation:

---
${formatMessagesForPrompt(messagesToClassify)}
---`

  try {
    const schema = z.object({coreMetrics: coreMetricsSchema})
    const result = await generateText({
      model,
      output: Output.object({schema}),
      system: systemPrompt,
      prompt: userPrompt,
    })

    if (!result.output) {
      throw new Error('Model returned no output')
    }

    await client
      .patch(conversationId)
      .set({coreMetrics: result.output.coreMetrics, classifiedAt: now})
      .unset(['classificationError'])
      .commit()

    if (telemetry?.enabled) {
      const projectId = client.config().projectId
      if (projectId) {
        const payload = buildTelemetryPayload(
          conversationId,
          now,
          projectId,
          result.output.coreMetrics,
          {
            messages: messagesToClassify,
            modelProvider: conversation.modelProvider,
            modelId: conversation.modelId,
            tokenUsage: conversation.tokenUsage,
          },
          telemetry,
        )
        // Fire-and-forget: don't block classification result on telemetry
        void sendInsightsTelemetry(client, payload).catch(() => {})
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
