import {ErrorOutlineIcon} from '@sanity/icons'
import {Box, Button, Card, Checkbox, Flex, Spinner, Stack, Text} from '@sanity/ui'
import {useCallback, useMemo} from 'react'
import {type ArrayOfPrimitivesInputProps, set, unset} from 'sanity'

import type {KnowledgeBase} from './atlas'
import {useKnowledgeBases} from './useKnowledgeBases'

/**
 * Knowledge-base states that can be attached. 'ready' and 'review' are built
 * (have content to read); states like 'created' are not yet built, so attaching
 * them would give the agent an empty outline — those stay disabled. A missing
 * state is treated as selectable (don't block on unknown shapes).
 */
const SELECTABLE_STATES = new Set(['ready', 'review'])

function isSelectable(kb: KnowledgeBase): boolean {
  return kb.state === undefined || SELECTABLE_STATES.has(kb.state)
}

/**
 * Custom input for the `knowledgeBaseIds` field. Instead of typing knowledge
 * base ids by hand, the editor picks from the org's knowledge bases (fetched
 * from Atlas). The field stores the selected ids; everything else (slug, name,
 * description) is resolved at runtime by context-mcp.
 */
export function KnowledgeBaseInput(props: ArrayOfPrimitivesInputProps) {
  const {onChange} = props
  const selected = useMemo(() => (props.value ?? []) as string[], [props.value])
  const {knowledgeBases, loading, error, retry} = useKnowledgeBases()

  const toggle = useCallback(
    (id: string, checked: boolean) => {
      const next = checked ? [...selected, id] : selected.filter((x) => x !== id)
      onChange(next.length > 0 ? set(next) : unset())
    },
    [onChange, selected],
  )

  if (loading) {
    return (
      <Card padding={4} radius={2} border>
        <Flex align="center" gap={3}>
          <Spinner muted />

          <Text size={1} muted>
            Loading knowledge bases…
          </Text>
        </Flex>
      </Card>
    )
  }

  if (error) {
    return (
      <Card padding={4} radius={2} tone="critical" border>
        <Stack space={3}>
          <Flex align="center" gap={2}>
            <Text size={1}>
              <ErrorOutlineIcon />
            </Text>

            <Text size={1} weight="medium">
              Couldn’t load knowledge bases
            </Text>
          </Flex>

          <Text size={1} muted>
            {error}
          </Text>

          <Box>
            <Button fontSize={1} mode="ghost" onClick={retry} padding={2} text="Retry" />
          </Box>
        </Stack>
      </Card>
    )
  }

  if (knowledgeBases.length === 0) {
    return (
      <Card padding={4} radius={2} tone="transparent" border>
        <Text size={1} muted>
          No knowledge bases found in this organization. Create one to attach it here.
        </Text>
      </Card>
    )
  }

  return (
    <Stack space={2}>
      {knowledgeBases.map((kb) => (
        <KnowledgeBaseRow
          key={kb.id}
          knowledgeBase={kb}
          checked={selected.includes(kb.id)}
          onToggle={toggle}
        />
      ))}
    </Stack>
  )
}

function KnowledgeBaseRow({
  knowledgeBase: kb,
  checked,
  onToggle,
}: {
  knowledgeBase: KnowledgeBase
  checked: boolean
  onToggle: (id: string, checked: boolean) => void
}) {
  const disabled = !isSelectable(kb)

  return (
    <Card
      as="label"
      padding={3}
      radius={2}
      border
      tone={checked ? 'primary' : 'default'}
      style={{cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1}}
    >
      <Stack space={3}>
        <Flex align="center" gap={3}>
          <Checkbox
            checked={checked}
            disabled={disabled}
            onChange={(e) => onToggle(kb.id, e.currentTarget.checked)}
          />

          <Text size={1} weight="medium">
            {kb.name}
          </Text>

          {kb.state && kb.state !== 'ready' && (
            <Text size={0} muted>
              ({kb.state}
              {disabled ? ' — not built yet' : ''})
            </Text>
          )}
        </Flex>

        {kb.description && (
          <Text size={1} muted>
            {kb.description}
          </Text>
        )}
      </Stack>
    </Card>
  )
}
