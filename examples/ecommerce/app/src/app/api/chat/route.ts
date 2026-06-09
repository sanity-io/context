import {anthropic} from '@ai-sdk/anthropic'
import {createMCPClient, type MCPClient} from '@ai-sdk/mcp'
import {sanityInsightsIntegration} from '@sanity/context/ai-sdk'
import {
  convertToModelMessages,
  type Experimental_DownloadFunction,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai'

import {clientTools, type DocumentContext} from '@/lib/client-tools'
import {client} from '@/sanity/lib/client'
import {writeClient} from '@/sanity/lib/write-client'

const DEFAULT_MODEL = 'claude-sonnet-4-5'
const MAX_STEPS = 20

let cachedInitialContext: string | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000

function initialContextUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/initial-context`
  return url.toString()
}

// Slow on cold start — subsequent calls return the cached result
async function fetchInitialContext(): Promise<string | null> {
  const mcpUrl = process.env.SANITY_CONTEXT_MCP_URL
  if (!mcpUrl) return null

  const isStale = Date.now() - cacheTimestamp > CACHE_TTL_MS
  const fetchPromise = isStale
    ? fetch(initialContextUrl(mcpUrl), {
        headers: {Authorization: `Bearer ${process.env.SANITY_API_READ_TOKEN}`},
      })
        .then(async (res) => {
          if (res.ok) {
            cachedInitialContext = await res.text()
            cacheTimestamp = Date.now()
          }
        })
        .catch(() => {})
    : null

  if (!cachedInitialContext) await fetchPromise

  return cachedInitialContext
}

interface BuildSystemPromptParams {
  basePrompt: string
  documentContext: DocumentContext
  initialContext?: string | null
}

/**
 * Combines base prompt from Sanity with page context and tool instructions.
 */
function buildSystemPrompt(props: BuildSystemPromptParams): string {
  const {basePrompt, documentContext, initialContext} = props

  return `
${basePrompt}
${initialContext ? `\n# Content context\n\n${initialContext}\n` : ''}
# Current page

<page-context>
  <title>${documentContext.title}</title>
  <description>${documentContext.description || ''}</description>
  <pathname>${documentContext.pathname}</pathname>
</page-context>

For more detail about what's visible on the page, use these tools:
- **get_page_context**: page content as markdown
- **get_page_screenshot**: visual screenshot

# Displaying products

To display products as rich cards, query Sanity to get the _id and _type, then use this directive syntax:

- Block: ::document{id="<_id>" type="<_type>"}
- Inline: :document{id="<_id>" type="<_type>"}

Always use directives for product names so the UI can render them as cards.
`
}

interface ChatRequest {
  messages: UIMessage[]
  documentContext: DocumentContext
  id: string
}

// The `get_page_screenshot` tool sends screenshots as `data:` URLs, which
// are not supported by the default downloader. `experimental_download` is used
// to decode `data:` files for model input. An alternative approach is to upload
// screenshots first and send an `https://` file URL.
const downloadDataUrls: Experimental_DownloadFunction = async (items) => {
  return items.map(({url}) => {
    if (url.protocol !== 'data:') return null

    const [meta = '', payload = ''] = url.href.slice(5).split(',', 2)
    const mediaType = meta.split(';')[0] || undefined
    const data = meta.includes(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')

    return {data: new Uint8Array(data), mediaType}
  })
}

export async function POST(req: Request) {
  const {messages, documentContext, id: chatId}: ChatRequest = await req.json()

  if (!process.env.SANITY_CONTEXT_MCP_URL) {
    throw new Error('SANITY_CONTEXT_MCP_URL is not set')
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set')
  }

  if (!process.env.SANITY_API_READ_TOKEN) {
    throw new Error('SANITY_API_READ_TOKEN is not set')
  }

  let mcpClient: MCPClient | null = null

  try {
    const [mcpClientResult, agentConfig, initialContext] = await Promise.all([
      createMCPClient({
        transport: {
          type: 'http',
          url: process.env.SANITY_CONTEXT_MCP_URL,
          headers: {
            Authorization: `Bearer ${process.env.SANITY_API_READ_TOKEN}`,
          },
        },
      }),
      client.fetch<{systemPrompt: string | null} | null>(
        `*[_type == "agent.config" && slug.current == $slug][0] { systemPrompt }`,
        {slug: process.env.AGENT_CONFIG_SLUG || 'default'},
      ),
      fetchInitialContext(),
    ])

    mcpClient = mcpClientResult

    if (!agentConfig?.systemPrompt) {
      await mcpClient?.close()
      return Response.json(
        {error: 'Agent config not found or missing system prompt. Create one in Sanity Studio.'},
        {status: 500},
      )
    }

    const systemPrompt = buildSystemPrompt({
      basePrompt: agentConfig.systemPrompt,
      documentContext,
      initialContext,
    })

    const allMcpTools = await mcpClient.tools()

    // Exclude initial_context tool, its data is already in the system prompt
    const {initial_context: _, ...mcpTools} = allMcpTools

    const modelId = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL

    const result = streamText({
      model: anthropic(modelId),
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      experimental_download: downloadDataUrls,
      tools: {
        ...mcpTools,
        ...clientTools,
      },
      stopWhen: stepCountIs(MAX_STEPS),
      experimental_telemetry: {
        isEnabled: true,
        integrations: [
          sanityInsightsIntegration({
            client: writeClient,
            agentId: 'shopping-assistant',
            threadId: chatId,
          }),
        ],
      },
      onFinish: async () => {
        await mcpClient?.close()
      },
    })

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
    })
  } catch (error) {
    await mcpClient?.close()

    return Response.json(
      {error: error instanceof Error ? error.message : 'An unexpected error occurred'},
      {status: 500},
    )
  }
}
