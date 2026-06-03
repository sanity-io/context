import {
  CheckmarkIcon,
  ChevronDownIcon,
  CloseIcon,
  ErrorOutlineIcon,
  GroqIcon,
  ListIcon,
} from '@sanity/icons'
import {
  Box,
  Button,
  Card,
  Flex,
  Popover,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Text,
  TextArea,
  TextInput,
  Tooltip,
  useClickOutsideEvent,
} from '@sanity/ui'
import {useCallback, useMemo, useRef, useState} from 'react'
import {
  CommandList,
  SanityDefaultPreview,
  set,
  type StringInputProps,
  unset,
  useSchema,
} from 'sanity'
import {styled} from 'styled-components'

import {isSimpleTypeQuery, listToQuery, queryToList, validateGroqFilter} from './groqUtils'
import {useComposedRefs} from './useComposedRefs'

const GroqFilterTextArea = styled(TextArea)`
  font-family: monospace;

  &[data-as='textarea'] {
    resize: vertical;
    min-height: 100px;
  }
`

const TAB_IDS = {
  TYPES_TAB: 'types-tab',
  TYPES_PANEL: 'types-panel',
  GROQ_TAB: 'groq-tab',
  GROQ_PANEL: 'groq-panel',
} as const

const ITEM_HEIGHT = 43

