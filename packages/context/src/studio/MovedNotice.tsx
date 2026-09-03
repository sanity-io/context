import {Button, Card, Flex, Heading, Stack, Text} from '@sanity/ui'
import {useEffect, useState} from 'react'
import {DEFAULT_STUDIO_CLIENT_OPTIONS, useClient, useProjectId} from 'sanity'

import {ArrowTopRightIcon} from './icons'

const FALLBACK_URL = 'https://www.sanity.io'
const MIGRATION_GUIDE_URL = 'https://www.sanity.io/docs/ai/context-migration-guide'

function useContextAppUrl(path: string): string {
  const projectId = useProjectId()
  const client = useClient(DEFAULT_STUDIO_CLIENT_OPTIONS)
  const [organizationId, setOrganizationId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    client
      .request<{organizationId?: string | null}>({uri: `/projects/${projectId}`})
      .then((project) => {
        if (!cancelled && project.organizationId && project.organizationId !== 'oSystemUnclaimed') {
          setOrganizationId(project.organizationId)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [client, projectId])

  if (!organizationId) {
    return FALLBACK_URL
  }

  const apiHost = client.config().apiHost
  if (!apiHost.startsWith('https://api.')) {
    return FALLBACK_URL
  }

  return `${apiHost.replace('https://api.', 'https://www.')}/@${organizationId}${path}`
}

export function InsightsMovedNotice() {
  const href = useContextAppUrl('/context')

  return (
    <Flex height="fill" padding={3} sizing="border">
      <Card display="flex" flex={1} padding={5} radius={4} tone="transparent">
        <Flex align="center" flex={1} justify="center">
          <Flex direction="column" align="center" gap={5} paddingY={5}>
            <Stack gap={4} style={{maxWidth: 320, textAlign: 'center'}}>
              <Heading as="h2" size={3}>
                Insights has moved
              </Heading>

              <Text size={2} muted>
                Insights now lives in the Context app in the Sanity Dashboard, where you can browse
                conversation history and metrics.
              </Text>
            </Stack>

            <Flex gap={2} wrap="wrap" justify="center">
              <Button
                as="a"
                fontSize={1}
                href={MIGRATION_GUIDE_URL}
                iconRight={ArrowTopRightIcon}
                mode="default"
                padding={3}
                rel="noopener noreferrer"
                target="_blank"
                text="Read the migration guide"
                tone="primary"
              />

              <Button
                as="a"
                fontSize={1}
                href={href}
                iconRight={ArrowTopRightIcon}
                mode="ghost"
                padding={3}
                rel="noopener noreferrer"
                target="_blank"
                text="Open Context app"
              />
            </Flex>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  )
}
