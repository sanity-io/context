import {ChevronRightIcon} from '@sanity/icons'
import {Box, Card, Flex, Text} from '@sanity/ui'

interface ContentGapRowProps {
  description: string
  count: number
  onClick: (description: string) => void
}

export function ContentGapRow(props: ContentGapRowProps) {
  const {description, count, onClick} = props

  return (
    <Card
      __unstable_focusRing
      padding={3}
      radius={3}
      tone="caution"
      as="button"
      onClick={() => onClick(description)}
      aria-label={`Filter by content gap: ${description}`}
      style={{cursor: 'pointer', textAlign: 'left', width: '100%', border: 'none'}}
    >
      <Flex align="center" gap={2}>
        <Box flex={1}>
          <Text size={1}>{description}</Text>
        </Box>

        <Flex align="center" gap={2}>
          <Text size={0} muted>
            {`${count} ${count === 1 ? 'conversation' : 'conversations'}`}
          </Text>

          <ChevronRightIcon style={{fontSize: 16, opacity: 0.6}} />
        </Flex>
      </Flex>
    </Card>
  )
}
