import {Box, Button, Card, Flex, Stack, Text} from '@sanity/ui'
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  DEFAULT_STUDIO_CLIENT_OPTIONS,
  getValueAtPath,
  type InputProps,
  useClient,
  useDataset,
  useProjectId,
} from 'sanity'

import {CheckmarkIcon, CopyIcon} from '../../icons'
import {getMcpURL} from './mcpUrlUtils'

const MIGRATION_GUIDE_URL = 'https://www.sanity.io/docs/ai/context-migration-guide'

export function ContextDocumentInput(props: InputProps) {
  const dataset = useDataset()
  const projectId = useProjectId()
  const apiHost = useClient(DEFAULT_STUDIO_CLIENT_OPTIONS).config().apiHost

  const slug = getValueAtPath(props.value, ['slug'])
  const mcpURL = getMcpURL({apiHost, projectId, dataset, slug})

  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(copyTimeoutRef.current), [])

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(mcpURL)
      .then(() => {
        setCopied(true)
        clearTimeout(copyTimeoutRef.current)
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => null)
  }, [mcpURL])

  return (
    <>
      <Stack marginBottom={5} space={3}>
        <Card shadow={1} padding={4} radius={3} tone="caution">
          <Stack space={3}>
            <Text size={1} weight="medium">
              This document type is deprecated
            </Text>

            <Text size={1} muted>
              Context configuration has moved to the Context app in the Sanity Dashboard.
            </Text>

            <Text size={1}>
              <a href={MIGRATION_GUIDE_URL} target="_blank" rel="noopener noreferrer">
                Read the migration guide &rarr;
              </a>
            </Text>
          </Stack>
        </Card>

        <Card shadow={1} padding={4} radius={3} tone="primary">
          <Stack space={2}>
            <Flex align="center" gap={1} style={{position: 'relative'}}>
              <Box flex={1} marginBottom={1}>
                <Text size={1} muted weight="medium">
                  MCP URL
                </Text>
              </Box>

              {mcpURL ? (
                <Button
                  aria-label={copied ? 'Copied' : 'Copy MCP URL'}
                  fontSize={1}
                  icon={copied ? CheckmarkIcon : CopyIcon}
                  mode="bleed"
                  onClick={handleCopy}
                  padding={2}
                  style={{position: 'absolute', right: 0}}
                />
              ) : null}
            </Flex>

            <Text size={1} muted>
              {mcpURL
                ? mcpURL
                : 'No slug found. Please generate a slug to see the Context MCP URL.'}
            </Text>
          </Stack>
        </Card>
      </Stack>

      {props.renderDefault(props)}
    </>
  )
}
