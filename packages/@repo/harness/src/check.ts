import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

import {type Framework} from './frameworks'
import {modelRequests, run, systemText, toolResults} from './run'

/**
 * What each package decides per scenario. The run throws with `threw`, or completes and the model
 * sees `saw` (default: every tool result the stub sent, intact). The first system prompt includes
 * `system` and leaves out `notSystem`. Every endpoint request names the package in its User-Agent.
 * Faults the framework handles itself aren't checked.
 */
type Expected = {threw?: string; saw?: string; system?: string; notSystem?: string}

const EXPECTED: Record<Framework, Record<string, Expected>> = {
  langchain: {
    'happy': {system: '## Stub Shop: Context & Schema'},
    'ic-fails': {notSystem: 'Stub Shop: Context'},
    '400': {
      saw: 'Error calling tool groq_query: HTTP 400: This endpoint has no dataset schema deployed.',
    },
    '401': {saw: 'Error calling tool groq_query: HTTP 401: Invalid token'},
    '500': {saw: 'Error calling tool groq_query: HTTP 500: Internal Server Error'},
    '502': {saw: 'Error calling tool groq_query: HTTP 502'},
    'reset': {saw: 'Error calling tool groq_query: TypeError: fetch failed'},
    'list-502': {threw: 'Could not connect to Sanity Context: HTTP 502'},
    'bad-token': {threw: 'Sanity Context rejected the token (HTTP 401: Invalid token).'},
  },
  eve: {
    'happy': {
      system: '## Stub Shop: Context & Schema',
      notSystem: "load it first: find the connection's `initial_context` tool",
    },
    'ic-fails': {system: "load it first: find the connection's `initial_context` tool"},
    'bad-token': {saw: 'Error: "sanity-context__sanity" requires authorization'},
  },
}

export async function check(only?: Framework): Promise<boolean> {
  const jobs = Object.entries(EXPECTED)
    .filter(([framework]) => !only || framework === only)
    .flatMap(([framework, scenarios]) =>
      Object.entries(scenarios).map(([scenario, expected]) => ({
        framework: framework as Framework,
        scenario,
        expected,
      })),
    )
  const failed = await Promise.all(
    jobs.map(async ({framework, scenario, expected}) => {
      const result = await run({
        framework,
        scenario,
        model: 'claude-sonnet-5-5',
        message: 'How do I return the "Classic" coffee cup?',
      })
      const seen = toolResults(modelRequests(result.dir)).map((r) => r.text)
      const problem = problemOf()
      function problemOf() {
        const requests = modelRequests(result.dir)
        const log = join(result.dir, 'mcp.jsonl')
        const entries = existsSync(log)
          ? readFileSync(log, 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : []
        const anonymous = entries.find((e) => !e.ua?.startsWith(`sanity-context-${framework}/`))
        if (anonymous)
          return `expected every endpoint request to name the package, ${anonymous.rpc ?? anonymous.path} sent ${JSON.stringify(anonymous.ua)}`
        const system = systemText(requests[0] ?? {messages: []})
        if (expected.system && !system.includes(expected.system))
          return `expected the system prompt to include "${expected.system}"`
        if (expected.notSystem && system.includes(expected.notSystem))
          return `expected the system prompt to leave out "${expected.notSystem}"`
        // eve offers connection tools through eve__search, so only LangChain lists them directly.
        if (framework === 'langchain' && requests.length && !result.error)
          if (!requests.at(-1)!.tools?.some((t) => t.name === 'initial_context'))
            return 'expected the initial_context tool to stay available'
        if (expected.threw)
          return result.error?.startsWith(expected.threw)
            ? undefined
            : `expected it to throw "${expected.threw}", got ${result.error ?? result.reply}`
        if (result.error) return `threw: ${result.error}`
        if (expected.saw)
          return seen.some((s) => s.startsWith(expected.saw!))
            ? undefined
            : `expected the model to see "${expected.saw}", it saw ${JSON.stringify(seen.at(-1))}`
        if (!entries.length) return 'no request reached the endpoint'
        const sent = entries
          .filter((e) => e.rpc === 'tools/call' && e.response)
          .map((e) => JSON.parse(e.response).result.content[0].text as string)
        // eve prefixes error results with `Error: `, so a result only has to contain what was sent.
        const missing = sent.find((text) => !seen.some((s) => s.includes(text)))
        return missing === undefined ? undefined : `the model didn't see ${JSON.stringify(missing)}`
      }
      console.log(`${problem ? '✗' : '✓'} ${framework} ${scenario}`)
      if (problem) console.log(`    ${problem}\n    ${result.dir}`)
      return Boolean(problem)
    }),
  )
  console.log(`\n${failed.filter((f) => !f).length} of ${jobs.length} scenarios passed.`)
  return !failed.some(Boolean)
}
