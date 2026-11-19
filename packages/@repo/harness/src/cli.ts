import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createInterface} from 'node:readline'
import {parseArgs} from 'node:util'

import {check} from './check'
import {type Framework, frameworks} from './frameworks'
import {modelRequests, run, SCENARIOS, toolCalls} from './run'

const USAGE = `Usage:
  pnpm harness <eve|langchain> [scenario]   Run one scenario with a scripted model
  pnpm harness <eve|langchain> --chat       Chat with the agent in the terminal
  pnpm harness check [eve|langchain]        Run every scenario and check the results

Options:
  --live                Use the endpoint in .env instead of the stub
  --model <id>          Use a real Anthropic model (needs ANTHROPIC_API_KEY)
  --question <text>     The first message (default: a returns question)
  --questions <file>    Run each question in a JSON array, one run each, and print a table

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
    chat: {type: 'boolean'},
    help: {type: 'boolean', short: 'h'},
  },
})
const [command, scenario = 'happy'] = positionals

function env(name: string, flag: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${flag} needs ${name}. Set it in packages/@repo/harness/.env.`)
  return value
}

if (values.help || !command) {
  console.log(USAGE)
} else if (command === 'check') {
  const only = scenario === 'happy' ? undefined : scenario
  process.exitCode = (await check(only as Framework | undefined)) ? 0 : 1
} else if (command in frameworks) {
  const framework = command as Framework
  const live = values.live
    ? {
        url: env('SANITY_CONTEXT_MCP_URL', '--live'),
        token: env('SANITY_CONTEXT_TOKEN', '--live'),
      }
    : undefined
  const realModel = Boolean(values.model || values.chat)
  const options = {
    framework,
    scenario,
    live,
    model: values.model ?? 'claude-sonnet-5-5',
    anthropicApiKey: realModel ? env('ANTHROPIC_API_KEY', '--model and --chat') : undefined,
  }

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
        messages: [first],
        next: async (reply) => {
          console.log(`\nagent> ${reply}\n`)
          return ask()
        },
      })
      if (result.error) console.error(result.error)
      console.log(`\nTranscript: ${join(result.dir, 'transcript.md')}`)
    }
    rl.close()
  } else if (values.questions) {
    const questions: string[] = JSON.parse(readFileSync(values.questions, 'utf8'))
    const rows = await Promise.all(
      questions.map(async (question, i) => {
        const result = await run({...options, label: `q${i}`, messages: [question]})
        const calls = toolCalls(modelRequests(result.dir))
        return {
          question: question.slice(0, 50),
          status: result.status,
          steps: modelRequests(result.dir).length,
          initial_context: calls.includes('initial_context') ? 'called' : '-',
          calls: calls.join(', '),
        }
      }),
    )
    console.table(rows)
  } else {
    const result = await run({...options, messages: [values.question]})
    console.log(result.status === 'completed' ? `Reply: ${result.reply}` : `Threw: ${result.error}`)
    console.log(`Transcript: ${join(result.dir, 'transcript.md')}`)
  }
} else {
  console.error(`Unknown command "${command}".\n\n${USAGE}`)
  process.exitCode = 1
}