export function GroqFilterInput(props: StringInputProps) {
  const {value, onChange, elementProps} = props
  const {ref: refProp, ...restElementProps} = elementProps || {}

  const [open, setOpen] = useState<boolean>(false)
  const [inputElement, setInputElement] = useState<HTMLInputElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const openListButtonRef = useRef<HTMLButtonElement>(null)
  const [searchQuery, setSearchQuery] = useState<string | null>(null)

  const schema = useSchema()

  // Compose the input ref with the ref prop
  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node
    setInputElement(node)
  }, [])
  const composedRef = useComposedRefs(setInputRef, refProp)

  // Check if the current query is simple enough to edit via Types UI
  const isSimple = useMemo(() => isSimpleTypeQuery(value), [value])

  // Validate GROQ filter expression
  const validation = useMemo(() => validateGroqFilter(value), [value])

  // Initialize view based on whether the current query is simple or complex
  const [panel, setPanel] = useState<'types' | 'groq'>(() =>
    isSimpleTypeQuery(value) ? 'types' : 'groq',
  )

  const selectedTypes = useMemo(() => {
    if (!value) return []
    return queryToList(value)
  }, [value])

  // Filter the type names based on the search query
  const filteredTypeNames = useMemo(() => {
    const types = schema._original?.types || []
    const typeNames = types
      .filter((type) => type.type === 'document' && !type.name.startsWith('sanity.'))
      .map((type) => type.name)
    if (!searchQuery) return typeNames

    return typeNames.filter((name) => name.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [searchQuery, schema._original?.types])

  // Handle document type item click.
  // 1. If the item is already selected, remove it from the selected types.
  // 2. If the item is not selected, add it to the selected types.
  // 3. Transform the updated selected types into a GROQ query and set it as the new value.
  const handleDocumentTypeItemClick = useCallback(
    (item: string) => {
      const nextValue = selectedTypes.includes(item)
        ? selectedTypes.filter((t) => t !== item)
        : [...selectedTypes, item]

      onChange(nextValue.length > 0 ? set(listToQuery(nextValue)) : unset())
    },
    [selectedTypes, onChange],
  )

  const closeList = useCallback(() => {
    setOpen(false)
    setSearchQuery(null)
  }, [])

  const handleToggleList = useCallback(() => {
    if (open) {
      closeList()
    } else {
      setOpen(true)
      inputRef.current?.focus()
    }
  }, [open, closeList])

  const handleTextInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        closeList()
      }
    },
    [closeList],
  )

  const getItemSelected = useCallback(
    (index: number) => {
      const item = filteredTypeNames[index]
      return item ? selectedTypes.includes(item) : false
    },
    [filteredTypeNames, selectedTypes],
  )

  useClickOutsideEvent(closeList, () => [
    popoverRef.current,
    inputRef.current,
    openListButtonRef.current,
  ])

  const isListOpen = open || searchQuery !== null

  // If query is complex or invalid, force GROQ panel regardless of selection
  const effectivePanel = !isSimple || !validation.valid ? 'groq' : panel

  return (
    <Stack space={2}>
      <TabList space={1}>
        <Tooltip
          animate
          disabled={isSimple && validation.valid}
          content={
            <Box padding={1} style={{maxWidth: '200px'}}>
              <Text size={1}>
                {!validation.valid
                  ? 'The current filter has a syntax error that needs to be fixed in the GROQ tab.'
                  : 'The current filter is too complex to edit here. Use the GROQ tab to edit it.'}
              </Text>
            </Box>
          }
          delay={{open: 200, close: 0}}
          placement="bottom"
          portal
        >
          <div>
            <Tab
              aria-controls={TAB_IDS.TYPES_PANEL}
              disabled={!isSimple || !validation.valid}
              icon={ListIcon}
              id={TAB_IDS.TYPES_TAB}
              label="Types"
              onClick={() => isSimple && validation.valid && setPanel('types')}
              padding={3}
              selected={effectivePanel === 'types'}
            />
          </div>
        </Tooltip>

        <Tab
          aria-controls={TAB_IDS.GROQ_PANEL}
          icon={GroqIcon}
          id={TAB_IDS.GROQ_TAB}
          label="GROQ"
          onClick={() => setPanel('groq')}
          padding={3}
          selected={effectivePanel === 'groq'}
        />
      </TabList>

      {/* ----- Types panel ----- */}
      <TabPanel
        aria-labelledby={TAB_IDS.TYPES_TAB}
        hidden={effectivePanel !== 'types'}
        id={TAB_IDS.TYPES_PANEL}
        tabIndex={-1}
      >
        <Stack space={3}>
          <Popover
            animate
            constrainSize
            fallbackPlacements={['bottom', 'top']}
            matchReferenceWidth
            open={isListOpen}
            placement="bottom"
            portal
            ref={popoverRef}
            content={
              <Flex direction="column" height="fill">
                {filteredTypeNames.length === 0 && (
                  <Flex direction="column" overflow="hidden" flex={1} padding={5}>
                    <Text align="center" size={1}>
                      No document types found matching <b>{`"${searchQuery}"`}</b>
                    </Text>
                  </Flex>
                )}

                {filteredTypeNames.length > 0 && (
                  <Flex direction="column" overflow="hidden" flex={1}>
                    <CommandList
                      activeItemDataAttr="data-hovered"
                      ariaLabel="Document Types"
                      ariaMultiselectable
                      fixedHeight
                      getItemKey={(item) => item}
                      getItemSelected={getItemSelected}
                      inputElement={inputElement}
                      itemHeight={ITEM_HEIGHT}
                      padding={1}
                      items={filteredTypeNames}
                      renderItem={(documentTypeName) => {
                        const isSelected = selectedTypes.includes(documentTypeName)
                        const schemaType = schema.get(documentTypeName)

                        return (
                          <Stack key={documentTypeName} padding={1}>
                            <Button
                              aria-label={`${isSelected ? 'Remove' : 'Add'} ${documentTypeName} to filter`}
                              aria-selected={isSelected}
                              mode="bleed"
                              onClick={() => handleDocumentTypeItemClick(documentTypeName)}
                              padding={0}
                            >
                              <Flex align="center" gap={2}>
                                <Box flex={1}>
                                  <SanityDefaultPreview
                                    layout="compact"
                                    title={schemaType?.title || documentTypeName}
                                    schemaType={schemaType}
                                    icon={schemaType?.icon}
                                  />
                                </Box>

                                {isSelected && (
                                  <Box paddingX={3}>
                                    <Text size={1}>
                                      <CheckmarkIcon />
                                    </Text>
                                  </Box>
                                )}
                              </Flex>
                            </Button>
                          </Stack>
                        )
                      }}
                    />
                  </Flex>
                )}
              </Flex>
            }
          >
            <Card display="flex" border radius={2} overflow="hidden">
              <Card flex={1} borderRight>
                <TextInput
                  {...restElementProps}
                  autoComplete="off"
                  border={false}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={handleTextInputKeyDown}
                  placeholder="Search for document types"
                  radius={0}
                  ref={composedRef}
                  value={searchQuery || ''}
                />
              </Card>

              <Flex align="center" justify="center" sizing="border" padding={1} height="fill">
                <Button
                  aria-label="Open document types list"
                  disabled={isListOpen}
                  icon={ChevronDownIcon}
                  mode="bleed"
                  onClick={handleToggleList}
                  padding={2}
                  ref={openListButtonRef}
                />
              </Flex>
            </Card>
          </Popover>

          <Flex wrap="wrap" gap={2}>
            {selectedTypes.map((type) => {
              const title = schema.get(type)?.title || type

              return (
                <Card key={type} padding={1} radius={3} border tone="transparent" paddingLeft={2}>
                  <Flex align="center" gap={1} overflow="hidden">
                    <Box flex={1}>
                      <Text size={1} weight="medium" textOverflow="ellipsis">
                        {title}
                      </Text>
                    </Box>

                    <Button
                      aria-label="Remove {type} from filter"
                      fontSize={0}
                      icon={CloseIcon}
                      mode="bleed"
                      onClick={() => handleDocumentTypeItemClick(type)}
                      padding={2}
                    />
                  </Flex>
                </Card>
              )
            })}
          </Flex>
        </Stack>
      </TabPanel>

      {/* ----- GROQ panel ----- */}
      <TabPanel
        aria-labelledby={TAB_IDS.GROQ_TAB}
        hidden={effectivePanel !== 'groq'}
        id={TAB_IDS.GROQ_PANEL}
        tabIndex={-1}
      >
        <Stack space={3}>
          <GroqFilterTextArea
            {...restElementProps}
            onChange={(event) =>
              onChange(event.currentTarget.value ? set(event.currentTarget.value) : unset())
            }
            placeholder='_type in ["author", "post"]'
            value={value || ''}
            padding={4}
          />
        </Stack>
      </TabPanel>

      {/* ----- Result and validation errors ----- */}
      {!validation.valid && (
        <Card padding={3} radius={2} tone="critical" border>
          <Flex align="flex-start" gap={2}>
            <Text size={1}>
              <ErrorOutlineIcon />
            </Text>

            <Text size={1}>{validation.error}</Text>
          </Flex>
        </Card>
      )}
    </Stack>
  )
}
