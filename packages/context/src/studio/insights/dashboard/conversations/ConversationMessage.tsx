import {ChevronDownIcon, RobotIcon, UserIcon, WrenchIcon} from '@sanity/icons'
import {Box, Card, type CardTone, Code, Flex, Text} from '@sanity/ui'
import {useMemo, useState} from 'react'

import type {ConversationMessage as ConversationMessageType} from '../types'

const INLINE_TOOL_CALL_RE = /^\s*\[Tool call:\s*(\w+)\]\s*(.*)?$/s

type MessageRole = ConversationMessageType['role']

const ROLE_ICONS: Record<MessageRole, React.ReactNode> = {
  user: <UserIcon />,
  assistant: <RobotIcon />,
  system: <RobotIcon />,
  tool: <WrenchIcon />,
}

const ROLE_TONES: Record<MessageRole, CardTone> = {
  user: 'default',
  assistant: 'transparent',
  system: 'transparent',
  tool: 'transparent',
}

interface ToolCall {
  toolName: string
  args: string | null
}

/**
 * Extracts tool call info from either format:
 * - Structured: message has `toolName` field, args in `content`
 * - Inline: content is `[Tool call: toolName]` or `[Tool call: toolName] {...}`
 */
function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function parseToolCall(message: ConversationMessageType): ToolCall | null {
  if (message.toolName) {
    const args = message.content && message.content !== '{}' ? message.content : null
    return {toolName: message.toolName, args}
  }

  if (message.role === 'tool' && message.content) {
    const match = message.content.match(INLINE_TOOL_CALL_RE)
    if (match) {
      const args = match[2]?.trim() || null
      return {toolName: match[1] ?? 'unknown', args: args && args !== '{}' ? args : null}
    }
  }

  return null
}

interface ConversationMessageProps {
  message: ConversationMessageType
}

export function ConversationMessage(props: ConversationMessageProps) {
  const {message} = props
  const [isExpanded, setIsExpanded] = useState(false)

  const toolCall = useMemo(() => parseToolCall(message), [message])

  if (toolCall) {
    return (
      <Flex gap={4}>
        <Box paddingTop={3}>
          <Text size={1}>
            <WrenchIcon />
          </Text>
        </Box>

        <Card overflow="hidden" radius={3} flex={1} border tone="primary">
          <Card
            __unstable_focusRing
            as={toolCall.args ? 'button' : 'div'}
            onClick={toolCall.args ? () => setIsExpanded(!isExpanded) : undefined}
            padding={3}
            radius={0}
            tone="inherit"
            width="fill"
            style={{cursor: toolCall.args ? 'pointer' : undefined}}
          >
            <Flex align="center" gap={3}>
              <Box flex={1}>
                <Code size={0}>{toolCall.toolName}</Code>
              </Box>

              {toolCall.args && (
                <Text size={1} muted>
                  <ChevronDownIcon
                    style={{
                      transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  />
                </Text>
              )}
            </Flex>
          </Card>

          {isExpanded && toolCall.args && (
            <Card padding={4} radius={0} tone="transparent" overflow="auto" borderTop>
              <Code size={1}>{prettyArgs(toolCall.args)}</Code>
            </Card>
          )}
        </Card>
      </Flex>
    )
  }

  return (
    <Flex gap={4}>
      <Box paddingTop={4}>
        <Text aria-label={`Message from ${message.role}`} size={1}>
          {ROLE_ICONS[message.role]}
        </Text>
      </Box>

      <Card padding={4} tone={ROLE_TONES[message.role]} border radius={3} flex={1} overflow="auto">
        <Text size={1}>{message.content}</Text>
      </Card>
    </Flex>
  )
}
