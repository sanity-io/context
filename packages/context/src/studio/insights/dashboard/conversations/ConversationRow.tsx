import {Badge, Box, Card, Text} from '@sanity/ui'
import {useRelativeTime} from 'sanity'

import {Table} from '../Table'
import type {ConversationSummary} from '../types'
import {formatSentiment, getScoreTone, getSentimentTone, useCompactLayout} from '../utils'

interface ConversationRowProps {
  conversation: ConversationSummary
  isSelected: boolean
  onSelect: (id: string) => void
}

export function ConversationRow(props: ConversationRowProps) {
  const {conversation, isSelected, onSelect} = props
  const compact = useCompactLayout()

  const score = conversation.coreMetrics?.successScore
  const sentiment = conversation.coreMetrics?.sentiment
  const gapCount = conversation.coreMetrics?.contentGaps?.length ?? 0

  return (
    <Card
      __unstable_focusRing
      as="button"
      pressed={isSelected}
      onClick={() => onSelect(conversation._id)}
      aria-label={`View conversation with ${conversation.agentId}`}
      aria-pressed={isSelected}
      style={{cursor: 'pointer'}}
    >
      <Table.Row>
        <Table.Cell flex={3}>
          <Box>
            <Text size={1} textOverflow="ellipsis">
              {conversation.firstMessage || 'No message'}
            </Text>
          </Box>
        </Table.Cell>

        {!compact && (
          <Table.Cell flex={2}>
            <Box>
              <Text size={0} muted textOverflow="ellipsis">
                {conversation.agentId}
              </Text>
            </Box>
          </Table.Cell>
        )}

        <Table.Cell flex={1}>
          {score != null ? (
            <Badge tone={getScoreTone(score)} fontSize={0} overflow="hidden">
              {score}/10
            </Badge>
          ) : (
            <Text size={0} muted>
              -
            </Text>
          )}
        </Table.Cell>

        {!compact && (
          <Table.Cell flex={1}>
            {sentiment ? (
              <Badge tone={getSentimentTone(sentiment)} fontSize={0} overflow="hidden">
                {formatSentiment(sentiment)}
              </Badge>
            ) : (
              <Text size={0} muted>
                -
              </Text>
            )}
          </Table.Cell>
        )}

        {!compact && (
          <Table.Cell flex={1}>
            <Badge tone={gapCount > 0 ? 'caution' : 'default'} fontSize={0}>
              {gapCount}
            </Badge>
          </Table.Cell>
        )}

        {!compact && (
          <Table.Cell flex={1}>
            <Text size={0} muted>
              {conversation.messageCount}
            </Text>
          </Table.Cell>
        )}

        <Table.Cell flex={1}>
          <Box>
            {conversation.messagesUpdatedAt && (
              <RelativeDate date={conversation.messagesUpdatedAt} />
            )}
          </Box>
        </Table.Cell>
      </Table.Row>
    </Card>
  )
}

function RelativeDate(props: {date: string}) {
  const relativeTime = useRelativeTime(props.date, {minimal: true, useTemporalPhrase: true})

  return (
    <Text size={0} muted textOverflow="ellipsis" title={props.date}>
      {relativeTime}
    </Text>
  )
}
