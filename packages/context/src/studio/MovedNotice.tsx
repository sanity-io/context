import {Button, Card, Flex, Heading, Stack, Text} from '@sanity/ui'
import {useEffect, useState} from 'react'
import {DEFAULT_STUDIO_CLIENT_OPTIONS, useClient, useProjectId} from 'sanity'

import {LaunchIcon} from './icons'

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
            <Text muted>
              <span aria-hidden="true" style={{display: 'flex', fontSize: 45, lineHeight: 1}}>
                <LaunchIcon />
              </span>
            </Text>

            <Stack gap={4} style={{maxWidth: 320, textAlign: 'center'}}>
              <Heading as="h2" size={3}>
                Context has moved
              </Heading>

              <Text size={2} muted>
                Context MCP configuration and Insights now live in the Context app in the Sanity
                Dashboard.
              </Text>

              <Text size={1}>
                <a href={MIGRATION_GUIDE_URL} target="_blank" rel="noopener noreferrer">
                  Read the migration guide &rarr;
                </a>
              </Text>
            </Stack>

            <Button
              as="a"
              fontSize={1}
              href={href}
              icon={LaunchIcon}
              mode="default"
              padding={3}
              rel="noopener noreferrer"
              target="_blank"
              text="Open the Context app"
            />
          </Flex>
        </Flex>
      </Card>
    </Flex>
  )
}
