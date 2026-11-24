import {execFileSync} from 'node:child_process'
import {appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {createServer as createTlsServer} from 'node:https'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

export type Step = {tool: string; input: Record<string, unknown>} | {text: string}

export type Fault = {
  /** A tool name, an MCP method such as `tools/list`, a path such as `/initial-context`, or `*`. */
  target: string
  /** Only the nth request to the target. Without it, every request. */
  nth?: number
  kind: '502html' | '401' | 'reset' | '500json' | '400rpc'
}

export type AnthropicRequest = {
  stream?: boolean
  model?: string
  system?: string | {type: string; text?: string}[]
  tools?: {name: string; description?: string}[]
  messages: {role: string; content: string | {type: string; [key: string]: unknown}[]}[]
}

const read = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })

export const listen = (server: Server, scheme = 'http') =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address) resolve(`${scheme}://127.0.0.1:${address.port}`)
    }),
  )

let certificate: {key: Buffer; cert: Buffer; certFile: string} | undefined

/**
 * A throwaway certificate for 127.0.0.1, one per process: LangChain runs trust it process-wide. The
 * packages refuse plain http URLs.
 */
export function getCertificate() {
  if (certificate) return certificate
  const dir = mkdtempSync(join(tmpdir(), 'harness-tls-'))
  process.on('exit', () => rmSync(dir, {recursive: true, force: true}))
  const keyFile = join(dir, 'key.pem')
  const certFile = join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    {stdio: 'ignore'},
  )
  certificate = {key: readFileSync(keyFile), cert: readFileSync(certFile), certFile}
  return certificate
}

function toolResultCount(body: AnthropicRequest) {
  return body.messages
    .flatMap((m) => (typeof m.content === 'string' ? [] : m.content))
    .filter((b) => b.type === 'tool_result').length
}

/**
 * A fake Anthropic Messages API. Saves every request body verbatim. With `forward`, it passes
 * requests to Anthropic and saves the answers too. Otherwise it answers with the next scripted
 * step, chosen by how many tool results the conversation already holds. Requests that offer no
 * tools (titles, compaction) get a plain text answer.
 */
