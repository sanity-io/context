import {Box, Card, Dialog, Flex, useMediaIndex} from '@sanity/ui'
import {useId} from 'react'

import type {ScoreRange, Sentiment} from '../types'
import {ConversationDetail} from './ConversationDetail'
import {ConversationList} from './ConversationList'

interface ConversationsProps {
  selectedConversationId: string | null
  onSelectConversation: (id: string) => void
  onCloseDetail: () => void
  agentFilter: string | null
  contentGapFilter: string | null
  onContentGapFilterChange: (filter: string | null) => void
  scoreRange: ScoreRange | null
  onScoreRangeChange: (range: ScoreRange | null) => void
  sentimentFilter: Sentiment | null
  onSentimentFilterChange: (sentiment: Sentiment | null) => void
}

export function Conversations(props: ConversationsProps) {
  const {
    selectedConversationId,
    onSelectConversation,
    onCloseDetail,
    agentFilter,
    contentGapFilter,
    onContentGapFilterChange,
    scoreRange,
    onScoreRangeChange,
    sentimentFilter,
    onSentimentFilterChange,
  } = props

  const mediaIndex = useMediaIndex()

  const dialogId = useId()

  return (
    <Flex height="fill" sizing="border">
      <Box flex={1.5}>
        <Card height="fill" overflow="hidden" borderRight={!!selectedConversationId}>
          <ConversationList
            onSelect={onSelectConversation}
            selectedId={selectedConversationId}
            agentFilter={agentFilter}
            contentGapFilter={contentGapFilter}
            onContentGapFilterChange={onContentGapFilterChange}
            scoreRange={scoreRange}
            onScoreRangeChange={onScoreRangeChange}
            sentimentFilter={sentimentFilter}
            onSentimentFilterChange={onSentimentFilterChange}
          />
        </Card>
      </Box>

      {selectedConversationId && (
        <>
          {mediaIndex >= 4 ? (
            <Card flex={1} height="fill" overflow="hidden">
              <ConversationDetail conversationId={selectedConversationId} onClose={onCloseDetail} />
            </Card>
          ) : (
            <Dialog
              animate
              header="Conversation details"
              id={dialogId}
              onClose={onCloseDetail}
              onClickOutside={onCloseDetail}
              width={1}
            >
              <ConversationDetail conversationId={selectedConversationId} />
            </Dialog>
          )}
        </>
      )}
    </Flex>
  )
}
