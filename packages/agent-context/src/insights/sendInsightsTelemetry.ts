import type {SanityClient} from '@sanity/client'

import type {Sentiment} from './classifyConversation'

/** @public */
export interface TelemetryConfig {
  /** Enable metadata-only telemetry (classification metrics, no conversation content). */
  enabled: boolean
  /**
   * Want to help us improve Agent Context? Opt in to share full conversation
   * traces and provide your contact details — the team will be in touch to
   * help dial in your agent.
   */
  shareConversations?: {
    enabled: boolean
    /**
     * A way to reach you so we can collaborate on improving your agent.
     * Examples: "email:you@company.com", "discord:@username", "slack:@handle"
     */
    contactHandle?: string
  }
}

/** @public */
export interface ClassificationTelemetry {
  coreMetrics: {
    successScore?: number
    sentiment?: 'positive' | 'neutral' | 'negative'
    contentGapCount?: number
  }
  conversation: {
    messages: Array<{
      role: string
      bytes: number
      toolName?: string
    }>
    messageContents?: Array<{
      role: string
      content: string
      toolName?: string
    }>
  }
  context: {
    totalBytes: number
    estimatedTokens: number
  }
  model?: {
    provider?: string
    modelId?: string
    tokenUsage?: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }
  }
  projectId: string
  conversationId: string
  classifiedAt: string
  shareConversations?: {
    contactHandle?: string
  }
}

interface ConversationMessage {
  role: string
  content?: string
  toolName?: string
}

interface ConversationData {
  messages: ConversationMessage[]
  modelProvider?: string
  modelId?: string
  tokenUsage?: {inputTokens?: number; outputTokens?: number; totalTokens?: number}
}

let encoder: TextEncoder | undefined

function byteLength(str: string): number {
  if (!encoder) encoder = new TextEncoder()
  return encoder.encode(str).length
}

export function buildTelemetryPayload(
  conversationId: string,
  classifiedAt: string,
  projectId: string,
  coreMetrics: {successScore: number; sentiment: Sentiment; contentGaps: string[]},
  conversation: ConversationData,
  telemetry: TelemetryConfig,
): ClassificationTelemetry {
  const messageMeta = conversation.messages.map((m) => ({
    role: m.role,
    bytes: byteLength(m.content ?? ''),
    ...(m.toolName && {toolName: m.toolName}),
  }))

  const totalBytes = messageMeta.reduce((sum, m) => sum + m.bytes, 0)

  const payload: ClassificationTelemetry = {
    coreMetrics: {
      successScore: coreMetrics.successScore,
      sentiment: coreMetrics.sentiment,
      contentGapCount: coreMetrics.contentGaps.length,
    },
    conversation: {
      messages: messageMeta,
    },
    context: {
      totalBytes,
      estimatedTokens: Math.round(totalBytes / 4),
    },
    projectId,
    conversationId,
    classifiedAt,
  }

  if (conversation.modelProvider || conversation.modelId || conversation.tokenUsage) {
    payload.model = {
      ...(conversation.modelProvider && {provider: conversation.modelProvider}),
      ...(conversation.modelId && {modelId: conversation.modelId}),
      ...(conversation.tokenUsage && {tokenUsage: conversation.tokenUsage}),
    }
  }

  if (telemetry.shareConversations?.enabled) {
    payload.conversation.messageContents = conversation.messages.map((m) => ({
      role: m.role,
      content: m.content ?? '',
      ...(m.toolName && {toolName: m.toolName}),
    }))
    if (telemetry.shareConversations.contactHandle) {
      payload.shareConversations = {contactHandle: telemetry.shareConversations.contactHandle}
    }
  }

  return payload
}

const DEFAULT_API_HOST = 'https://api.sanity.io'
const TELEMETRY_API_VERSION = 'v2026-01-01'

export async function sendInsightsTelemetry(
  client: SanityClient,
  payload: ClassificationTelemetry,
): Promise<void> {
  const config = client.config()
  const token = config.token
  if (!token) return

  const apiHost = (config.apiHost ?? DEFAULT_API_HOST).replace(/\/$/, '')
  const url = `${apiHost}/${TELEMETRY_API_VERSION}/agent-context-insights/telemetry`

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
}
