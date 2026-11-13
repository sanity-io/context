import {fetchInitialContext, type InitialContextOptions} from './initialContext'

/** @public */
export interface SanityContextOptions extends InitialContextOptions {
  /**
   * Inline the initial context into the system prompt and hide the `initial_context` tool. Defaults to
   * `true`. Set to `false` to skip the fetch and keep the tool; the agent then loads the initial context
   * itself by calling it.
   */
  inlineInitialContext?: boolean
  /** How long to reuse a fetched initial context, in milliseconds. Defaults to 5 minutes. */
  cacheTtlMs?: number
}

/**
 * Returns a getter for the initial context. A successful fetch is reused for `cacheTtlMs`. A failed
 * fetch is never cached: it falls back to the last successful value, or `null`, and is retried on the
 * next call.
 *
 * @internal
 */
export function createInitialContextCache(
  options: SanityContextOptions,
): () => Promise<string | null> {
  const ttl = options.cacheTtlMs ?? 5 * 60_000
  let lastGood: string | null = null
  let cached: {value: Promise<string | null>; expires: number} | undefined

  return () => {
    const now = Date.now()
    if (cached && cached.expires > now) return cached.value
    const value: Promise<string | null> = fetchInitialContext(options).then(
      (text) => {
        if (text !== null) return (lastGood = text)
        if (cached?.value === value) cached = undefined
        return lastGood
      },
      (error: unknown) => {
        if (cached?.value === value) cached = undefined
        throw error
      },
    )
    cached = {value, expires: now + ttl}
    return value
  }
}
