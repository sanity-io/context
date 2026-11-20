import {type ChildProcess, execFile, spawn} from 'node:child_process'
import {cpSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import tls from 'node:tls'
import {promisify} from 'node:util'

import {ChatAnthropic} from '@langchain/anthropic'
import {createSanityContext} from '@sanity/context-langchain'
import {Client} from 'eve/client'
import {createAgent} from 'langchain'

export type Framework = 'eve' | 'langchain'

export interface AgentOptions {
  /** The proxy in front of the Context MCP endpoint. */
  mcpUrl: string
  token: string
  /** The fake Anthropic API, which scripts the model or forwards to Anthropic. */
  modelUrl: string
  model: string
  dir: string
  /** The proxy's certificate, for processes that can't trust it in-process. */
  certFile: string
}

export interface Agent {
  /** Sends a user message and returns the agent's reply. Later messages continue the conversation. */
  send: (message: string) => Promise<string>
  close: () => Promise<void>
}

/** The prefix eve gives the connection's tools, from the mount's file name. */
export const EVE_TOOL_PREFIX = 'sanity-context__sanity__'

const root = join(import.meta.dirname, '..')

export const frameworks: Record<Framework, (options: AgentOptions) => Promise<Agent>> = {
  async langchain(options) {
    tls.setDefaultCACertificates([
      ...tls.getCACertificates('default'),
      readFileSync(options.certFile, 'utf8'),
    ])
    const sanity = createSanityContext({url: options.mcpUrl, token: options.token})
    const agent = createAgent({
      model: new ChatAnthropic({
        model: options.model,
        anthropicApiUrl: options.modelUrl,
        apiKey: 'harness',
      }),
      systemPrompt: 'You are a support agent.',
      middleware: [sanity.middleware],
    })
    let messages: Awaited<ReturnType<typeof agent.invoke>>['messages'] = []
    return {
      async send(content) {
        const result = await agent.invoke(
          {messages: [...messages, {role: 'user', content}]},
          {recursionLimit: 50},
        )
        messages = result.messages
        return messages.at(-1)?.text ?? ''
      },
      close: () => sanity.close(),
    }
  },

  async eve(options) {
    const app = join(options.dir, 'eve-agent')
    cpSync(join(root, 'eve-agent'), app, {recursive: true})
    // eve takes the nearest package.json as the project root. pnpm-workspace.yaml excludes captures/.
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: {'eve': '*', '@sanity/context-eve': '*'},
      }),
    )
    const eve = join(root, 'node_modules/.bin/eve')
    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: `${options.modelUrl}/v1`,
      ANTHROPIC_API_KEY: 'harness',
      SANITY_CONTEXT_MCP_URL: options.mcpUrl,
      SANITY_CONTEXT_TOKEN: options.token,
      HARNESS_MODEL: options.model,
      NODE_EXTRA_CA_CERTS: options.certFile,
    }
    await promisify(execFile)(eve, ['build'], {cwd: app, env})
    let logs = ''
    // EVE_DEV lets eve's default localDev() auth accept the harness, as it does under `eve dev`.
    const child: ChildProcess = spawn(eve, ['start', '--host', '127.0.0.1', '--port', '0'], {
      cwd: app,
      env: {...env, EVE_DEV: '1'},
    })
    child.stdout?.on('data', (d) => (logs += d))
    child.stderr?.on('data', (d) => (logs += d))
    const close = async () => {
      child.kill()
      writeFileSync(join(options.dir, 'eve.log'), logs)
    }

    // Port 0 lets eve pick a free port, which it logs once it listens.
    let port: string | undefined
    for (let i = 0; !(port = /listening at http:\/\/[^:/]+:(\d+)/.exec(logs)?.[1]); i++) {
      if (i > 60 || child.exitCode !== null) {
        await close()
        throw new Error(`eve did not start:\n${logs}`)
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    const client = new Client({baseUrl: `http://127.0.0.1:${port}`})

    type Session = Awaited<ReturnType<typeof client.sessions.create>>['session']
    let session: Session | undefined
    return {
      async send(message) {
        let delivery
        if (session) delivery = await session.send(message)
        else ({session, delivery} = await client.sessions.create({message}))
        const result = await delivery.result()
        if (result.status !== 'completed')
          throw new Error(`eve ended the turn as ${result.status}: ${JSON.stringify(result.error)}`)
        return result.reply ?? ''
      },
      close,
    }
  },
}
