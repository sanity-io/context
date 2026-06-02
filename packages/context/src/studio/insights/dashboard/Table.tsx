import {ArrowDownIcon, ArrowUpIcon} from '@sanity/icons'
import {Box, Button, Flex, Text} from '@sanity/ui'
import {styled} from 'styled-components'

// ------------------------------
// Table Root
// ------------------------------

interface TableRootProps {
  children: React.ReactNode
}

function TableRoot(props: TableRootProps) {
  const {children} = props

  return (
    <Flex role="table" direction="column" flex={1} overflow="hidden">
      {children}
    </Flex>
  )
}

// ------------------------------
// Table Row
// ------------------------------

interface TableRowProps {
  children: React.ReactNode
  paddingY?: number
}

function TableRow(props: TableRowProps) {
  const {children, paddingY = 3} = props

  return (
    <Flex role="row" align="center" gap={3} paddingX={4} paddingY={paddingY}>
      {children}
    </Flex>
  )
}

// ------------------------------
// Table Heading
// ------------------------------

const SortButton = styled(Button)`
  transform: translateX(-6px);

  [data-sanity-icon] {
    opacity: 0;
    transition: opacity 100ms;
  }

  &:hover [data-sanity-icon],
  &:focus-visible [data-sanity-icon],
  &[data-active] [data-sanity-icon] {
    opacity: 1;
  }
`

interface TableHeadingSort {
  active: boolean
  direction: 'asc' | 'desc'
  onToggle: () => void
}

interface TableHeadingProps {
  title: string
  flex: number
  sort?: TableHeadingSort
}

function TableHeading(props: TableHeadingProps) {
  const {title, flex, sort} = props

  if (!sort) {
    return (
      <Box role="columnheader" flex={flex} paddingY={1}>
        <Box paddingY={2}>
          <Text size={0} weight="medium" muted textOverflow="ellipsis">
            {title}
          </Text>
        </Box>
      </Box>
    )
  }

  const handleToggleSort = sort.onToggle
  const icon = sort.active && sort.direction === 'asc' ? ArrowUpIcon : ArrowDownIcon

  return (
    <Box role="columnheader" flex={flex} paddingY={1}>
      <SortButton
        aria-label={`Sort by ${title}`}
        data-active={sort.active || undefined}
        fontSize={0}
        iconRight={icon}
        mode="bleed"
        onClick={handleToggleSort}
        padding={2}
        text={title}
      />
    </Box>
  )
}

// ------------------------------
// Table Cell
// ------------------------------

interface TableCellProps {
  children: React.ReactNode
  flex: number
}

function TableCell(props: TableCellProps) {
  const {children, flex} = props

  return (
    <Flex role="cell" align="center" flex={flex} height="fill">
      {children}
    </Flex>
  )
}

export const Table = Object.freeze({
  Root: TableRoot,
  Row: TableRow,
  Cell: TableCell,
  Heading: TableHeading,
})
