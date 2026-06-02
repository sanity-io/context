import {FilterIcon, SearchIcon} from '@sanity/icons'
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Label,
  MenuDivider,
  Popover,
  Stack,
  Text,
  TextInput,
  useClickOutsideEvent,
} from '@sanity/ui'
import {Fragment, useMemo, useRef, useState} from 'react'

import {CONVERSATION_SCHEMA_TYPE_NAME} from '../../../../insights/constants'
import {SCORE_RANGES, SENTIMENT_OPTIONS} from '../constants'
import {ErrorBlock} from '../ErrorBlock'
import {LoadingBlock} from '../LoadingBlock'
import {Table} from '../Table'
import type {
  ConversationSummary,
  ScoreRange,
  Sentiment,
  SortDirection,
  SortField,
  SortOption,
} from '../types'
import {formatSentiment, useCompactLayout, useListenQuery} from '../utils'
import {ConversationRow} from './ConversationRow'
import {FilterMenu} from './FilterMenu'

const SENTIMENT_ORDER = `select(coreMetrics.sentiment == "negative" => 0, coreMetrics.sentiment == "neutral" => 1, coreMetrics.sentiment == "positive" => 2, 3)`

const SORT_CLAUSES: Record<SortOption, string> = {
  'date-desc': '| order(coalesce(messagesUpdatedAt, _updatedAt) desc)',
  'date-asc': '| order(coalesce(messagesUpdatedAt, _updatedAt) asc)',
  'score-desc': '| order(coreMetrics.successScore desc)',
  'score-asc': '| order(coreMetrics.successScore asc)',
  'sentiment-asc': `| order(${SENTIMENT_ORDER} asc)`,
  'sentiment-desc': `| order(${SENTIMENT_ORDER} desc)`,
  'gaps-desc': '| order(count(coreMetrics.contentGaps) desc)',
  'gaps-asc': '| order(count(coreMetrics.contentGaps) asc)',
}

const DEFAULT_DIRECTIONS: Record<SortField, SortDirection> = {
  date: 'desc',
  score: 'asc',
  sentiment: 'asc',
  gaps: 'desc',
}

const BASE_FILTER = `*[_type == $type
  && ($agentId == null || agentId == $agentId)
  && ($search == null || [messages[role == "user"][0].content, threadId] match ($search + "*"))
  && ($contentGapFilter == null || $contentGapFilter in coreMetrics.contentGaps)
  && ($scoreMin == null || (coreMetrics.successScore >= $scoreMin && coreMetrics.successScore < $scoreMax))
  && ($sentimentFilter == null || coreMetrics.sentiment == $sentimentFilter)
]`

const SCORE_RANGE_KEYS: ScoreRange[] = ['good', 'okay', 'poor', 'critical']

const SCORE_RANGE_OPTIONS = SCORE_RANGE_KEYS.map((range) => ({
  value: range,
  label: SCORE_RANGES[range].label,
}))

const SENTIMENT_FILTER_OPTIONS = SENTIMENT_OPTIONS.map((s) => ({
  value: s,
  label: formatSentiment(s),
}))

const CONTENT_GAPS_QUERY = `array::unique(*[_type == $type
  && ($agentId == null || agentId == $agentId)
].coreMetrics.contentGaps[])`

const PROJECTION = `{
  _id,
  agentId,
  messagesUpdatedAt,
  "messageCount": count(messages[role in ["user", "assistant"]]),
  "coreMetrics": { "successScore": coreMetrics.successScore, "sentiment": coreMetrics.sentiment, "contentGaps": coreMetrics.contentGaps },
  "firstMessage": messages[role == "user"][0].content
}`

function buildQuery(sortBy: SortOption): string {
  return `${BASE_FILTER} ${SORT_CLAUSES[sortBy]} [0...100] ${PROJECTION}`
}

interface ConversationListProps {
  onSelect: (conversationId: string) => void
  selectedId: string | null
  agentFilter: string | null
  contentGapFilter: string | null
  onContentGapFilterChange: (filter: string | null) => void
  scoreRange: ScoreRange | null
  onScoreRangeChange: (range: ScoreRange | null) => void
  sentimentFilter: Sentiment | null
  onSentimentFilterChange: (sentiment: Sentiment | null) => void
}

