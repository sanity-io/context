import {Card, Flex, Spinner, Text} from '@sanity/ui'

interface LoadingBlockProps {
  message?: string
  fill?: boolean
}

export function LoadingBlock(props: LoadingBlockProps) {
  const {message = 'Loading…', fill} = props

  return (
    <Card padding={4} height={fill ? 'fill' : undefined}>
      <Flex align="center" justify="center" gap={3} height={fill ? 'fill' : undefined}>
        <Spinner size={1} />

        <Text muted size={1}>
          {message}
        </Text>
      </Flex>
    </Card>
  )
}
