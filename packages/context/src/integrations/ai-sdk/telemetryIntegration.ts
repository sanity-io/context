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
   * key groups conversations by MCP endpoint name in Insights in the Context app;
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
  /** AI SDK v7 only, e.g. `ai.streamText` or `ai.generateObject`. */
  operationId?: string
  messages?: ModelMessage[]
}

interface OnStepEndEvent {
  callId?: string
  /** The messages this step produced: the assistant message and any tool results. */
  response?: {
    messages?: ModelMessage[]
  }
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
  onStepEnd(event: OnStepEndEvent | OtherOperationEvent): void
  onFinish(event: OnFinishEvent | OtherOperationEvent): Promise<void>
  onEnd(event: OnFinishEvent | OtherOperationEvent): Promise<void>
  onAbort(event: OtherOperationEvent): void
  onError(event: unknown): Promise<void>
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

/** The API rejects longer errors, and one long stack trace must not fail the whole save. */
const ERROR_MAX_LENGTH = 20_000

function errorText(error: unknown): string {
  const text =
    error instanceof Error
      ? (error.stack ?? `${error.name}: ${error.message}`)
      : typeof error === 'string'
        ? error
        : serializeContent(error, Infinity)
  return text.slice(0, ERROR_MAX_LENGTH)
}

function failedToolResult(part: Record<string, unknown>): Message[] {
  const output = part['output']
  if (!isObject(output) || (output['type'] !== 'error-text' && output['type'] !== 'error-json')) {
    return []
  }
  const toolName = String(part['toolName'])
  return [
    {
      role: 'tool',
      toolName,
      toolType: 'result',
      content: null,
      error: errorText(output['value']),
    },
  ]
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
    // Tool results are left out of the transcript unless the call failed.
    if (raw.role === 'tool' && Array.isArray(raw.content)) {
      const results = raw.content.filter(
        (p): p is Record<string, unknown> => isObject(p) && isToolResult(p),
      )
      if (results.length > 0) {
        messages.push(...results.flatMap(failedToolResult))
        continue
      }
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

const TEXT_OPERATIONS = new Set(['ai.generateText', 'ai.streamText'])

interface PendingCall {
  /** v6 events carry no operationId, and v6 only reports text generation. */
  isText: boolean
  input: ModelMessage[]
  /** Completed steps so far, so a generation that fails midway keeps its tool calls. */
  steps: ModelMessage[]
}

// Pending entries are removed by onEnd/onFinish, onAbort, and onError. The
// cap is a backstop for paths with no hook (v7's onAbort is
// text-generation-only, so e.g. an aborted streamObject leaves its entry
// behind) and for future SDK gaps. It is sized far above any plausible number
// of concurrent generations in one process so eviction only ever hits leaked
// entries, and eviction warns because it costs a live call its input
// messages if it does hit one.
const MAX_PENDING_CALLS = 1000

function createSanityInsightsIntegration(config: SanityInsightsConfig): SanityInsightsIntegration {
  // v7 events carry a callId, so concurrent calls sharing one instance are
  // isolated. v6 events don't, so they all share the 'default' slot.
  const pendingByCall = new Map<string, PendingCall>()

  function takePending(callId: string | undefined): PendingCall | undefined {
    const callKey = callId ?? 'default'
    const pending = pendingByCall.get(callKey)
    pendingByCall.delete(callKey)
    return pending
  }

  async function save(messages: Message[], event: OnFinishEvent = {}): Promise<void> {
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

  async function onGenerationEnd(rawEvent: OnFinishEvent | OtherOperationEvent): Promise<void> {
    const event: OnFinishEvent = rawEvent
    const pending = takePending(event.callId)

    const responseMessages = event.responseMessages ?? event.response?.messages
    // Non-text operations (object/embed/rerank, routed through the same v7
    // hooks) have no response-messages field at all — they are not
    // conversations, so nothing is saved. An empty array is a real (text)
    // response and still saves.
    if (responseMessages === undefined) return

    await save(collectMessages([...(pending?.input ?? []), ...responseMessages]), event)
  }

  return {
    onStart(rawEvent: OnStartEvent | OtherOperationEvent): void {
      const event: OnStartEvent = rawEvent
      const callKey = event.callId ?? 'default'
      const isReusedKey = pendingByCall.has(callKey)
      if (isReusedKey) {
        console.warn(
          '[sanity-insights] Integration instance reused before previous request completed. ' +
            'Create a new integration instance for each streamText/generateText call.',
        )
      }
      if (!isReusedKey && pendingByCall.size >= MAX_PENDING_CALLS) {
        const oldestKey = pendingByCall.keys().next().value
        if (oldestKey !== undefined) {
          pendingByCall.delete(oldestKey)
          console.warn(
            `[sanity-insights] More than ${MAX_PENDING_CALLS} pending calls; evicting the oldest. ` +
              'This usually means generations are erroring without completing.',
          )
        }
      }
      pendingByCall.set(callKey, {
        isText: event.operationId === undefined || TEXT_OPERATIONS.has(event.operationId),
        input: event.messages ?? [],
        steps: [],
      })
    },

    onStepEnd(rawEvent: OnStepEndEvent | OtherOperationEvent): void {
      const event: OnStepEndEvent = rawEvent
      pendingByCall.get(event.callId ?? 'default')?.steps.push(...(event.response?.messages ?? []))
    },

    // AI SDK v6 invokes onFinish; v7 invokes onEnd.
    onFinish: onGenerationEnd,
    onEnd: onGenerationEnd,

    // AI SDK v7 fires onAbort / onError instead of onEnd for aborted or
    // failed generations. v6 has no error hook, so a failed v6 turn goes
    // unrecorded.
    onAbort(event: OtherOperationEvent): void {
      takePending(event.callId)
    },
    async onError(event: unknown): Promise<void> {
      const callId =
        isObject(event) && typeof event['callId'] === 'string' ? event['callId'] : undefined
      const pending = takePending(callId)
      if (!pending?.isText) return

      await save([
        ...collectMessages([...pending.input, ...pending.steps]),
        {
          role: 'assistant',
          content: null,
          error: errorText(isObject(event) ? event['error'] : event),
        },
      ])
    },
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
 *   token: process.env.SANITY_ORGANIZATION_TOKEN,
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