export async function startFakeAnthropic(options: {
  dir: string
  steps: Step[]
  forward?: {apiKey: string}
}) {
  mkdirSync(options.dir, {recursive: true})
  let n = 0
  const server = createServer(async (req, res) => {
    const raw = await read(req)
    const seq = String(++n).padStart(3, '0')
    writeFileSync(join(options.dir, `model-${seq}.json`), raw)
    const body = JSON.parse(raw.toString()) as AnthropicRequest

    if (options.forward) {
      const upstream = await fetch(`https://api.anthropic.com${req.url}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.forward.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: new Uint8Array(raw),
      }).catch((error: Error) => error)
      // A 502 fails only this request, and the SDK retries it, instead of crashing the harness.
      if (upstream instanceof Error) {
        res.writeHead(502, {'content-type': 'application/json'})
        res.end(
          JSON.stringify({type: 'error', error: {type: 'api_error', message: upstream.message}}),
        )
        return
      }
      const answer = Buffer.from(await upstream.arrayBuffer())
      writeFileSync(join(options.dir, `model-${seq}.response`), answer)
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      })
      res.end(answer)
      return
    }

    const steps = body.tools?.length ? options.steps : [{text: 'ok'}]
    const step = steps[toolResultCount(body)] ?? {text: 'Done.'}
    const block =
      'tool' in step
        ? {type: 'tool_use', id: `toolu_${seq}`, name: step.tool, input: step.input}
        : {type: 'text', text: step.text}
    const stopReason = 'tool' in step ? 'tool_use' : 'end_turn'
    const message = {
      id: `msg_${seq}`,
      type: 'message',
      role: 'assistant',
      model: body.model ?? 'fake',
      stop_sequence: null,
    }
    const usage = {input_tokens: 1, output_tokens: 1}

    if (!body.stream) {
      res.writeHead(200, {'content-type': 'application/json'})
      res.end(JSON.stringify({...message, content: [block], stop_reason: stopReason, usage}))
      return
    }
    res.writeHead(200, {'content-type': 'text/event-stream'})
    const send = (type: string, data: Record<string, unknown>) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({type, ...data})}\n\n`)
    send('message_start', {message: {...message, content: [], stop_reason: null, usage}})
    if (block.type === 'tool_use') {
      send('content_block_start', {index: 0, content_block: {...block, input: {}}})
      send('content_block_delta', {
        index: 0,
        delta: {type: 'input_json_delta', partial_json: JSON.stringify(block.input)},
      })
    } else {
      send('content_block_start', {index: 0, content_block: {type: 'text', text: ''}})
      send('content_block_delta', {index: 0, delta: {type: 'text_delta', text: block.text}})
    }
    send('content_block_stop', {index: 0})
    send('message_delta', {
      delta: {stop_reason: stopReason, stop_sequence: null},
      usage: {output_tokens: 1},
    })
    send('message_stop', {})
    res.end()
  })
  const url = await listen(server)
  return {url, close: () => server.close()}
}

/**
 * An https proxy in front of a Context MCP endpoint. Logs every request and raw response to
 * `mcp.jsonl`, and replaces matching requests with faults.
 */
export async function startMcpProxy(options: {
  upstream: string
  dir: string
  faults: Fault[]
  tls: {key: Buffer; cert: Buffer}
}) {
  mkdirSync(options.dir, {recursive: true})
  const log = join(options.dir, 'mcp.jsonl')
  const counts = new Map<string, number>()
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const raw = await read(req)
    const message = raw.length ? JSON.parse(raw.toString()) : undefined
    const incoming = new URL(req.url ?? '/', 'http://proxy')
    const path = incoming.pathname.replace(/^\/mcp/, '')
    const tool: string | undefined =
      message?.method === 'tools/call' ? message.params?.name : undefined
    const key: string | undefined = tool ?? message?.method ?? (path || undefined)
    const nth = key ? (counts.get(key) ?? 0) + 1 : 0
    if (key) counts.set(key, nth)
    const fault = options.faults.find(
      (f) => f.target === '*' || (f.target === key && (f.nth ?? nth) === nth),
    )
    const entry = {
      method: req.method,
      path,
      rpc: message?.method,
      tool,
      nth,
      fault: fault?.kind,
      ua: req.headers['user-agent'],
    }

    if (fault) {
      appendFileSync(log, `${JSON.stringify({...entry, request: message})}\n`)
      if (fault.kind === 'reset') return req.socket.destroy()
      if (fault.kind === '401') {
        res.writeHead(401, {'content-type': 'application/json'})
        return res.end(JSON.stringify({error: 'Unauthorized', message: 'Invalid token'}))
      }
      if (fault.kind === '400rpc') {
        res.writeHead(400, {'content-type': 'application/json'})
        return res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32602,
              message:
                'This endpoint has no dataset schema deployed. Deploy the studio schema, then try again.',
            },
            id: null,
          }),
        )
      }
      if (fault.kind === '500json') {
        res.writeHead(500, {'content-type': 'application/json'})
        return res.end(JSON.stringify({statusCode: 500, error: 'Internal Server Error'}))
      }
      res.writeHead(502, {'content-type': 'text/html'})
      return res.end(
        `<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>${'x'.repeat(2000)}</center></body></html>`,
      )
    }

    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && !['host', 'content-length', 'connection'].includes(name))
        headers[name] = value
    }
    const target = new URL(options.upstream)
    target.pathname += path
    target.search = incoming.search
    // A request still in flight when its run ends reaches a closed stub. Answer it instead of crashing.
    const forwarded = await fetch(target, {
      method: req.method,
      headers,
      body: raw.length ? new Uint8Array(raw) : undefined,
    })
      .then(async (response) => ({response, answer: await response.text()}))
      .catch((error: Error) => error)
    if (forwarded instanceof Error) {
      appendFileSync(
        log,
        `${JSON.stringify({...entry, status: 502, request: message, error: forwarded.message})}\n`,
      )
      res.writeHead(502, {'content-type': 'text/plain'})
      return res.end(forwarded.message)
    }
    const {response: upstream, answer} = forwarded
    appendFileSync(
      log,
      `${JSON.stringify({...entry, status: upstream.status, request: message, response: answer})}\n`,
    )
    const out: Record<string, string> = {}
    upstream.headers.forEach((value, name) => {
      if (!['content-length', 'content-encoding', 'transfer-encoding'].includes(name))
        out[name] = value
    })
    res.writeHead(upstream.status, out)
    res.end(answer)
  }
  const server = createTlsServer(options.tls, handler)
  const url = await listen(server, 'https')
  return {url: `${url}/mcp`, close: () => server.close()}
}
