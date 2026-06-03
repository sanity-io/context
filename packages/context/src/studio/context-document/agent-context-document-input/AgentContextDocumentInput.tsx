import {CopyIcon} from '@sanity/icons'
import {Box, Button, Card, Flex, Stack, Text, Tooltip, useToast} from '@sanity/ui'
import {useCallback} from 'react'
import {
  DEFAULT_STUDIO_CLIENT_OPTIONS,
  getValueAtPath,
  type InputProps,
  useClient,
  useDataset,
  useProjectId,
} from 'sanity'
import {styled} from 'styled-components'

import {getMcpURL} from './mcpUrlUtils'

const TitleFlex = styled(Flex)`
  position: relative;
`

const CopyButton = styled(Button)`
  position: absolute;
  right: 0;
`

export function AgentContextDocumentInput(props: InputProps) {
  const dataset = useDataset()
  const projectId = useProjectId()
  const toast = useToast()
  const apiHost = useClient(DEFAULT_STUDIO_CLIENT_OPTIONS).config().apiHost

  const slug = getValueAtPath(props.value, ['slug'])
  const mcpURL = getMcpURL({apiHost, projectId, dataset, slug})

  const handleCopy = useCallback(() => {
    try {
      navigator.clipboard.writeText(mcpURL)
      toast.push({
        title: 'Copied to clipboard',
        description: 'The MCP URL has been copied to your clipboard',
        status: 'success',
        closable: true,
      })
    } catch {
      toast.push({
        title: 'Error copying to clipboard',
        description: 'Please copy the MCP URL manually',
        status: 'error',
        closable: true,
      })
    }
  }, [mcpURL, toast])

  return (
    <>
      <Stack marginBottom={5}>
        <Card shadow={1} padding={4} radius={3} tone="primary">
          <Stack space={2}>
            <TitleFlex align="center" gap={1}>
              <Box flex={1} marginBottom={1}>
                <Text size={1} muted weight="medium">
                  MCP URL
                </Text>
              </Box>

              {mcpURL ? (
                <Tooltip
                  animate
                  content={<Text size={1}>Copy</Text>}
                  delay={{open: 300, close: 0}}
                  placement="top"
                  portal
                >
                  <CopyButton
                    aria-label="Copy MCP URL"
                    fontSize={1}
                    icon={CopyIcon}
                    mode="bleed"
                    onClick={handleCopy}
                    padding={2}
                  />
                </Tooltip>
              ) : null}
            </TitleFlex>

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
