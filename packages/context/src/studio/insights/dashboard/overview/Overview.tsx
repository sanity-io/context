import {Card, Container, Grid, Heading, Stack, Text} from '@sanity/ui'

import {METRIC_INFO} from '../constants'
import {ErrorBlock} from '../ErrorBlock'
import {LoadingBlock} from '../LoadingBlock'
import {AgentPerformanceWidget} from './AgentPerformanceWidget'
import {ContentGapsWidget} from './ContentGapsWidget'
import {DistributionWidget} from './DistributionWidget'
import {MetricCard} from './MetricCard'
import {useOverviewData} from './useOverviewData'

const GRID_GAP = 3

interface OverviewProps {
  agentFilter: string | null
  onContentGapClick: (gapDescription: string) => void
}

export function Overview(props: OverviewProps) {
  const {agentFilter, onContentGapClick} = props
  const {data, loading, error, retry} = useOverviewData(agentFilter)

  if (loading) {
    return <LoadingBlock message="Loading analytics…" fill />
  }

  if (error) {
    return <ErrorBlock message={`Error loading analytics: ${error}`} fill onRetry={retry} />
  }

  if (data?.total === 0 && !agentFilter) {
    return (
      <Card padding={4} flex={1}>
        <Container width={2}>
          <Stack space={5}>
            <Stack space={3}>
              <Heading as="h2" size={2}>
                No conversations yet
              </Heading>

              <Text muted size={2}>
                Start tracking your AI agent conversations to see insights here.
              </Text>
            </Stack>

            <Card padding={4} radius={3} tone="transparent" style={{textAlign: 'left'}}>
              <Stack space={3}>
                <Text size={1} weight="semibold">
                  Quick setup
                </Text>

                <Text size={1} muted>
                  Add the telemetry integration to your AI agent:
                </Text>

                <Card padding={3} radius={3} tone="default">
                  <code style={{fontSize: 12}}>
                    {'sanityInsightsIntegration({ client, agentId, threadId })'}
                  </code>
                </Card>
              </Stack>
            </Card>
          </Stack>
        </Container>
      </Card>
    )
  }

  if (!data) return null

  return (
    <Stack space={GRID_GAP} padding={4} flex={1}>
      <Grid columns={[1, 1, 2, 4]} gap={GRID_GAP}>
        <MetricCard label="Conversations" value={data.total} info={METRIC_INFO.conversations} />

        <MetricCard
          label="Average score"
          value={data.avgScore}
          tone={data.avgScoreTone}
          info={METRIC_INFO.averageScore}
        />

        <MetricCard
          label="Average messages"
          value={data.avgMessages}
          info={METRIC_INFO.avgMessages}
        />

        <MetricCard
          label="Analyzed"
          value={`${data.classifiedCount}/${data.total}`}
          tone={data.analyzedTone}
          info={METRIC_INFO.analyzed}
        />
      </Grid>

      <Grid columns={[1, 1, 1, 2]} gap={GRID_GAP}>
        <DistributionWidget
          title="Scores"
          info={METRIC_INFO.scores}
          emptyText="No analyzed conversations yet"
          items={data.scoreItems}
        />

        <DistributionWidget
          title="Sentiment"
          info={METRIC_INFO.sentiment}
          emptyText="No analyzed conversations yet"
          items={data.sentimentItems}
        />
      </Grid>

      <Grid columns={[1, 1, 1, 2]} gap={GRID_GAP}>
        <ContentGapsWidget contentGaps={data.contentGaps} onContentGapClick={onContentGapClick} />

        {data.agentSummaries.length > 0 && <AgentPerformanceWidget agents={data.agentSummaries} />}
      </Grid>
    </Stack>
  )
}
