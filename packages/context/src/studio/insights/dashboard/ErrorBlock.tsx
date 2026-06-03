import {RetryIcon} from '@sanity/icons'
import {Button, Card, Container, Flex, Stack, Text} from '@sanity/ui'

interface ErrorBlockProps {
  message: string
  fill?: boolean
  onRetry?: () => void
}

export function ErrorBlock(props: ErrorBlockProps) {
  const {message, fill, onRetry} = props

  return (
    <Flex align="center" justify="center" height={fill ? 'fill' : undefined} padding={4}>
      <Container width={1}>
        <Card padding={4} tone="critical" border radius={3}>
          <Stack space={4}>
            <Stack space={3}>
              <Text weight="semibold">Something went wrong</Text>

              <Text size={1} muted>
                {message}
              </Text>
            </Stack>

            {onRetry && (
              <Flex>
                <Button
                  padding={2}
                  fontSize={1}
                  text="Try again"
                  mode="ghost"
                  icon={RetryIcon}
                  onClick={onRetry}
                />
              </Flex>
            )}
          </Stack>
        </Card>
      </Container>
    </Flex>
  )
}
