import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {type Agent, EVE_TOOL_PREFIX, type Framework, frameworks} from './frameworks'
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
  /** The first message. The scripted model only plans this turn. */
  message: string
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
  reply?: string
  error?: string
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
  'list-502': [{target: 'tools/list', nth: 2, kind: '502html'}],
  'bad-token': [{target: '*', kind: '401'}],
}

const blocks = (body: AnthropicRequest) =>
  body.messages.flatMap((m) => (typeof m.content === 'string' ? [] : m.content))

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
  const realModel = options.anthropicApiKey && options.model
  const name = [options.label ?? (live ? 'live' : 'stub'), framework, scenario, realModel]
    .filter(Boolean)
    .join('-')
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
  // A live endpoint has unknown content, so the scripted model only loads its initial context.
  const calls = STUB_CALLS.slice(0, live ? 1 : scenario === 'happy' ? undefined : 2)
  const model = await startFakeAnthropic({
    dir,
    steps: script(framework, calls),
    forward: options.anthropicApiKey ? {apiKey: options.anthropicApiKey} : undefined,
  })

  const result: RunResult = {dir}
  let agent: Agent | undefined
  try {
    agent = await frameworks[framework]({
      mcpUrl: `${proxy.url}${live ? new URL(live.url).search : ''}`,
      token: live?.token ?? 'harness-token',
      modelUrl: model.url,
      model: options.model,
      dir,
      certFile: certificate.certFile,
    })
    let message: string | undefined = options.message
    while (message !== undefined) {
      result.reply = await agent.send(message)
      message = await options.next?.(result.reply)
    }
  } catch (error) {
    result.error = String((error as Error)?.message ?? error)
  } finally {
    await agent?.close()
    model.close()
    proxy.close()
    stub?.close()
    writeTranscript(dir)
  }
  return result
}

export function modelRequests(dir: string): AnthropicRequest[] {
  return readdirSync(dir)
    .filter((f) => /^model-\d+\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
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

/**
 * The initial context the run received: the `/initial-context` answer when the package inlined it,
 * otherwise the `initial_context` tool's result.
 */
export function initialContextOf(dir: string): string | undefined {
  const log = join(dir, 'mcp.jsonl')
  if (!existsSync(log)) return undefined
  const entries = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const inlined = entries.find((e) => e.path === '/initial-context' && e.status === 200)
  if (inlined?.response) return inlined.response
  const called = entries.find((e) => e.tool === 'initial_context' && e.response)
  return called && JSON.parse(called.response).result?.content?.[0]?.text
}

export function summarizeInitialContext(text: string | undefined): string {
  if (!text) return 'none received'
  const headings = [...text.matchAll(/^(#+) (.+)$/gm)]
  const level = headings[0]?.[1]?.length ?? 1
  const sections = headings.filter((h) => h[1]!.length === level + 1).map((h) => h[2])
  const types = text.match(/^- \w+ \(/gm)?.length ?? 0
  const entries = [...text.matchAll(/^(\d+) entries\.?$/gm)].reduce((n, m) => n + Number(m[1]), 0)
  return [
    `${text.length.toLocaleString('en')} characters`,
    sections.join(', '),
    types && `${types} schema types`,
    entries && `${entries} knowledge base entries`,
  ]
    .filter(Boolean)
    .join('; ')
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
