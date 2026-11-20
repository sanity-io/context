import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createInterface} from 'node:readline'
import {parseArgs} from 'node:util'

import {check} from './check'
import {type Framework, frameworks} from './frameworks'
import {
  initialContextOf,
  modelRequests,
  run,
  SCENARIOS,
  summarizeInitialContext,
  toolCalls,
} from './run'

const USAGE = `Usage:
  pnpm harness <eve|langchain> [scenario]   Run one scenario with a scripted model
  pnpm harness <eve|langchain> --chat       Chat with the agent in the terminal
  pnpm harness check [eve|langchain]        Run every scenario and check the results

Options:
  --live                Use the endpoint in .env instead of the stub
  --model <ids>         Use real Anthropic models, comma-separated (needs ANTHROPIC_API_KEY)
  --question <text>     The first message (default: a returns question)
  --questions <file>    Run each question in a JSON array, one run each, and print a table per model
  --repeat <n>          With --questions, run each question n times (default 1)

Scenarios: ${Object.keys(SCENARIOS).join(', ')}`

const envFile = join(import.meta.dirname, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    live: {type: 'boolean'},
    model: {type: 'string'},
    question: {type: 'string', default: 'How do I return the "Classic" coffee cup?'},
    questions: {type: 'string'},
    repeat: {type: 'string', default: '1'},
    chat: {type: 'boolean'},
    help: {type: 'boolean', short: 'h'},
  },
})
const [command, arg] = positionals
const scenario = arg ?? 'happy'

function env(name: string, flag: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${flag} needs ${name}. Set it in packages/@repo/harness/.env.`)
  return value
}

if (values.help || !command) {
  console.log(USAGE)
} else if (command === 'check') {
  process.exitCode = (await check(arg as Framework | undefined)) ? 0 : 1
} else if (command in frameworks) {
  const framework = command as Framework
  const live = values.live
    ? {
        url: env('SANITY_CONTEXT_MCP_URL', '--live'),
        token: env('SANITY_CONTEXT_TOKEN', '--live'),
      }
    : undefined
  const realModel = Boolean(values.model || values.chat)
  const models = (values.model ?? 'claude-sonnet-5-5').split(',')
  const options = {
    framework,
    scenario,
    live,
    model: models[0]!,
    anthropicApiKey: realModel ? env('ANTHROPIC_API_KEY', '--model and --chat') : undefined,
  }
  // eve reads the connection description to decide whether the endpoint covers a question.
  if (live && framework === 'eve')
    console.log(
      `eve connection description: ${process.env.SANITY_CONTEXT_DESCRIPTION ?? "(not set, so the stub's)"}`,
    )

  if (values.chat) {
    // The iterator buffers lines, so piped input works too. An empty line or end of input ends the chat.
    const rl = createInterface({input: process.stdin})
    const lines = rl[Symbol.asyncIterator]()
    const ask = async () => {
      process.stdout.write('you> ')
      const {value, done} = await lines.next()
      return done || !value.trim() ? undefined : (value as string)
    }
    const first = await ask()
    if (first) {
      const result = await run({
        ...options,
        label: 'chat',
        message: first,
        next: async (reply) => {
          console.log(`\nagent> ${reply}\n`)
          return ask()
        },
      })
      if (result.error) console.error(result.error)
      console.log(`\nInitial context: ${summarizeInitialContext(initialContextOf(result.dir))}`)
      console.log(`Transcript: ${join(result.dir, 'transcript.md')}`)
    }
    rl.close()
  } else if (values.questions) {
    const questions: string[] = JSON.parse(readFileSync(values.questions, 'utf8'))
    const runs = questions.flatMap((question, i) =>
      Array.from({length: Number(values.repeat)}, (_, r) => ({question, label: `q${i}r${r}`})),
    )
    // One model at a time; its runs go in parallel.
    for (const model of models) {
      const rows = await Promise.all(
        runs.map(async ({question, label}) => {
          const result = await run({...options, model, label, message: question})
          const calls = toolCalls(modelRequests(result.dir))
          return {
            question: question.slice(0, 50),
            error: result.error ?? '-',
            steps: modelRequests(result.dir).length,
            initial_context: calls.includes('initial_context') ? 'called' : '-',
            calls: calls.join(', '),
            dir: result.dir,
          }
        }),
      )
      console.table(rows.map(({dir: _, ...row}) => row))
      const called = rows.filter((r) => r.initial_context === 'called').length
      const steps = rows.reduce((n, r) => n + r.steps, 0) / rows.length
      const errors = rows.filter((r) => r.error !== '-').length
      console.log(
        `${model}: initial_context called in ${called} of ${rows.length} runs, ${steps.toFixed(1)} model steps on average, ${errors} errors.`,
      )
      console.log(`Initial context: ${summarizeInitialContext(initialContextOf(rows[0]!.dir))}\n`)
    }
  } else {
    const result = await run({...options, message: values.question})
    console.log(result.error ? `Threw: ${result.error}` : `Reply: ${result.reply}`)
    console.log(`Initial context: ${summarizeInitialContext(initialContextOf(result.dir))}`)
    console.log(`Transcript: ${join(result.dir, 'transcript.md')}`)
  }
} else {
  console.error(`Unknown command "${command}".\n\n${USAGE}`)
  process.exitCode = 1
}
