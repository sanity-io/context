import {mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {EVE_TOOL_PREFIX, type Framework, frameworks} from './frameworks'
import {
  type AnthropicRequest,
  createCertificate,
  type Fault,
  startFakeAnthropic,
  startMcpProxy,
  type Step,
} from './servers'
import {startStub} from './stub'

export interface RunOptions {
  framework: Framework
  scenario: string
  /** Messages to send in order. The scripted model only plans the first turn. */
  messages: string[]
  /** A real endpoint instead of the stub. */
  live?: {url: string; token: string}
  /** Forward model calls to Anthropic instead of scripting them. */
  anthropicApiKey?: string
  model: string
  label?: string
  /** Called with each reply, for the interactive chat. */
  next?: (reply: string) => Promise<string | undefined>
}

export interface RunResult {
  dir: string
  status: 'completed' | 'threw'
  reply?: string
  error?: string
  durationMs: number
}

type Call = {tool: string; input: Record<string, unknown>}

const STUB_CALLS: Call[] = [
  {tool: 'initial_context', input: {}},
  {tool: 'groq_query', input: {query: '*[_type == "product"][0...2]{_id, title, price}'}},
  {tool: 'groq_query', input: {query: '*[_type == "product"'}},
  {tool: 'knowledge_base_search', input: {knowledgeBase: 'kb1', query: 'return'}},
  {tool: 'knowledge_base_read', input: {knowledgeBase: 'kb1', paths: ['/returns/how-to']}},
]

/** Each scenario replaces requests with faults. Fault scenarios stop after the faulting call. */
export const SCENARIOS: Record<string, Fault[]> = {
  'happy': [],
  '502': [{target: 'groq_query', kind: '502html'}],
  '500': [{target: 'groq_query', kind: '500json'}],
  '401': [{target: 'groq_query', kind: '401'}],
  '400': [{target: 'groq_query', kind: '400rpc'}],
  'reset': [{target: 'groq_query', kind: 'reset'}],
  'list-400': [{target: 'tools/list', nth: 2, kind: '400rpc'}],
  'list-401': [{target: 'tools/list', nth: 2, kind: '401'}],
  'list-502': [{target: 'tools/list', nth: 2, kind: '502html'}],
  'bad-token': [{target: '*', kind: '401'}],
}

const blocks = (body: AnthropicRequest) =>
  body.messages.flatMap((m) => (typeof m.content === 'string' ? [] : m.content))

/** Live endpoints: plan the calls from the initial context the endpoint returned. */
function liveCalls(body: AnthropicRequest): Call[] {
  const calls: Call[] = [{tool: 'initial_context', input: {}}]
  const initial = blocks(body)
    .filter((b) => b.type === 'tool_result')
    .map((b) => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)))
    .find((t) => t.includes('resource-schema') || t.includes('Knowledge base id'))
  if (!initial) return calls
  if (initial.includes('resource-schema'))
    calls.push({tool: 'groq_query', input: {query: '*[0...2]{_id, _type}'}})
  const kb = /Knowledge base id: `([^`]+)`/.exec(initial)?.[1]
  if (kb) calls.push({tool: 'knowledge_base_search', input: {knowledgeBase: kb, query: 'overview'}})
  return calls
}

function script(framework: Framework, calls: Call[]): Step[] {
  if (framework === 'langchain') return [...calls, {text: 'Done.'}]
  return [
    {tool: 'eve__search', input: {query: 'initial_context'}},
    ...calls.map((c) => ({
      tool: 'eve__tool',
      input: {name: EVE_TOOL_PREFIX + c.tool, input: c.input},
    })),
    {text: 'Done.'},
  ]
}

export async function run(options: RunOptions): Promise<RunResult> {
  const {framework, scenario, live} = options
  const faults = SCENARIOS[scenario]
  if (!faults) throw new Error(`Unknown scenario "${scenario}"`)
  const name = [options.label ?? (live ? 'live' : 'stub'), framework, scenario].join('-')
  const dir = join(import.meta.dirname, '..', 'captures', name)
  rmSync(dir, {recursive: true, force: true})
  mkdirSync(dir, {recursive: true})

  const certificate = createCertificate()
  const stub = live ? undefined : await startStub()
  const proxy = await startMcpProxy({
    upstream: live?.url ?? stub!.url,
    dir,
    faults,
    tls: certificate,
  })
  const calls = scenario === 'happy' ? STUB_CALLS : STUB_CALLS.slice(0, 2)
  const model = await startFakeAnthropic({
    dir,
    steps: (body) => script(framework, live ? liveCalls(body) : calls),
    forward: options.anthropicApiKey ? {apiKey: options.anthropicApiKey} : undefined,
  })

  const started = Date.now()
  const result: RunResult = {dir, status: 'completed', durationMs: 0}
  const agent = await frameworks[framework]({
    mcpUrl: `${proxy.url}${live ? new URL(live.url).search : ''}`,
    token: live?.token ?? 'harness-token',
    modelUrl: model.url,
    model: options.model,
    dir,
    certFile: certificate.certFile,
  }).catch((error: Error) => error)
  try {
    if (agent instanceof Error) throw agent
    let message: string | undefined = options.messages[0]
    for (let i = 1; message !== undefined; i++) {
      result.reply = await agent.send(message)
      message = options.messages[i] ?? (await options.next?.(result.reply))
    }
  } catch (error) {
    result.status = 'threw'
    result.error = String((error as Error)?.message ?? error)
  } finally {
    result.durationMs = Date.now() - started
    if (!(agent instanceof Error)) await agent.close()
    model.close()
    proxy.close()
    stub?.close()
    writeFileSync(join(dir, 'outcome.json'), JSON.stringify(result, null, 2))
    writeTranscript(dir)
  }
  return result
}

/** The model requests a run made, in order. */
export function modelRequests(dir: string): AnthropicRequest[] {
  return readdirSync(dir)
    .filter((f) => /^model-\d+\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .filter((r) => Array.isArray(r.messages))
}

export const systemText = (request: AnthropicRequest) =>
  typeof request.system === 'string'
    ? request.system
    : (request.system ?? []).map((b) => b.text ?? '').join('\n')

const finalRequest = (requests: AnthropicRequest[]) =>
  requests.reduce((a, b) => (b.messages.length >= a.messages.length ? b : a))

/** The Sanity tools the model called, in order, without eve's prefix. */
export function toolCalls(requests: AnthropicRequest[]): string[] {
  if (!requests.length) return []
  return blocks(finalRequest(requests))
    .filter((b) => b.type === 'tool_use' && b.name !== 'eve__search')
    .map((b) =>
      b.name === 'eve__tool' ? String((b.input as {name: string}).name) : String(b.name),
    )
    .map((name) => name.replace(EVE_TOOL_PREFIX, ''))
}

/** The text of each tool result the model saw, in order. */
export function toolResults(requests: AnthropicRequest[]) {
  if (!requests.length) return []
  return blocks(finalRequest(requests))
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({
      isError: Boolean(b.is_error),
      text:
        typeof b.content === 'string'
          ? b.content
          : (b.content as {type: string; text?: string}[])
              .map((c) => (c.type === 'text' ? c.text : `[${c.type}]`))
              .join(''),
    }))
}

/** Writes the run's longest model request, the one with the whole conversation, as markdown. */
function writeTranscript(dir: string) {
  const requests = modelRequests(dir)
  if (!requests.length) return
  const final = finalRequest(requests)
  const out = ['## system', '```', systemText(final), '```', '', '## tools']
  for (const tool of final.tools ?? []) out.push(`- ${tool.name}`)
  out.push('', '## messages')
  for (const m of final.messages) {
    const content = typeof m.content === 'string' ? [{type: 'text', text: m.content}] : m.content
    for (const b of content) {
      const name = typeof b.name === 'string' ? ` ${b.name}` : ''
      out.push(`### ${m.role} / ${b.type}${name}${b.is_error ? ' (is_error)' : ''}`, '```')
      if (b.type === 'text') out.push(String(b.text))
      else if (b.type === 'tool_use') out.push(JSON.stringify(b.input))
      else out.push(typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2))
      out.push('```')
    }
  }
  writeFileSync(join(dir, 'transcript.md'), out.join('\n'))
}
