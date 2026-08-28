import {type ContextInsightsOptions, requireClient} from './types'

/** @public */
export type GetPreviousContentGapsOptions = ContextInsightsOptions

const TOP_GAPS = 50

/**
 * Fetches previously identified content gaps from classified conversations,
 * deduplicated and ranked by frequency (top 50).
 *
 * Pass these to `classifyConversation` as `previousContentGaps` to encourage
 * consistent gap terminology across classification runs.
 *
 * Used internally by `classifyConversations` (plural). For most use cases,
 * prefer that function which handles this automatically.
 *
 * @example
 * ```ts
 * import {getPreviousContentGaps} from '@sanity/context/insights'
 *
 * const gaps = await getPreviousContentGaps({client})
 * console.log(`${gaps.length} known content gaps:`, gaps)
 * ```
 *
 * @returns Array of content gap strings, ranked by frequency (most common first).
 * @public
 */
export async function getPreviousContentGaps(
  options: GetPreviousContentGapsOptions,
): Promise<string[]> {
  const client = requireClient('getPreviousContentGaps', options)
  const organizationId = client.config().context?.organizationId

  const gapLists = await client.context.fetch<string[][]>(
    `*[_type == "sanity.context.conversation" && organizationId == $organizationId
      && count(coreMetrics.contentGaps) > 0].coreMetrics.contentGaps`,
    {organizationId},
  )

  const counts = new Map<string, number>()
  for (const gap of gapLists.flat()) {
    counts.set(gap, (counts.get(gap) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GAPS)
    .map(([gap]) => gap)
}
