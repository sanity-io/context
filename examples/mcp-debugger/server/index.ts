import {createServer} from 'node:http'

import {anthropic} from '@ai-sdk/anthropic'
import {createMCPClient} from '@ai-sdk/mcp'
import {config} from 'dotenv'
import {convertToModelMessages, stepCountIs, streamText, type UIMessage} from 'ai'

// Load .env at startup (for PORT, etc.)
config()

const DEFAULT_MODEL = 'claude-sonnet-4-5'
const MAX_STEPS = 20
const PORT = Number(process.env.PORT) || 58400

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  return value
}

interface ChatRequest {
  messages: UIMessage[]
}

/**
 * Lists the MCP's tools via a raw JSON-RPC `tools/list` call. This returns the
 * tool definitions exactly as they go over the wire — name, description, and
 * `inputSchema` as JSON Schema — which is precisely what the agent's model is
 * shown. We hit the MCP directly (rather than going through the AI SDK client)
 * so the schema isn't re-serialized or lossily transformed on the way.
 */
async function handleTools(): Promise<Response> {
  config({override: true})

  const mcpUrl = requireEnv('MCP_URL')

  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Streamable-HTTP MCP servers require the client to accept SSE.
      'Accept': 'application/json, text/event-stream',
      ...(process.env.MCP_TOKEN ? {Authorization: `Bearer ${process.env.MCP_TOKEN}`} : {}),
    },
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'}),
  })

  const raw = await res.text()
  const payload = parseRpcBody(raw)

  if (!res.ok || payload?.error) {
    const message = payload?.error?.message ?? `MCP responded ${res.status}`
    return Response.json({error: message}, {status: res.ok ? 502 : res.status})
  }

  const tools = payload?.result?.tools ?? []
  return Response.json({tools})
}

/**
 * MCP streamable-HTTP servers may answer with either a JSON body or an SSE
 * stream (`data: {...}` lines). Parse both into the JSON-RPC envelope.
 */
function parseRpcBody(raw: string): any {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return null
    }
  }
  // SSE framing: take the last non-empty `data:` line.
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
  const last = dataLines[dataLines.length - 1]
  if (!last) return null
  try {
    return JSON.parse(last)
  } catch {
    return null
  }
}

/**
 * Connects to the MCP, runs one streamText turn with the MCP's tools exposed,
 * and streams the result back in the AI SDK UI Message Stream protocol.
 *
 * A fresh MCP client per request keeps the loop simple and stateless — fine for
 * a local debugging tool. The conversation history lives entirely client-side
 * and is replayed in `messages` on every request.
 */
async function handleChat(body: ChatRequest): Promise<Response> {
  // Re-read .env from disk on every request with override, so edits to
  // MCP_URL / MCP_TOKEN / SYSTEM_PROMPT take effect on the next message —
  // no server restart needed.
  config({override: true})

  const mcpUrl = requireEnv('MCP_URL')
  requireEnv('ANTHROPIC_API_KEY')

  const transportType = process.env.MCP_TRANSPORT === 'sse' ? 'sse' : 'http'

  const mcpClient = await createMCPClient({
    transport: {
      type: transportType,
      url: mcpUrl,
      headers: process.env.MCP_TOKEN
        ? {Authorization: `Bearer ${process.env.MCP_TOKEN}`}
        : undefined,
    },
  })

  const tools = await mcpClient.tools()
  const modelId = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  const system =
    process.env.SYSTEM_PROMPT ||
    'You are a helpful assistant with access to tools from a Sanity Context MCP server.'

  const result = streamText({
    model: anthropic(modelId),
    system,
    messages: await convertToModelMessages(body.messages),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    onFinish: async () => {
      await mcpClient.close()
    },
    onError: async () => {
      await mcpClient.close()
    },
  })

  return result.toUIMessageStreamResponse()
}

const server = createServer(async (req, res) => {
  // CORS for the Vite dev origin (proxy makes this same-origin, but allow direct hits too)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  // List the MCP's tools (what the agent sees).
  if (req.method === 'GET' && req.url === '/api/tools') {
    try {
      const response = await handleTools()
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(await response.text())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error'
      console.error('[mcp-debugger]', error)
      if (!res.headersSent) res.writeHead(500, {'Content-Type': 'application/json'})
      res.end(JSON.stringify({error: message}))
    }
    return
  }

  if (req.method !== 'POST' || req.url !== '/api/chat') {
    res.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found')
    return
  }

  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatRequest

    const response = await handleChat(body)

    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) {
      const reader = response.body.getReader()
      for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[mcp-debugger]', error)
    if (!res.headersSent) res.writeHead(500, {'Content-Type': 'application/json'})
    res.end(JSON.stringify({error: message}))
  }
})

server.listen(PORT, () => {
  console.log(`[mcp-debugger] agent server on http://localhost:${PORT}`)
  console.log(
    `[mcp-debugger] MCP target: ${process.env.MCP_URL || '(MCP_URL not set!)'} (transport: ${
      process.env.MCP_TRANSPORT === 'sse' ? 'sse' : 'http'
    })`,
  )
})
