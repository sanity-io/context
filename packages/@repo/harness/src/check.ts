import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

import {type Framework} from './frameworks'
import {modelRequests, run, toolResults} from './run'

/**
 * What each package decides per scenario: the run throws with `threw`, or completes and the model
 * sees `saw` (default: every tool result the stub sent, intact). Faults the framework handles
 * itself aren't checked.
 */
const EXPECTED: Record<Framework, Record<string, {threw?: string; saw?: string}>> = {
  langchain: {
    'happy': {},
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
    'happy': {},
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
        if (expected.threw)
          return result.error?.startsWith(expected.threw)
            ? undefined
            : `expected it to throw "${expected.threw}", got ${result.error ?? result.reply}`
        if (result.error) return `threw: ${result.error}`
        if (expected.saw)
          return seen.some((s) => s.startsWith(expected.saw!))
            ? undefined
            : `expected the model to see "${expected.saw}", it saw ${JSON.stringify(seen.at(-1))}`
        const log = join(result.dir, 'mcp.jsonl')
        if (!existsSync(log)) return 'no request reached the endpoint'
        const sent = readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
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
