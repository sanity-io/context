import {useChat} from '@ai-sdk/react'
import {DefaultChatTransport, type UIMessage} from 'ai'
import {useEffect, useRef, useState} from 'react'

import {ToolCall, ToolDetailPanel, type ToolCallData} from './components/ToolCall'
import {ToolsInspector} from './components/ToolsInspector'
import {styles} from './styles'

const transport = new DefaultChatTransport({api: '/api/chat'})

/**
 * A debugging chat UI for a Context MCP. Unlike a normal chat app, this renders
 * every part of every message — text, reasoning, and (most importantly) tool
 * calls with their raw input/output as JSON. The full conversation history is
 * always on screen so you can trace what the agent did and ask follow-ups like
 * "why did you query like that?".
 */
export function App() {
  const [input, setInput] = useState('')
  const [openCall, setOpenCall] = useState<ToolCallData | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const {messages, sendMessage, status, error} = useChat({transport})

  const isLoading = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    endRef.current?.scrollIntoView({behavior: 'smooth'})
  }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage({text: input})
    setInput('')
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <strong>MCP Debugger</strong>
        <button type="button" style={styles.headerButton} onClick={() => setToolsOpen(true)}>
          🛠️ Tools
        </button>
      </header>

      <main style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            Ask the agent something that exercises the MCP tools, e.g.{' '}
            <em>“suggest 5 speakers for a conference on AI safety”</em>. Then ask{' '}
            <em>“why did you query like that?”</em>.
          </div>
        )}

        {messages.map((message) => (
          <MessageView key={message.id} message={message} onOpenTool={setOpenCall} />
        ))}

        {isLoading && <div style={styles.loading}>…working</div>}

        {error && <div style={styles.error}>Error: {error.message}</div>}

        <div ref={endRef} />
      </main>

      <form style={styles.inputRow} onSubmit={handleSubmit}>
        <input
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent…"
          disabled={isLoading}
        />
        <button style={styles.button} type="submit" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>

      {openCall && <ToolDetailPanel call={openCall} onClose={() => setOpenCall(null)} />}
      {toolsOpen && <ToolsInspector onClose={() => setToolsOpen(false)} />}
    </div>
  )
}

function MessageView({
  message,
  onOpenTool,
}: {
  message: UIMessage
  onOpenTool: (call: ToolCallData) => void
}) {
  const isUser = message.role === 'user'

  return (
    <div style={styles.message}>
      <div style={isUser ? styles.roleUser : styles.roleAssistant}>{message.role}</div>

      {message.parts.map((part, i) => {
        // Plain text
        if (part.type === 'text') {
          return (
            <div key={i} style={styles.text}>
              {part.text}
            </div>
          )
        }

        // Model reasoning, if the provider emits it
        if (part.type === 'reasoning') {
          return (
            <details key={i} style={styles.reasoning}>
              <summary>reasoning</summary>
              <pre style={styles.pre}>{part.text}</pre>
            </details>
          )
        }

        // MCP tools arrive as dynamic-tool parts; static tools as `tool-<name>`
        if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
          return <ToolCall key={i} part={part} onOpen={onOpenTool} />
        }

        // Anything else (files, sources, step markers): dump it so nothing is hidden
        if (part.type === 'step-start') return null
        return (
          <pre key={i} style={styles.pre}>
            {JSON.stringify(part, null, 2)}
          </pre>
        )
      })}
    </div>
  )
}
