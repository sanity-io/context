import {CheckmarkIcon, ChevronDownIcon, CommentIcon, DashboardIcon} from '@sanity/icons'
import {Box, Button, Card, Flex, Menu, MenuButton, MenuDivider, MenuItem, Stack} from '@sanity/ui'
import {Activity, useId, useState} from 'react'
import {useRouter} from 'sanity/router'
import {styled} from 'styled-components'

import {CONVERSATION_SCHEMA_TYPE_NAME} from '../../../insights/constants'
import {Conversations} from './conversations/Conversations'
import {Overview} from './overview/Overview'
import type {ScoreRange, Sentiment} from './types'
import {useCompactLayout, useListenQuery} from './utils'

const SidebarCard = styled(Card)`
  width: 220px;

  &[data-compact='true'] {
    width: 100%;
    flex-shrink: 0;
  }
`

/**
 * Main dashboard component for Agent Insights.
 * Provides tabs for analytics overview and conversation browsing.
 */
export function InsightsDashboard() {
  const [contentGapFilter, setContentGapFilter] = useState<string | null>(null)
  const [scoreRange, setScoreRange] = useState<ScoreRange | null>(null)
  const [sentimentFilter, setSentimentFilter] = useState<Sentiment | null>(null)

  const agentMenuId = useId()
  const compact = useCompactLayout()

  const {data: agentIds} = useListenQuery<string[]>(
    `*[_type == $type]`,
    {type: CONVERSATION_SCHEMA_TYPE_NAME},
    {fetchQuery: `array::unique(*[_type == $type].agentId)`},
  )

  const router = useRouter()
  const path = router.state['path']
  const routerAgentId = router.state['agentId']
  const routerId = router.state['id']
  const agentFilter =
    typeof routerAgentId === 'string' && routerAgentId !== '*' ? routerAgentId : null
  const selectedConversationId = typeof routerId === 'string' ? routerId : null

  const navigateTo = (newPath: string, agentId?: string | null, id?: string) => {
    const agent = agentId === undefined ? agentFilter : agentId
    const state: Record<string, string> = {path: newPath}

    if (agent) {
      state['agentId'] = agent
    }

    if (id) {
      if (!agent) state['agentId'] = '*'
      state['id'] = id
    }

    router.navigate(state)
  }

  const setAgentFilter = (id: string | null) => {
    navigateTo(typeof path === 'string' ? path : 'overview', id)
  }

  const isOverviewActive = path === 'overview' || !path
  const isConversationsActive = path === 'conversations'

  return (
    <Card sizing="border" height="fill" overflow="hidden">
      <Flex height="fill" direction={['column', 'column', 'column', 'row']}>
        <SidebarCard
          borderBottom={compact}
          borderRight={!compact}
          data-compact={compact}
          padding={compact ? 2 : 3}
          tone="transparent"
          sizing="border"
        >
          <Flex
            direction={compact ? 'row' : 'column'}
            align={compact ? 'center' : 'stretch'}
            justify={compact ? undefined : 'space-between'}
            gap={compact ? 2 : 4}
          >
            <Stack flex={compact ? undefined : 1}>
              <MenuButton
                button={
                  <Button
                    text={agentFilter || 'All agents'}
                    mode="ghost"
                    fontSize={1}
                    iconRight={ChevronDownIcon}
                    justify={compact ? undefined : 'space-between'}
                  />
                }
                id={agentMenuId}
                popover={{
                  animate: true,
                  constrainSize: true,
                  placement: compact ? 'bottom-start' : 'bottom',
                  fallbackPlacements: [compact ? 'bottom-start' : 'bottom'],
                  tone: 'default',
                  matchReferenceWidth: !compact,
                }}
                menu={
                  <Menu>
                    <MenuItem
                      text="All agents"
                      onClick={() => setAgentFilter(null)}
                      iconRight={agentFilter ? undefined : CheckmarkIcon}
                    />

                    {agentIds && agentIds.length > 0 && <MenuDivider />}

                    {agentIds?.map((id) => {
                      const isSelected = agentFilter === id

                      return (
                        <MenuItem
                          key={id}
                          text={id}
                          value={id}
                          onClick={() => setAgentFilter(id)}
                          iconRight={isSelected ? CheckmarkIcon : undefined}
                        />
                      )
                    })}
                  </Menu>
                }
              />
            </Stack>

            {compact ? (
              <Flex gap={1} flex={1} justify="flex-end">
                <Button
                  aria-label="Overview"
                  fontSize={1}
                  mode="bleed"
                  icon={DashboardIcon}
                  selected={isOverviewActive}
                  onClick={() => navigateTo('overview')}
                />

                <Button
                  aria-label="Conversations"
                  fontSize={1}
                  mode="bleed"
                  icon={CommentIcon}
                  selected={isConversationsActive}
                  onClick={() => navigateTo('conversations')}
                />
              </Flex>
            ) : (
              <Stack space={2}>
                <Button
                  fontSize={1}
                  mode="bleed"
                  text="Overview"
                  icon={DashboardIcon}
                  selected={isOverviewActive}
                  onClick={() => navigateTo('overview')}
                  justify="flex-start"
                />

                <Button
                  fontSize={1}
                  mode="bleed"
                  icon={CommentIcon}
                  text="Conversations"
                  selected={isConversationsActive}
                  onClick={() => navigateTo('conversations')}
                  justify="flex-start"
                />
              </Stack>
            )}
          </Flex>
        </SidebarCard>

        <Flex flex={1} direction="column" overflow="hidden">
          <Activity mode={isOverviewActive ? 'visible' : 'hidden'}>
            <Box flex={1} height="fill" overflow="auto">
              <Overview
                agentFilter={agentFilter}
                onContentGapClick={(gap) => {
                  setContentGapFilter(gap)
                  navigateTo('conversations')
                }}
              />
            </Box>
          </Activity>

          <Activity mode={isConversationsActive ? 'visible' : 'hidden'}>
            <Conversations
              selectedConversationId={selectedConversationId}
              onSelectConversation={(id) => {
                if (selectedConversationId === id) {
                  navigateTo('conversations')
                } else {
                  navigateTo('conversations', undefined, id)
                }
              }}
              onCloseDetail={() => navigateTo('conversations')}
              agentFilter={agentFilter}
              contentGapFilter={contentGapFilter}
              onContentGapFilterChange={setContentGapFilter}
              scoreRange={scoreRange}
              onScoreRangeChange={setScoreRange}
              sentimentFilter={sentimentFilter}
              onSentimentFilterChange={setSentimentFilter}
            />
          </Activity>
        </Flex>
      </Flex>
    </Card>
  )
}
