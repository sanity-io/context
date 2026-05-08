import type {SanityClient} from '@sanity/client'

import {CONVERSATION_SCHEMA_TYPE_NAME} from './constants'

/** @public */
export interface GetPreviousContentGapsOptions {
  /** Sanity client with read permissions. */
  client: SanityClient
  /** Only include gaps from conversations classified within this many days. Defaults to `30`. */
  maxAgeDays?: number
  /** Maximum number of gaps to return, ranked by frequency. Defaults to `50`. */
  limit?: number
  /** Optional filter by agent ID. */
  agentId?: string
}

/** @internal Exported for testing */
export function rankByFrequency(gaps: string[], limit: number): string[] {
  const freq = new Map<string, {canonical: string; count: number}>()

  for (const gap of gaps) {
    const key = gap.toLowerCase()
    const entry = freq.get(key)
    if (entry) {
      entry.count++
    } else {
      freq.set(key, {canonical: gap, count: 1})
    }
  }

  return Array.from(freq.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => e.canonical)
}

/**
 * Fetches previously identified content gaps from classified conversations,
 * deduplicated and ranked by frequency.
 *
 * Used internally by `classifyConversations` (plural). For most use cases,
 * prefer that function which handles this automatically.
 *
 * @example
 * ```ts
 * import {getPreviousContentGaps} from '@sanity/agent-context/insights'
 *
 * const gaps = await getPreviousContentGaps({client, agentId: 'support-bot'})
 * console.log(`${gaps.length} known content gaps:`, gaps)
 * ```
 *
 * @returns Array of content gap strings, ranked by frequency (most common first).
 * @public
 */
export async function getPreviousContentGaps(
  options: GetPreviousContentGapsOptions,
): Promise<string[]> {
  const {client, maxAgeDays = 30, limit = 50, agentId} = options

  const since = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString()

  const query = `*[
    _type == $type
    && defined(coreMetrics.contentGaps)
    && defined(classifiedAt)
    && classifiedAt > $since
    && ($agentId == null || agentId == $agentId)
  ].coreMetrics.contentGaps[]`

  const allGaps = await client.fetch<string[]>(
    query,
    {
      type: CONVERSATION_SCHEMA_TYPE_NAME,
      since,
      agentId: agentId ?? null,
    },
    {perspective: 'published'},
  )

  return rankByFrequency(allGaps, limit)
}
