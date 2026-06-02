import {useEffect, useState} from 'react'

import {styles} from '../styles'
import {JsonTree} from './JsonTree'

type McpTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

/**
 * A slide-in panel that lists the MCP's tools exactly as the agent sees them:
 * name, description, and input schema. Fetched from `/api/tools`, which makes a
 * raw `tools/list` JSON-RPC call so the schemas aren't re-serialized.
 */
export function ToolsInspector({onClose}: {onClose: () => void}) {
  const [tools, setTools] = useState<McpTool[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    fetch('/api/tools')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
        return data
      })
      .then((data) => {
        if (!cancelled) setTools(data.tools ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tools')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <div style={styles.panelBackdrop} onClick={onClose} />
      <div style={styles.panel} role="dialog" aria-label="Available tools">
        <div style={styles.panelHeader}>
          🛠️ <span style={styles.panelTitle}>tools the agent sees</span>
          {tools && <span style={styles.toolChipState}>{tools.length}</span>}
          <button type="button" style={styles.panelClose} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={styles.panelBody}>
          {error && <div style={styles.error}>Error: {error}</div>}
          {!error && !tools && <div style={styles.treeMuted}>Loading…</div>}
          {tools?.length === 0 && <div style={styles.treeMuted}>No tools returned.</div>}

          {tools?.map((tool) => (
            <ToolRow key={tool.name} tool={tool} />
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * One tool in the list: a clickable header row (name + collapsed description
 * preview) that expands to reveal the full description and input schema.
 * Collapsed by default so the panel opens as a scannable list.
 */
/** Summary label for the collapsed description: char count so the size is obvious. */
function descOpenLabel(description: string): string {
  const lines = description.split('\n').length
  return `Show full description (${description.length.toLocaleString()} chars · ${lines} lines)`
}

function ToolRow({tool}: {tool: McpTool}) {
  const [open, setOpen] = useState(false)
  const preview = (tool.description ?? '').replace(/\s+/g, ' ').trim()

  return (
    <div style={styles.toolDef}>
      <button
        type="button"
        style={styles.toolRowHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span style={styles.treeToggle}>{open ? '▾' : '▸'}</span>
        <span style={styles.toolDefName}>{tool.name}</span>
        {!open && preview && <span style={styles.toolRowPreview}>{preview}</span>}
      </button>

      {open && (
        <div style={styles.toolRowBody}>
          <div style={styles.toolLabel}>input schema</div>
          <JsonTree value={tool.inputSchema ?? {}} />

          <div style={styles.toolLabel}>description (what the model reads)</div>
          {tool.description ? (
            <details style={styles.descDetails}>
              <summary style={styles.descSummary}>{descOpenLabel(tool.description)}</summary>
              <pre style={styles.descPre}>{tool.description}</pre>
            </details>
          ) : (
            <div style={styles.treeMuted}>(no description)</div>
          )}
        </div>
      )}
    </div>
  )
}
