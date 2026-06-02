import {useState} from 'react'

import {styles} from '../styles'

/**
 * A minimal collapsible JSON tree. Every node starts fully expanded; click the
 * caret next to an object/array to collapse it. No external dependencies.
 */
export function JsonTree({value}: {value: unknown}) {
  return (
    <div style={styles.treeWrap}>
      <Node value={value} depth={0} isLast />
    </div>
  )
}

function Node({
  value,
  depth,
  keyName,
  isLast,
}: {
  value: unknown
  depth: number
  keyName?: string
  isLast: boolean
}) {
  const [open, setOpen] = useState(true)

  const indent = {paddingLeft: depth === 0 ? 0 : 14}
  const keyLabel = keyName !== undefined && (
    <>
      <span style={styles.treeKey}>"{keyName}"</span>
      <span style={styles.treePunct}>: </span>
    </>
  )
  const comma = isLast ? null : <span style={styles.treePunct}>,</span>

  // Primitives render on a single line.
  if (value === null || typeof value !== 'object') {
    return (
      <div style={indent}>
        {keyLabel}
        <Primitive value={value} />
        {comma}
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)

  const open_b = isArray ? '[' : '{'
  const close_b = isArray ? ']' : '}'

  // Empty object/array on one line.
  if (entries.length === 0) {
    return (
      <div style={indent}>
        {keyLabel}
        <span style={styles.treePunct}>
          {open_b}
          {close_b}
        </span>
        {comma}
      </div>
    )
  }

  return (
    <div style={indent}>
      <div>
        <span style={styles.treeToggle} onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'}
        </span>
        {keyLabel}
        <span style={styles.treePunct}>{open_b}</span>
        {!open && (
          <>
            <span style={styles.treeMuted}>
              {' '}
              {entries.length} {isArray ? 'items' : 'keys'}{' '}
            </span>
            <span style={styles.treePunct}>{close_b}</span>
            {comma}
          </>
        )}
      </div>

      {open && (
        <>
          {entries.map(([k, v], i) => (
            <Node
              key={k}
              keyName={isArray ? undefined : k}
              value={v}
              depth={depth + 1}
              isLast={i === entries.length - 1}
            />
          ))}
          <div style={{paddingLeft: 14}}>
            <span style={styles.treePunct}>{close_b}</span>
            {comma}
          </div>
        </>
      )}
    </div>
  )
}

function Primitive({value}: {value: unknown}) {
  if (value === null) return <span style={styles.treeNull}>null</span>
  if (typeof value === 'string') return <span style={styles.treeString}>"{value}"</span>
  if (typeof value === 'number') return <span style={styles.treeNumber}>{value}</span>
  if (typeof value === 'boolean') return <span style={styles.treeBool}>{String(value)}</span>
  return <span>{String(value)}</span>
}