export function ConversationList(props: ConversationListProps) {
  const {
    onSelect,
    selectedId,
    agentFilter,
    contentGapFilter,
    onContentGapFilterChange,
    scoreRange,
    onScoreRangeChange,
    sentimentFilter,
    onSentimentFilterChange,
  } = props

  const [search, setSearch] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>('date-desc')
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false)
  const compact = useCompactLayout()

  const filterButtonRef = useRef<HTMLButtonElement | null>(null)
  const filterPopoverRef = useRef<HTMLDivElement | null>(null)

  const {data: contentGaps, error: contentGapsError} = useListenQuery<string[]>(
    `*[_type == $type && ($agentId == null || agentId == $agentId)]`,
    {type: CONVERSATION_SCHEMA_TYPE_NAME, agentId: agentFilter || null},
    {fetchQuery: CONTENT_GAPS_QUERY},
  )

  const scoreParams = scoreRange ? SCORE_RANGES[scoreRange] : null

  const {
    data: conversations,
    loading,
    error: conversationsError,
    retry,
  } = useListenQuery<ConversationSummary[]>(buildQuery(sortBy), {
    type: CONVERSATION_SCHEMA_TYPE_NAME,
    agentId: agentFilter || null,
    search: search || null,
    contentGapFilter: contentGapFilter || null,
    scoreMin: scoreParams?.min ?? null,
    scoreMax: scoreParams?.max ?? null,
    sentimentFilter: sentimentFilter || null,
  })

  const activeField = sortBy.split('-')[0] as SortField
  const activeDirection: SortDirection = sortBy.endsWith('asc') ? 'asc' : 'desc'

  const sortProps = useMemo(() => {
    function forField(field: SortField) {
      const isActive = activeField === field
      return {
        active: isActive,
        direction: isActive ? activeDirection : DEFAULT_DIRECTIONS[field],
        onToggle: () => {
          if (isActive) {
            const toggled = activeDirection === 'asc' ? 'desc' : 'asc'
            setSortBy(`${field}-${toggled}`)
          } else {
            setSortBy(`${field}-${DEFAULT_DIRECTIONS[field]}`)
          }
        },
      }
    }

    return {
      score: forField('score'),
      sentiment: forField('sentiment'),
      gaps: forField('gaps'),
      date: forField('date'),
    }
  }, [activeField, activeDirection])

  useClickOutsideEvent(
    () => setFiltersOpen(false),
    () => [filterButtonRef.current, filterPopoverRef.current],
  )

  const activeFilterLabels = [
    contentGapFilter,
    scoreRange ? SCORE_RANGES[scoreRange].label : null,
    sentimentFilter ? formatSentiment(sentimentFilter) : null,
  ].filter(Boolean)

  const hasActiveFilters = Boolean(search || activeFilterLabels.length > 0)

  if (conversationsError || contentGapsError) {
    return (
      <ErrorBlock
        message={`Error loading conversations: ${conversationsError || contentGapsError}`}
        fill
        onRetry={retry}
      />
    )
  }

  return (
    <Flex direction="column" height="fill">
      <Card padding={3} paddingBottom={1} borderBottom>
        <Stack space={1}>
          <Flex align="center" gap={2}>
            <Box flex={1}>
              <TextInput
                clearButton={search !== null}
                fontSize={1}
                icon={SearchIcon}
                onChange={(event) => setSearch(event.currentTarget.value || null)}
                onClear={() => setSearch(null)}
                placeholder="Search by message or thread ID..."
                radius={2}
                value={search || ''}
              />
            </Box>

            <Popover
              open={filtersOpen}
              animate
              placement="bottom-end"
              fallbackPlacements={['bottom-end']}
              ref={filterPopoverRef}
              width={0}
              content={
                <Stack space={4} paddingY={4} paddingBottom={2} paddingX={3}>
                  <Stack space={2}>
                    <Label size={1} muted>
                      Content gaps
                    </Label>

                    <FilterMenu
                      options={(contentGaps || []).map((gap) => ({value: gap, label: gap}))}
                      value={contentGapFilter}
                      allLabel="All content gaps"
                      onChange={onContentGapFilterChange}
                    />
                  </Stack>

                  <Stack space={2}>
                    <Label size={1} muted>
                      Scores
                    </Label>

                    <FilterMenu
                      options={SCORE_RANGE_OPTIONS}
                      value={scoreRange}
                      allLabel="All scores"
                      onChange={onScoreRangeChange}
                    />
                  </Stack>

                  <Stack space={2}>
                    <Label size={1} muted>
                      Sentiments
                    </Label>

                    <FilterMenu
                      options={SENTIMENT_FILTER_OPTIONS}
                      value={sentimentFilter}
                      allLabel="All sentiments"
                      onChange={onSentimentFilterChange}
                    />
                  </Stack>

                  <Stack space={2}>
                    <MenuDivider />

                    <Button
                      mode="bleed"
                      fontSize={1}
                      text="Clear all filters"
                      onClick={() => {
                        onContentGapFilterChange(null)
                        onScoreRangeChange(null)
                        onSentimentFilterChange(null)
                        setFiltersOpen(false)
                      }}
                    />
                  </Stack>
                </Stack>
              }
            >
              <Button
                aria-label="Filters"
                fontSize={1}
                icon={FilterIcon}
                mode="ghost"
                onClick={() => setFiltersOpen((v) => !v)}
                ref={filterButtonRef}
                selected={filtersOpen}
                text={compact ? undefined : 'Filters'}
                tone={activeFilterLabels.length > 0 ? 'primary' : 'default'}
              />
            </Popover>
          </Flex>

          <Box paddingX={2} style={{height: 34}}>
            <Flex align="center" gap={2} height="fill">
              {activeFilterLabels.length > 0 ? (
                <Flex align="center" gap={2}>
                  <Text size={0} muted>
                    Filtered by:
                  </Text>

                  {activeFilterLabels.map((label) => (
                    <Badge key={label} fontSize={0}>
                      {label}
                    </Badge>
                  ))}
                </Flex>
              ) : (
                <Text size={0} muted>
                  No filters applied
                </Text>
              )}

              {activeFilterLabels.length > 0 && (
                <Button
                  mode="bleed"
                  fontSize={0}
                  padding={2}
                  text="Clear"
                  onClick={() => {
                    onContentGapFilterChange(null)
                    onScoreRangeChange(null)
                    onSentimentFilterChange(null)
                  }}
                />
              )}
            </Flex>
          </Box>
        </Stack>
      </Card>

      <Table.Root>
        <Card borderBottom>
          <Table.Row paddingY={1}>
            <Table.Heading title="Preview" flex={3} />

            {!compact && <Table.Heading title="Agent" flex={2} />}

            <Table.Heading title="Score" flex={1} sort={sortProps.score} />

            {!compact && <Table.Heading title="Sentiment" flex={1} sort={sortProps.sentiment} />}

            {!compact && <Table.Heading title="Gaps" flex={1} sort={sortProps.gaps} />}

            {!compact && <Table.Heading title="Messages" flex={1} />}

            <Table.Heading title="Updated" flex={1} sort={sortProps.date} />
          </Table.Row>
        </Card>

        {loading ? (
          <Box flex={1}>
            <LoadingBlock message="Loading conversations…" fill />
          </Box>
        ) : (
          <Box
            flex={1}
            overflow="auto"
            style={{
              // The studio uses a custom scrollbar which doesn't work well
              // in this situation, as we want the headers to align nicely with
              // the rows.
              scrollbarWidth: 'thin',
            }}
          >
            {!conversations || conversations.length === 0 ? (
              <Card padding={4} height="fill">
                <Flex align="center" justify="center" height="fill">
                  <Stack space={3}>
                    <Text muted align="center">
                      {!agentFilter && !hasActiveFilters
                        ? 'No conversations recorded yet.'
                        : 'No conversations match your filters.'}
                    </Text>

                    {(agentFilter || hasActiveFilters) && (
                      <Text size={1} muted align="center">
                        Try adjusting your filter criteria.
                      </Text>
                    )}
                  </Stack>
                </Flex>
              </Card>
            ) : (
              <Stack space={0} overflow="auto">
                {conversations.map((conversation, index) => {
                  const isLast = index === conversations.length - 1

                  return (
                    <Fragment key={conversation._id}>
                      <ConversationRow
                        conversation={conversation}
                        isSelected={conversation._id === selectedId}
                        onSelect={onSelect}
                      />

                      {!isLast && <MenuDivider style={{opacity: 0.5}} />}
                    </Fragment>
                  )
                })}
              </Stack>
            )}
          </Box>
        )}
      </Table.Root>
    </Flex>
  )
}
