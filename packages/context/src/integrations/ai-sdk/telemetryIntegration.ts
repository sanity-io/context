import type {Context, SanityClient} from '@sanity/client'

import type {ConversationSharing, Message} from '../../insights/types'

/**
 * Configuration for the Sanity Insights telemetry integration.
 * @public
 */
export interface SanityInsightsConfig {
  /**
   * A Sanity client configured with `context: {organizationId}` and a
   * server-side token.
   */
  client: SanityClient

  /**
   * Unique identifier for the conversation thread.
   * Can be a string or a function that returns a string.
   */
  threadId: string | (() => string)

  /**
   * Dimensions recorded on the conversation. The well-known `mcpEndpoints`
   * key groups conversations by MCP endpoint name in the Context dashboard;
   * your own keys ride along for querying.
   */
  metadata?: Context.SaveConversationParams['metadata']

  /**
   * Opt-in to share telemetry with Sanity. Want to help improve Sanity
   * Context? Share metrics or full conversation traces and the team will be
   * in touch to help dial in your agent.
   */
  sharing?: ConversationSharing
}

interface ModelMessage {
  role: string
  content: unknown
}

interface TokenUsage {
  inputTokens: number | undefined
  outputTokens: number | undefined
  totalTokens?: number
}

interface OnStartEvent {
  /** Present on AI SDK v7 events, absent on v6. */
  callId?: string
  messages?: ModelMessage[]
}

interface OnFinishEvent {
  /** Present on AI SDK v7 events, absent on v6. */
  callId?: string
  /** AI SDK v7: response messages from all steps. */
  responseMessages?: ModelMessage[]
  /** AI SDK v6: response messages. In v7 this is final-step-only — prefer `responseMessages`. */
  response?: {
    messages?: ModelMessage[]
  }
  model?: {
    provider: string
    modelId: string
  }
  /** Aggregated usage across all steps (v6 and v7; deprecated alias of `usage` in v7). */
  totalUsage?: TokenUsage
  /** AI SDK v7: aggregated usage across all steps. In v6 this is final-step-only — prefer `totalUsage`. */
  usage?: TokenUsage
}

/**
 * An AI SDK v7 telemetry event for an operation that carries no conversation
 * transcript (object generation, embedding, reranking). Accepted so the
 * integration satisfies v7's `Telemetry` interface, which routes all
 * operation kinds through the same hooks; such events produce no save.
 */
interface OtherOperationEvent {
  callId?: string
}

/**
 * The telemetry integration returned by {@link sanityInsightsIntegration}.
 * Structurally compatible with AI SDK v6's `TelemetryIntegration` (which
 * invokes `onFinish`) and v7's `Telemetry` (which invokes `onEnd`).
 * @public
 */
export interface SanityInsightsIntegration {
  onStart(event: OnStartEvent | OtherOperationEvent): void
  onFinish(event: OnFinishEvent | OtherOperationEvent): Promise<void>
  onEnd(event: OnFinishEvent | OtherOperationEvent): Promise<void>
}

const VALID_ROLES: Record<string, Message['role']> = {
  user: 'user',
  assistant: 'assistant',
  system: 'system',
  tool: 'tool',
}

function normalizeRole(role: string): Message['role'] {
  return VALID_ROLES[role] ?? 'assistant'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function serializeContent(value: unknown, maxLength = 500): string {
  if (value === undefined || value === null) return ''
  try {
    const json = JSON.stringify(value)
    return json.length > maxLength ? json.slice(0, maxLength) + '...(truncated)' : json
  } catch {
    return String(value)
  }
}

function isToolResult(part: Record<string, unknown>): boolean {
  return 'result' in part || 'output' in part
}

function formatTextPart(part: unknown): string {
  if (typeof part === 'string') return part
  if (isObject(part) && 'text' in part && typeof part['text'] === 'string') {
    return part['text']
  }
  return JSON.stringify(part)
}

function contentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(formatTextPart).join('\n')
  return formatTextPart(content)
}

/**
 * Process messages: split tool calls/results into structured Message objects.
 */
