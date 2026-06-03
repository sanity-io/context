import {InfoOutlineIcon} from '@sanity/icons'
import {Box, Flex, Text, type TextProps, Tooltip} from '@sanity/ui'
import type React from 'react'

interface TextWithInfoProps extends Omit<TextProps, 'as' | 'ref'> {
  children: React.ReactNode
  info: React.ReactNode
}

export function TextWithInfo(props: TextWithInfoProps) {
  const {info, children, ...textProps} = props

  return (
    <Flex align="center" gap={2}>
      <Box>
        <Text {...textProps}>{children}</Text>
      </Box>

      <Tooltip
        animate
        content={<Text size={1}>{info}</Text>}
        style={{maxWidth: 320}}
        padding={3}
        placement="bottom"
      >
        <Box>
          <Text {...textProps}>
            <InfoOutlineIcon />
          </Text>
        </Box>
      </Tooltip>
    </Flex>
  )
}
