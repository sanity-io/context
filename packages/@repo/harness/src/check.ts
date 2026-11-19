import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {type Framework} from './frameworks'
import {modelRequests, run, type RunResult, toolResults} from './run'

type Expectation = (result: RunResult, seen: string[]) => string | undefined

const completed: Expectation = (r) =>
  r.status === 'completed' ? undefined : `expected the run to complete, it threw: ${r.error}`
const threw =
  (message: string): Expectation =>
  (r) =>
    r.status === 'threw' && r.error?.startsWith(message)
      ? undefined
      : `expected the run to throw "${message}…", got ${r.status}: ${r.error ?? r.reply}`
const modelSaw =
  (text: string): Expectation =>
  (_, seen) =>
    seen.some((s) => s === text || s.startsWith(text))
      ? undefined
      : `expected the model to see "${text}", it saw ${JSON.stringify(seen.at(-1))}`

/** Every tool result the endpoint sent reached the model intact. eve prefixes errors with `Error: `. */
const unchanged: Expectation = (r, seen) => {
  const sent = readFileSync(join(r.dir, 'mcp.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((e) => e.rpc === 'tools/call' && e.response)
    .map((e) => resultText(e.response))
  const missing = sent.find((text) => !seen.some((s) => s.includes(text)))
  return missing === undefined ? undefined : `the model didn't see ${JSON.stringify(missing)}`
}

function resultText(response: string): string {
  const message = response.trimStart().startsWith('{')
    ? JSON.parse(response)
    : JSON.parse(
        response
          .split('\n')
          .find((l) => l.startsWith('data: '))!
          .slice(6),
      )
  const content: {type: string; text?: string}[] = message.result?.content ?? []
  return content.map((c) => c.text ?? '').join('')
}

/** What each package decides, per scenario. Faults the framework handles itself aren't checked. */
const EXPECTATIONS: Record<Framework, Record<string, Expectation[]>> = {
  langchain: {
    'happy': [completed, unchanged],
    '400': [
      completed,
      modelSaw(
        'Error calling tool groq_query: HTTP 400: This endpoint has no dataset schema deployed.',
      ),
    ],
    '401': [completed, modelSaw('Error calling tool groq_query: HTTP 401: Invalid token')],
    '500': [completed, modelSaw('Error calling tool groq_query: HTTP 500: Internal Server Error')],
    '502': [completed, modelSaw('Error calling tool groq_query: HTTP 502')],
    'reset': [completed, modelSaw('Error calling tool groq_query: TypeError: fetch failed')],
    'list-400': [threw('Could not connect to Sanity Context: HTTP 400: This endpoint has no')],
    'list-401': [threw('Sanity Context rejected the token (HTTP 401: Invalid token).')],
    'list-502': [threw('Could not connect to Sanity Context: HTTP 502')],
    'bad-token': [threw('Sanity Context rejected the token (HTTP 401: Invalid token).')],
  },
  eve: {
    'happy': [completed, unchanged],
    'bad-token': [completed, modelSaw('Error: "sanity-context__sanity" requires authorization')],
  },
}

export async function check(only?: Framework): Promise<boolean> {
  const jobs = Object.entries(EXPECTATIONS)
    .filter(([framework]) => !only || framework === only)
    .flatMap(([framework, scenarios]) =>
      Object.entries(scenarios).map(([scenario, expectations]) => ({
        framework: framework as Framework,
        scenario,
        expectations,
      })),
    )
  const failures = await Promise.all(
    jobs.map(async ({framework, scenario, expectations}) => {
      const result = await run({
        framework,
        scenario,
        model: 'claude-sonnet-5-5',
        messages: ['How do I return the "Classic" coffee cup?'],
      })
      const seen = toolResults(modelRequests(result.dir)).map((r) => r.text)
      const problems = expectations.map((expect) => expect(result, seen)).filter(Boolean)
      console.log(`${problems.length ? '✗' : '✓'} ${framework} ${scenario}`)
      for (const problem of problems) console.log(`    ${problem}\n    ${result.dir}`)
      return problems.length
    }),
  )
  const failed = failures.filter(Boolean).length
  console.log(`\n${jobs.length - failed} of ${jobs.length} scenarios passed.`)
  return failed === 0
}
