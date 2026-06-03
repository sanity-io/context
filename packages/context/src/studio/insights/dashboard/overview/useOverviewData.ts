import {useMemo} from 'react'

import {CONVERSATION_SCHEMA_TYPE_NAME} from '../../../../insights/constants'
import {getScoreTone, useListenQuery} from '../utils'
import {type DistributionItem} from './DistributionWidget'

const BASE_FILTER = `_type == $type && ($agentId == null || agentId == $agentId)`
const SCORED_FILTER = `${BASE_FILTER} && defined(coreMetrics.successScore)`
const SENTIMENT_FILTER = `${BASE_FILTER} && defined(coreMetrics.sentiment)`

const OVERVIEW_QUERY = `{
  "total": count(*[${BASE_FILTER}]),
  "avgScore": math::avg(*[${SCORED_FILTER}].coreMetrics.successScore),
  "avgMessages": math::avg(*[${BASE_FILTER}]{"c": count(messages[role in ["user", "assistant"]])}.c),

  "scoreGood": count(*[${SCORED_FILTER} && coreMetrics.successScore >= 8]),
  "scoreOkay": count(*[${SCORED_FILTER} && coreMetrics.successScore >= 6 && coreMetrics.successScore < 8]),
  "scorePoor": count(*[${SCORED_FILTER} && coreMetrics.successScore >= 4 && coreMetrics.successScore < 6]),
  "scoreCritical": count(*[${SCORED_FILTER} && coreMetrics.successScore < 4]),

  "sentimentPositive": count(*[${SENTIMENT_FILTER} && coreMetrics.sentiment == "positive"]),
  "sentimentNeutral": count(*[${SENTIMENT_FILTER} && coreMetrics.sentiment == "neutral"]),
  "sentimentNegative": count(*[${SENTIMENT_FILTER} && coreMetrics.sentiment == "negative"]),

  "classifiedCount": count(*[${BASE_FILTER} && defined(classifiedAt)]),
  "classificationErrors": count(*[${BASE_FILTER} && defined(classificationError)]),

  "contentGaps": *[${BASE_FILTER} && defined(coreMetrics.contentGaps)].coreMetrics.contentGaps[],

  "agentData": *[${BASE_FILTER}]{agentId, "score": coreMetrics.successScore}
}`

interface RawStats {
  total: number
  avgScore: number | null
  avgMessages: number | null
  scoreGood: number
  scoreOkay: number
  scorePoor: number
  scoreCritical: number
  sentimentPositive: number
  sentimentNeutral: number
  sentimentNegative: number
  classifiedCount: number
  classificationErrors: number
  contentGaps: string[]
  agentData: {agentId: string; score: number | null}[]
}

export interface ContentGap {
  description: string
  count: number
}

export interface AgentSummary {
  agentId: string
  count: number
  avgScore: number | null
}

function roundToDecimal(n: number): number {
  return Math.round(n * 10) / 10
}

function aggregateContentGaps(gaps: string[]): ContentGap[] {
  const counts: Record<string, number> = {}
  for (const gap of gaps) {
    counts[gap] = (counts[gap] || 0) + 1
  }
  return Object.entries(counts)
    .map(([description, count]) => ({description, count}))
    .sort((a, b) => b.count - a.count)
}

/**
 * Groups per-document agent data into per-agent summaries.
 * Client-side because GROQ lacks group-by aggregation.
 */
function aggregateAgentData(data: {agentId: string; score: number | null}[]): AgentSummary[] {
  const grouped = new Map<string, {count: number; scores: number[]}>()

  for (const {agentId, score} of data) {
    const entry = grouped.get(agentId) || {count: 0, scores: []}
    entry.count++
    if (score !== null) entry.scores.push(score)
    grouped.set(agentId, entry)
  }

  return Array.from(grouped, ([agentId, {count, scores}]) => ({
    agentId,
    count,
    avgScore:
      scores.length > 0 ? roundToDecimal(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
  })).sort((a, b) => b.count - a.count)
}

export interface OverviewData {
  total: number
  avgScore: string
  avgScoreTone: ReturnType<typeof getScoreTone> | undefined
  avgMessages: string
  classifiedCount: number
  analyzedTone: 'caution' | 'default' | 'positive'
  scoreItems: DistributionItem[]
  sentimentItems: DistributionItem[]
  contentGaps: ContentGap[]
  agentSummaries: AgentSummary[]
}

export function useOverviewData(agentFilter: string | null) {
  const {
    data: stats,
    loading,
    error,
    retry,
  } = useListenQuery<RawStats>(
    `*[${BASE_FILTER}]`,
    {type: CONVERSATION_SCHEMA_TYPE_NAME, agentId: agentFilter || null},
    {fetchQuery: OVERVIEW_QUERY},
  )

  const data = useMemo<OverviewData | null>(() => {
    if (!stats) return null

    const total = stats.total
    const avgScore = stats.avgScore !== null ? roundToDecimal(stats.avgScore) : null
    const avgMessages = stats.avgMessages !== null ? roundToDecimal(stats.avgMessages) : null
    const classifiedCount = stats.classifiedCount
    const errorCount = stats.classificationErrors
    const pendingCount = total - classifiedCount

    return {
      total,
      avgScore: avgScore !== null ? `${avgScore}/10` : '—',
      avgScoreTone: avgScore !== null ? getScoreTone(avgScore) : undefined,
      avgMessages: avgMessages !== null ? String(avgMessages) : '—',
      classifiedCount,
      analyzedTone: errorCount > 0 ? 'caution' : pendingCount > 0 ? 'default' : 'positive',
      scoreItems: [
        {label: 'Good (8-10)', count: stats.scoreGood, tone: 'positive'},
        {label: 'Okay (6-7)', count: stats.scoreOkay, tone: 'default'},
        {label: 'Poor (4-5)', count: stats.scorePoor, tone: 'caution'},
        {label: 'Critical (1-3)', count: stats.scoreCritical, tone: 'critical'},
      ],
      sentimentItems: [
        {label: 'Positive', count: stats.sentimentPositive, tone: 'positive'},
        {label: 'Neutral', count: stats.sentimentNeutral, tone: 'default'},
        {label: 'Negative', count: stats.sentimentNegative, tone: 'critical'},
      ],
      contentGaps: aggregateContentGaps(stats.contentGaps),
      agentSummaries: aggregateAgentData(stats.agentData),
    }
  }, [stats])

  return {data, loading, error, retry}
}
