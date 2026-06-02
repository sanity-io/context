import type {UIMessage} from 'ai'
import {useEffect} from 'react'

import {styles} from '../styles'
import {JsonTree} from './JsonTree'

type Part = UIMessage['parts'][number]

export type ToolCallData = {
  name: string
  state?: string
  input: unknown
  output?: unknown
  errorText?: string
  hasOutput: boolean
  hasError: boolean
}

/** Normalize a static (`tool-<name>`) or dynamic (MCP) tool part into one shape. */
export function toToolCall(part: Part): ToolCallData {
  const p = part as {
    type: string
    toolName?: string
    state?: string
    input?: unknown
    output?: unknown
    errorText?: string
  }
  const name = p.toolName ?? p.type.replace(/^tool-/, '')
  return {
    name,
    state: p.state,
    input: p.input,
    output: p.output,
    errorText: p.errorText,
    hasOutput: p.output !== undefined,
    hasError: Boolean(p.errorText),
  }
}

/**
 * Compact inline representation of a tool call: a single clickable chip showing
 * the name and state. Clicking opens the detail panel — the full input/output
 * lives there, not in the chat flow, so big MCP payloads don't bloat the page.
 */
export function ToolCall({part, onOpen}: {part: Part; onOpen: (call: ToolCallData) => void}) {
  const call = toToolCall(part)

  return (
    <button type="button" style={styles.toolChip} onClick={() => onOpen(call)}>
      🔧 <span style={styles.toolChipName}>{call.name}</span>
      {call.hasError ? (
        <span style={styles.toolChipError}>error</span>
      ) : (
        <span style={styles.toolChipState}>{call.state}</span>
      )}
      <span style={styles.toolChipChevron}>›</span>
    </button>
  )
}

/**
 * The slide-in panel showing a tool call's input and output as expandable JSON
 * trees. MCP tool output is unwrapped (the result is double-encoded as a JSON
 * string inside `content[].text`) so it renders as real, navigable JSON.
 */
export function ToolDetailPanel({call, onClose}: {call: ToolCallData; onClose: () => void}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div style={styles.panelBackdrop} onClick={onClose} />
      <div style={styles.panel} role="dialog" aria-label={`${call.name} details`}>
        <div style={styles.panelHeader}>
          🔧 <span style={styles.panelTitle}>{call.name}</span>
          {call.state && <span style={styles.toolChipState}>{call.state}</span>}
          <button type="button" style={styles.panelClose} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={styles.panelBody}>
          <div style={styles.toolLabel}>input</div>
          <div style={styles.panelInput}>
            <JsonTree value={call.input} />
          </div>

          {call.hasError ? (
            <>
              <div style={styles.toolLabel}>error</div>
              <pre style={{...styles.pre, color: '#b00'}}>{call.errorText}</pre>
            </>
          ) : (
            <>
              <div style={styles.toolLabel}>output</div>
              {call.hasOutput ? (
                <JsonTree value={unwrapMcpOutput(call.output)} />
              ) : (
                <div style={styles.treeMuted}>(pending…)</div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * MCP tool results arrive as `{content: [{type: "text", text: "<json string>"}]}`
 * — the actual data is JSON re-encoded as a string. Unwrap and parse it so it
 * renders as a real object. If the shape doesn't match, return the value as-is.
 */
export function unwrapMcpOutput(output: unknown): unknown {
  if (!output || typeof output !== 'object') return output
  const content = (output as {content?: unknown}).content
  if (!Array.isArray(content)) return output

  const parsed = content.map((item) => {
    if (item && typeof item === 'object' && (item as {type?: string}).type === 'text') {
      const text = (item as {text?: unknown}).text
      if (typeof text === 'string') {
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
    }
    return item
  })

  // A single text block is the common case — return the parsed object directly
  // rather than wrapping it in a one-element array.
  return parsed.length === 1 ? parsed[0] : parsed
}
