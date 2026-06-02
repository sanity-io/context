import {CloseIcon} from '@sanity/icons'
import {Badge, Box, Button, Card, Container, Flex, Grid, Label, Stack, Text} from '@sanity/ui'
import type {ReactNode} from 'react'

import {CONVERSATION_SCHEMA_TYPE_NAME} from '../../../../insights/constants'
import {ErrorBlock} from '../ErrorBlock'
import {LoadingBlock} from '../LoadingBlock'
import type {Conversation} from '../types'
import {formatSentiment, getScoreTone, getSentimentTone, useListenQuery} from '../utils'
import {ConversationMessage} from './ConversationMessage'

const DETAIL_QUERY = `*[_type == $type && _id == $id][0]{
  _id,
  agentId,
  threadId,
  startedAt,
  messagesUpdatedAt,
  classifiedAt,
  classificationError,
  coreMetrics,
  "firstMessage": messages[role == "user"][0].content,
  messages,
  }`

interface AnalysisStatus {
  tone: 'positive' | 'caution' | 'critical' | 'default'
  label: string
}

function getAnalysisStatus(conversation: Conversation | null): AnalysisStatus {
  if (!conversation) return {tone: 'default', label: 'Not analyzed'}

  if (conversation.classificationError) return {tone: 'critical', label: 'Failed'}

  const metrics = conversation.coreMetrics
  const hasMetrics =
    metrics &&
    (metrics.successScore !== undefined ||
      metrics.sentiment ||
      (metrics.contentGaps && metrics.contentGaps.length > 0))

  if (hasMetrics) return {tone: 'positive', label: 'Complete'}
  if (conversation.classifiedAt) return {tone: 'caution', label: 'No metrics'}

  return {tone: 'default', label: 'Not analyzed'}
}

interface DetailProps {
  label: string
  value?: string | ReactNode
}

function Detail(props: DetailProps) {
  const {label, value} = props

  return (
    <Stack space={2}>
      <Label size={0} weight="medium" muted>
        {label}
      </Label>

      {typeof value === 'string' ? (
        <Text size={0} muted>
          {value || '-'}
        </Text>
      ) : value ? (
        <Flex wrap="wrap" gap={2}>
          {value}
        </Flex>
      ) : (
        <Text size={0} muted>
          -
        </Text>
      )}
    </Stack>
  )
}

interface ConversationDetailProps {
  conversationId: string
  onClose?: () => void
}

export function ConversationDetail(props: ConversationDetailProps) {
  const {conversationId, onClose} = props

  const {
    data: conversation,
    loading,
    error,
    retry,
  } = useListenQuery<Conversation>(DETAIL_QUERY, {
    type: CONVERSATION_SCHEMA_TYPE_NAME,
    id: conversationId,
  })

  if (loading) {
    return <LoadingBlock message="Loading conversation…" fill />
  }

  if (error) {
    return <ErrorBlock message={`Error loading conversation: ${error}`} fill onRetry={retry} />
  }

  const analysisStatus = getAnalysisStatus(conversation)

  return (
    <Card height="fill" overflow="auto">
      <Stack>
        <Card borderBottom padding={4} paddingTop={3} paddingRight={3}>
          <Stack space={4}>
            <Flex align="center" gap={3}>
              <Box flex={1}>
                <Text size={1} weight="semibold" textOverflow="ellipsis">
                  {conversation?.firstMessage || 'Untitled conversation'}
                </Text>
              </Box>

              {onClose && (
                <Button
                  aria-label="Close conversation"
                  icon={CloseIcon}
                  mode="bleed"
                  onClick={onClose}
                  padding={2}
                />
              )}
            </Flex>

            {conversation && (
              <Stack space={4}>
                <Grid gap={4} columns={[1, 1, 3]}>
                  <Detail label="Agent ID" value={conversation.agentId} />

                  <Detail label="Thread ID" value={conversation.threadId} />

                  <Detail
                    label="Analyzed at"
                    value={
                      conversation.classifiedAt
                        ? new Date(conversation.classifiedAt).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : undefined
                    }
                  />

                  <Detail
                    label="Score"
                    value={
                      conversation.coreMetrics?.successScore != null ? (
                        <Badge
                          tone={getScoreTone(conversation.coreMetrics.successScore)}
                          fontSize={0}
                        >
                          {conversation.coreMetrics.successScore}/10
                        </Badge>
                      ) : undefined
                    }
                  />

                  <Detail
                    label="Sentiment"
                    value={
                      conversation.coreMetrics?.sentiment ? (
                        <Badge
                          tone={getSentimentTone(conversation.coreMetrics.sentiment)}
                          fontSize={0}
                        >
                          {formatSentiment(conversation.coreMetrics.sentiment)}
                        </Badge>
                      ) : undefined
                    }
                  />

                  <Detail
                    label="Analysis status"
                    value={
                      <Badge tone={analysisStatus.tone} fontSize={0}>
                        {analysisStatus.label}
                      </Badge>
                    }
                  />

                  <Detail
                    label="Gaps"
                    value={
                      (conversation.coreMetrics?.contentGaps?.length ?? 0) > 0
                        ? conversation.coreMetrics?.contentGaps?.map((gap) => (
                            // eslint-disable-next-line react/jsx-indent
                            <Badge key={gap} tone="caution" fontSize={0}>
                              {gap}
                            </Badge>
                          ))
                        : undefined
                    }
                  />
                </Grid>

                {conversation.classificationError && (
                  <Card padding={3} tone="critical" radius={3} border>
                    <Stack space={2}>
                      <Text size={1} weight="medium">
                        Analysis error
                      </Text>

                      <Text size={1} muted>
                        {conversation.classificationError}
                      </Text>
                    </Stack>
                  </Card>
                )}
              </Stack>
            )}
          </Stack>
        </Card>

        <Container width={1} padding={5} sizing="border">
          {conversation ? (
            <Flex direction="column" gap={3}>
              {conversation?.messages?.length > 0 ? (
                conversation?.messages?.map((message) => {
                  return <ConversationMessage key={message._key} message={message} />
                })
              ) : (
                <Text size={1} muted align="center">
                  No messages found.
                </Text>
              )}
            </Flex>
          ) : (
            <Card padding={4} height="fill">
              <Flex align="center" justify="center" height="fill">
                <Text size={1} muted align="center">
                  Conversation not found.
                </Text>
              </Flex>
            </Card>
          )}
        </Container>
      </Stack>
    </Card>
  )
}
