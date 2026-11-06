import {createServer, type IncomingMessage, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'

import {createClient} from '@sanity/client'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateText: vi.fn(async () => ({
    output: {coreMetrics: {successScore: 8, sentiment: 'positive', contentGaps: []}},
  })),
}))

import {classifyConversation} from './insights/classifyConversation'
import {sanityInsightsIntegration} from './integrations/ai-sdk/telemetryIntegration'

type Received = {method: string; path: string; query?: Record<string, string>; body: unknown}

let server: Server
let received: Received[]
let respond: (req: Received) => unknown

async function readBody(req: IncomingMessage) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : undefined
}

function makeClient() {
  const {port} = server.address() as AddressInfo
  return createClient({
    apiHost: `http://127.0.0.1:${port}`,
    useProjectHostname: false,
    apiVersion: '2026-11-01',
    useCdn: false,
    token: 'test-token',
    context: {organizationId: 'org-123'},
  })
}

describe('against the real @sanity/client', () => {
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://localhost')
      const query = Object.fromEntries(url.searchParams)
      const entry = {
        method: req.method!,
        path: url.pathname,
        ...(Object.keys(query).length > 0 && {query}),
        body: await readBody(req),
      }
      received.push(entry)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(respond(entry) ?? {}))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('saves a conversation with a PUT on the conversation route', async () => {
    received = []
    respond = () => ({threadId: 'thread-1'})
    const {onStart, onFinish} = sanityInsightsIntegration({
      client: makeClient(),
      threadId: 'thread-1',
    })

    onStart({messages: [{role: 'user', content: 'Question'}]})
    await onFinish({
      response: {messages: [{role: 'assistant', content: 'Answer'}]},
      model: {provider: 'openai', modelId: 'gpt-4o'},
      totalUsage: {inputTokens: 1, outputTokens: 2},
    })

    expect(received).toEqual([
      {
        method: 'PUT',
        path: '/v2026-11-01/context/organizations/org-123/conversations/thread-1',
        body: {
          messages: [
            {role: 'user', content: 'Question'},
            {role: 'assistant', content: 'Answer'},
          ],
          modelProvider: 'openai',
          modelId: 'gpt-4o',
          tokenUsage: {inputTokens: 1, outputTokens: 2, totalTokens: 3},
        },
      },
    ])
  })

  it('reads the transcript and records the verdict with a PATCH', async () => {
    received = []
    respond = ({method}) =>
      method === 'PATCH'
        ? {classifiedAt: '2026-11-06T10:00:00Z'}
        : {result: {messages: [{role: 'user', content: 'Hello'}]}}

    const result = await classifyConversation({
      client: makeClient(),
      threadId: 'thread-1',
      model: 'mock-model' as never,
    })

    expect(result.classifiedAt).toBe('2026-11-06T10:00:00Z')
    expect(received).toHaveLength(2)
    expect(received[0]).toMatchObject({
      method: 'GET',
      path: '/v2026-11-01/context/organizations/org-123/query',
      query: {
        query: expect.stringContaining(
          'organizationId == $organizationId && threadId == $threadId',
        ),
        $organizationId: '"org-123"',
        $threadId: '"thread-1"',
      },
    })
    expect(received[1]).toEqual({
      method: 'PATCH',
      path: '/v2026-11-01/context/organizations/org-123/conversations/thread-1',
      body: {coreMetrics: {successScore: 8, sentiment: 'positive', contentGaps: []}},
    })
  })
})
