import type {Context, SanityClient} from '@sanity/client'
import {bindTelemetryIntegration, type TelemetryIntegration} from 'ai'

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

interface OnStartEvent {
  messages?: ModelMessage[]
}

interface OnFinishEvent {
  response: {
    messages?: ModelMessage[]
  }
  model: {
    provider: string
    modelId: string
  }
  totalUsage: {
    inputTokens: number | undefined
    outputTokens: number | undefined
    totalTokens?: number
  }
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

function createSanityInsightsIntegration(config: SanityInsightsConfig): TelemetryIntegration {
  let inputMessages: ModelMessage[] | null = null

  return {
    onStart(event: OnStartEvent): void {
      if (inputMessages !== null) {
        console.warn(
          '[sanity-insights] Integration instance reused before previous request completed. ' +
            'Create a new integration instance for each streamText/generateText call.',
        )
      }
      inputMessages = event.messages ?? []
    },

    async onFinish(event: OnFinishEvent): Promise<void> {
      const allRaw = [...(inputMessages ?? []), ...(event.response.messages ?? [])]
      inputMessages = null

      const messages = collectMessages(allRaw)
      if (messages.length === 0) return

      const threadId = typeof config.threadId === 'function' ? config.threadId() : config.threadId

      const modelProvider = event.model?.provider
      const modelId = event.model?.modelId
      const inputTokens = event.totalUsage?.inputTokens
      const outputTokens = event.totalUsage?.outputTokens
      const totalTokens =
        event.totalUsage?.totalTokens !== undefined
          ? event.totalUsage.totalTokens
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
    },
  }
}

/**
 * Creates a telemetry integration that saves conversations to Sanity Context.
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
 *   experimental_telemetry: {
 *     isEnabled: true,
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
export function sanityInsightsIntegration(config: SanityInsightsConfig): TelemetryIntegration {
  return bindTelemetryIntegration(createSanityInsightsIntegration(config))
}
