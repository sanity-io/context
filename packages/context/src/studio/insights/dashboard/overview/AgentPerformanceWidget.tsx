import {Badge, Flex, Stack, Text} from '@sanity/ui'

import {METRIC_INFO} from '../constants'
import {TextWithInfo} from '../TextWithInfo'
import {getScoreTone} from '../utils'
import type {AgentSummary} from './useOverviewData'
import {Widget} from './Widget'

interface AgentPerformanceWidgetProps {
  agents: AgentSummary[]
}

export function AgentPerformanceWidget(props: AgentPerformanceWidgetProps) {
  const {agents} = props

  return (
    <Widget>
      <Stack space={4}>
        <TextWithInfo size={1} weight="semibold" info={METRIC_INFO.agentPerformance}>
          Agent performance
        </TextWithInfo>

        <Stack space={3}>
          {agents.map((agent) => (
            <Flex key={agent.agentId} align="center" justify="space-between" gap={2}>
              <Text size={1} textOverflow="ellipsis">
                {agent.agentId}
              </Text>

              <Flex align="center" gap={3} style={{flexShrink: 0}}>
                <Text size={0} muted>
                  {`${agent.count} ${agent.count === 1 ? 'conversation' : 'conversations'}`}
                </Text>

                {agent.avgScore !== null && (
                  <Badge tone={getScoreTone(agent.avgScore)} fontSize={0}>
                    {agent.avgScore}/10
                  </Badge>
                )}
              </Flex>
            </Flex>
          ))}
        </Stack>
      </Stack>
    </Widget>
  )
}
