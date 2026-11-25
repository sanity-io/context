'use client'

import {useChat} from '@ai-sdk/react'
import {DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage} from 'ai'
import {MessageCircle, X} from 'lucide-react'
import {useRouter} from 'next/navigation'
import {useCallback, useEffect, useRef, useState} from 'react'

import {
  AGENT_CHAT_HIDDEN_ATTRIBUTE,
  captureScreenshot,
  getDocumentContext,
  getPageContent,
} from '@/lib/capture-context'
import {chatSessionFetch} from '@/lib/chat-session-fetch'
import {CLIENT_TOOL_NAMES, type ProductFiltersInput, productFiltersSchema} from '@/lib/client-tools'

import {ChatInput} from './chat-input'
import {Loader} from './loader'
import {Message} from './message/message'

/**
 * Checks if the last message is waiting for text to be streamed.
 * Used to show a loader when waiting for text.
 */
function isWaitingForText(messages: UIMessage[]): boolean {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant') return true

  const parts = last.parts ?? []
  if (parts.length === 0) return true

  const lastPart = parts[parts.length - 1]
  return !(lastPart.type === 'text' && lastPart.text.trim().length > 0)
}

interface ChatProps {
  onClose: () => void
}

export function Chat({onClose}: ChatProps) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Queue for screenshot to send after tool output
  const pendingScreenshotRef = useRef<string | null>(null)

  // Apply product filters by navigating to /products with URL params
  const applyProductFilters = useCallback(
    (filters: ProductFiltersInput): string => {
      const params = new URLSearchParams()

      filters.category?.forEach((v) => params.append('category', v))
      filters.color?.forEach((v) => params.append('color', v))
      filters.size?.forEach((v) => params.append('size', v))
      filters.brand?.forEach((v) => params.append('brand', v))
      if (filters.minPrice) params.set('minPrice', String(filters.minPrice))
      if (filters.maxPrice) params.set('maxPrice', String(filters.maxPrice))
      if (filters.sort) params.set('sort', filters.sort)

      const newUrl = `/products${params.toString() ? `?${params}` : ''}`
      router.push(newUrl, {scroll: false})
      return newUrl
    },
    [router],
  )

  const {messages, sendMessage, status, addToolOutput, error, regenerate} = useChat({
    transport: new DefaultChatTransport({
      fetch: chatSessionFetch,
      body: () => ({documentContext: getDocumentContext()}),
    }),
    // Auto-continue for regular tools, but skip when screenshot is pending
    // as we send the screenshot manually after the tool output is received.
    sendAutomaticallyWhen: ({messages}) => {
      if (pendingScreenshotRef.current) return false
      return lastAssistantMessageIsCompleteWithToolCalls({messages})
    },
    onToolCall: async ({toolCall}) => {
      if (toolCall.dynamic) return

      const respond = (output: unknown): void => {
        addToolOutput({tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output})
      }

      switch (toolCall.toolName) {
        case CLIENT_TOOL_NAMES.PAGE_CONTEXT: {
          respond(getPageContent())
          return
        }

        case CLIENT_TOOL_NAMES.SCREENSHOT: {
          try {
            pendingScreenshotRef.current = await captureScreenshot()
            respond('Screenshot captured. It will arrive in the next message.')
          } catch (err) {
            respond(`Failed: ${err instanceof Error ? err.message : String(err)}`)
          }

          return
        }

        case CLIENT_TOOL_NAMES.SET_FILTERS: {
          const parsed = productFiltersSchema.safeParse(toolCall.input)

          if (!parsed.success) {
            respond(`Invalid input: ${parsed.error.message}`)
            return
          }

          const url = applyProductFilters(parsed.data)
          respond(`Filters applied. Navigated to ${url}`)
        }
      }
    },
  })

  // The `addToolOutput` does not support files, so we send the screenshot after
  // the tool output is received and the status is ready as a follow-up message.
  useEffect(() => {
    if (status !== 'ready' || !pendingScreenshotRef.current) return

    const screenshot = pendingScreenshotRef.current
    pendingScreenshotRef.current = null

    sendMessage({
      files: [
        {
          type: 'file',
          filename: 'screenshot.jpg',
          mediaType: 'image/jpeg',
          url: screenshot,
        },
      ],
    })
  }, [status, sendMessage])

  // Scroll to the bottom of the messages when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
  }, [messages])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    sendMessage({text: input})
    setInput('')
  }

  const isLoading = status === 'submitted' || status === 'streaming'
  const showLoader = isLoading && isWaitingForText(messages)

  return (
    <div
      {...{[AGENT_CHAT_HIDDEN_ATTRIBUTE]: 'true'}}
      className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-900 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
            <MessageCircle className="h-4 w-4 text-white" />
          </div>

          <div>
            <h3 className="text-sm font-medium text-white">Shopping Assistant</h3>

            <p className="text-xs text-neutral-400">Ask me anything</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-neutral-400">
            <p>Ask me anything about our products.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}

            {showLoader && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg bg-neutral-100 px-4 py-2 text-sm text-neutral-900">
                  <Loader />
                </div>
              </div>
            )}

            {error && (
              <div className="flex justify-start">
                <div className="flex flex-col gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span>{error.message || 'Something went wrong.'}</span>

                  <button
                    type="button"
                    onClick={() => regenerate()}
                    className="w-fit rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-neutral-200 p-4">
        <ChatInput input={input} setInput={setInput} onSubmit={handleSubmit} disabled={isLoading} />
      </div>
    </div>
  )
}
