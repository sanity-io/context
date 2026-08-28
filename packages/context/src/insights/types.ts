import type {Context, SanityClient} from '@sanity/client'

/**
 * Options shared by every insights function.
 *
 * @public
 */
export interface ContextInsightsOptions {
  /**
   * A Sanity client configured with `context: {organizationId}` and a
   * server-side token.
   */
  client: SanityClient
}

/**
 * A transcript message as ingested by the Context API.
 *
 * @public
 */
export type Message = Context.SaveConversationParams['messages'][number]

/** @public */
export type MessageRole = Message['role']

/** @public */
export type TokenUsage = NonNullable<Context.SaveConversationParams['tokenUsage']>

/**
 * A stored transcript message, as read back from the Context document store.
 *
 * @public
 */
export type ConversationMessage = Context.ConversationDoc['messages'][number]

/**
 * Opt-in to share conversation telemetry with Sanity. The data stays in your
 * store; this records permission for Sanity to use it. `metrics` shares
 * metadata-only classification metrics (scores, sentiment, counts, model and
 * token info), `conversations` shares full transcripts and implies `metrics`,
 * and `contact` is how the Sanity team reaches you.
 *
 * Typed here until the field lands in `@sanity/client`'s vendored spec.
 *
 * @public
 */
export interface ConversationSharing {
  metrics?: boolean
  conversations?: boolean
  contact?: string
}

/** @internal */
export function requireClient(fnName: string, options: ContextInsightsOptions): SanityClient {
  if (!options.client || typeof options.client.config !== 'function') {
    throw new Error(`${fnName}: options.client must be a configured Sanity client`)
  }
  if (!options.client.config().context?.organizationId) {
    throw new Error(`${fnName}: the client must be configured with context.organizationId`)
  }
  return options.client
}