function collectMessages(rawMessages: ModelMessage[]): Message[] {
  const messages: Message[] = []

  for (const raw of rawMessages) {
    // Skip tool result messages (role=tool with result/output content)
    if (raw.role === 'tool' && Array.isArray(raw.content)) {
      const hasResult = raw.content.some((p) => isObject(p) && isToolResult(p))
      if (hasResult) continue
    }

    if (!Array.isArray(raw.content)) {
      messages.push({role: normalizeRole(raw.role), content: contentToString(raw.content)})
      continue
    }

    // Array content: split tool calls from text parts
    const textParts: unknown[] = []
    const toolCalls: Record<string, unknown>[] = []

    for (const part of raw.content) {
      if (isObject(part) && 'toolName' in part && !isToolResult(part)) {
        toolCalls.push(part)
      } else {
        textParts.push(part)
      }
    }

    if (textParts.length > 0) {
      messages.push({
        role: normalizeRole(raw.role),
        content: textParts.map(formatTextPart).join('\n'),
      })
    }

    for (const call of toolCalls) {
      const toolName = String(call['toolName'])
      const args = call['input'] ?? call['args']
      messages.push({
        role: 'tool',
        toolName,
        toolType: 'call',
        content: serializeContent(args),
      })
    }
  }

  return messages
}

function createSanityInsightsIntegration(config: SanityInsightsConfig): SanityInsightsIntegration {
  // v7 events carry a callId, so concurrent calls sharing one instance are
  // isolated. v6 events don't, so they all share the 'default' slot.
  const inputMessagesByCall = new Map<string, ModelMessage[]>()

  async function onGenerationEnd(rawEvent: OnFinishEvent | OtherOperationEvent): Promise<void> {
    // Every OnFinishEvent field is optional, so the union narrows by plain
    // assignment: non-text operation events simply have none of them set.
    const event: OnFinishEvent = rawEvent
    const callKey = event.callId ?? 'default'
    const inputMessages = inputMessagesByCall.get(callKey)
    inputMessagesByCall.delete(callKey)

    const responseMessages = event.responseMessages ?? event.response?.messages
    const allRaw = [...(inputMessages ?? []), ...(responseMessages ?? [])]

    const messages = collectMessages(allRaw)
    if (messages.length === 0) return

    const threadId = typeof config.threadId === 'function' ? config.threadId() : config.threadId

    const modelProvider = event.model?.provider
    const modelId = event.model?.modelId
    const usage = event.totalUsage ?? event.usage
    const inputTokens = usage?.inputTokens
    const outputTokens = usage?.outputTokens
    const totalTokens =
      usage?.totalTokens !== undefined
        ? usage.totalTokens
        : inputTokens !== undefined || outputTokens !== undefined
          ? (inputTokens ?? 0) + (outputTokens ?? 0)
          : undefined
    const tokenUsage =
      inputTokens !== undefined || outputTokens !== undefined
        ? {inputTokens, outputTokens, totalTokens}
        : undefined

    try {
      await config.client.context.conversations.save({
        threadId,
        messages,
        ...(config.metadata !== undefined && {metadata: config.metadata}),
        ...(config.sharing !== undefined && {sharing: config.sharing}),
        ...(modelProvider !== undefined && {modelProvider}),
        ...(modelId !== undefined && {modelId}),
        ...(tokenUsage !== undefined && {tokenUsage}),
      })
    } catch (err) {
      console.error('[sanity-insights] Failed to save conversation:', err)
    }
  }

  return {
    onStart(rawEvent: OnStartEvent | OtherOperationEvent): void {
      const event: OnStartEvent = rawEvent
      const callKey = event.callId ?? 'default'
      if (inputMessagesByCall.has(callKey)) {
        console.warn(
          '[sanity-insights] Integration instance reused before previous request completed. ' +
            'Create a new integration instance for each streamText/generateText call.',
        )
      }
      inputMessagesByCall.set(callKey, event.messages ?? [])
    },

    // AI SDK v6 invokes onFinish; v7 invokes onEnd.
    onFinish: onGenerationEnd,
    onEnd: onGenerationEnd,
  }
}

/**
 * Creates a telemetry integration that saves conversations to Sanity Context.
 *
 * Compatible with AI SDK v6 (`experimental_telemetry`) and v7 (`telemetry`).
 *
 * @example
 * ```ts
 * import {createClient} from '@sanity/client'
 * import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'
 * import {streamText} from 'ai'
 *
 * const client = createClient({
 *   apiVersion: 'v2025-11-27',
 *   token: process.env.SANITY_API_TOKEN,
 *   context: {organizationId: 'org-id'},
 * })
 *
 * const result = await streamText({
 *   model: openai('gpt-4o'),
 *   messages,
 *   // On AI SDK v6, use `experimental_telemetry: {isEnabled: true, integrations: [...]}`
 *   telemetry: {
 *     integrations: [
 *       sanityInsightsIntegration({
 *         client,
 *         threadId,
 *         metadata: {mcpEndpoints: 'my-support-agent'},
 *       }),
 *     ],
 *   }
 * })
 * ```
 * @public
 */
export function sanityInsightsIntegration(config: SanityInsightsConfig): SanityInsightsIntegration {
  return createSanityInsightsIntegration(config)
}
