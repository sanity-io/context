import {createServer} from 'node:http'

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {z} from 'zod'

import {listen} from './servers'

/** A fictional shop, with the awkward characters real content has: quotes, newlines, tabs, æøå. */
export const INITIAL_CONTEXT = `# Stub Shop: Context & Schema

## Context Instructions

Answer in the customer's language. Prices are in "NOK" — never convert. Use \`price.amount\`.

## Schema

<resource-schema>
product (42 docs)
  title: string
  price: {amount: number, currency: "NOK"}
  categories[] -> category
</resource-schema>

## Knowledge bases

## Returns policy
Knowledge base id: \`kb1\`
- /returns/how-to — Returning an item ✅
- /returns/frister — Frister for retur (æøå)\tTabbed`

const err = (message: string) => ({
  isError: true,
  content: [{type: 'text' as const, text: JSON.stringify({error: true, message})}],
})
const ok = (text: string) => ({content: [{type: 'text' as const, text}]})

function server() {
  const s = new McpServer(
    {name: 'sanity-context', version: '1.0.0'},
    {
      instructions:
        "# Stub Shop\n\nThis MCP provides access to a Sanity dataset and knowledge bases. If you haven't already been given the schema, knowledge base outlines, and usage instructions, **start by loading them** before making any queries.",
    },
  )
  const annotations = {readOnlyHint: true}
  s.registerTool(
    'initial_context',
    {
      description: '**Call this first**, unless its output was already provided to you.',
      annotations,
    },
    async () => ok(INITIAL_CONTEXT),
  )
  s.registerTool(
    'groq_query',
    {description: 'Run a GROQ query.', inputSchema: {query: z.string()}, annotations},
    async ({query}) => {
      if (!query.includes(']')) return err('Invalid GROQ query: expected "]" at position 12')
      return ok(
        JSON.stringify([
          {_id: 'p1', title: 'Kaffekopp "Classic"', price: {amount: 199, currency: 'NOK'}},
          {_id: 'p2', title: 'Tekanne\nmed lokk', price: {amount: 349.5, currency: 'NOK'}},
        ]),
      )
    },
  )
  s.registerTool(
    'knowledge_base_search',
    {
      description: 'Search a knowledge base.',
      inputSchema: {knowledgeBase: z.string(), query: z.string()},
      annotations,
    },
    async () =>
      ok(
        '### /returns/how-to\nReturn within **30 days**. Use the "Retur" form.\n\n---\n\n### /returns/frister\nFristen er 30 dager.',
      ),
  )
  s.registerTool(
    'knowledge_base_read',
    {
      description: 'Read knowledge base entries.',
      inputSchema: {knowledgeBase: z.string(), paths: z.array(z.string())},
      annotations,
    },
    async () => ok('# How to return\n\n1. Open "My orders"\n2. Click `Return`'),
  )
  return s
}

/** A Context MCP endpoint serving the Stub Shop, with the `/initial-context` route beside it. */
export async function startStub() {
  const http = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/mcp/initial-context')) {
      // The real route shifts headings down one level.
      res.writeHead(200, {'content-type': 'text/plain; charset=utf-8'})
      return res.end(INITIAL_CONTEXT.replace(/^#/gm, '##'))
    }
    if (req.method !== 'POST') return res.writeHead(405).end()
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await server().connect(transport)
    await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString()))
  })
  const url = await listen(http)
  return {url: `${url}/mcp`, close: () => http.close()}
}
