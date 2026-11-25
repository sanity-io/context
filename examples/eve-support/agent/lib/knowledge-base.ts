// Reads your Sanity Context endpoint directly, so Jev can pick an entry and the agent can put
// it in the prompt before the model runs. The agent's own tools (agent/connections/sanity.ts)
// use the same endpoint when it needs to search instead.

export interface Entry {
  knowledgeBase: string
  path: string
  /** The entry's first paragraph. Jev reads it to decide which entry answers a question. */
  summary: string
  text: string
}

/** An error from the Sanity Context endpoint, with its HTTP status. */
export class SanityContextError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export interface KnowledgeBaseIndex {
  /** The endpoint's initial context: Knowledge Base outline or dataset schema, plus its Instructions. */
  initialContext: string
  entries: Entry[]
}

// Reload the index every five minutes, so edits in the Context app reach the agent quickly.
const TTL_MS = 5 * 60_000
let cached: {index: KnowledgeBaseIndex; expires: number} | undefined

export async function loadIndex(): Promise<KnowledgeBaseIndex> {
  if (cached && cached.expires > Date.now()) return cached.index
  const initialContext = await fetchInitialContext()
  const entries: Entry[] = []
  for (const {id, paths} of parseOutline(initialContext)) {
    // knowledge_base_read takes up to 20 paths per call.
    for (let i = 0; i < paths.length; i += 20) {
      const batch = paths.slice(i, i + 20)
      let texts = splitEntries(
        await callTool('knowledge_base_read', {knowledgeBase: id, paths: batch}),
      )
      // If the batch didn't come back one entry per path, read them one at a time so no entry
      // gets another entry's text.
      if (texts.length !== batch.length) {
        texts = await Promise.all(
          batch.map((path) => callTool('knowledge_base_read', {knowledgeBase: id, paths: [path]})),
        )
      }
      batch.forEach((path, j) => {
        const text = texts[j] ?? ''
        entries.push({knowledgeBase: id, path, summary: firstParagraph(text), text})
      })
    }
  }
  const index = {initialContext, entries}
  cached = {index, expires: Date.now() + TTL_MS}
  return index
}

function settings() {
  return {url: process.env.SANITY_CONTEXT_MCP_URL!, token: process.env.SANITY_ORGANIZATION_TOKEN!}
}

async function fetchInitialContext(): Promise<string> {
  const {url, token} = settings()
  const res = await fetch(`${url.replace(/\/$/, '')}/initial-context`, {
    headers: {Authorization: `Bearer ${token}`},
  })
  if (!res.ok)
    throw new SanityContextError(
      `Sanity Context initial context failed (${res.status}): ${await res.text()}`,
      res.status,
    )
  return res.text()
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const {url, token} = settings()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {name, arguments: args},
    }),
  })
  const body = await res.text()
  if (!res.ok)
    throw new SanityContextError(
      `Sanity Context ${name} failed (${res.status}): ${body}`,
      res.status,
    )
  // The endpoint answers with JSON, or with a server-sent event that carries the same JSON.
  const json = JSON.parse(body.includes('data:') ? body.slice(body.indexOf('data:') + 5) : body)
  if (json.error || json.result?.isError) {
    throw new SanityContextError(
      `Sanity Context ${name} failed: ${JSON.stringify(json.error ?? json.result)}`,
      200,
    )
  }
  return json.result.content.map((part: {text?: string}) => part.text ?? '').join('\n')
}

/** Finds each Knowledge Base id and its entry paths in the initial context's outline. */
function parseOutline(initialContext: string) {
  return initialContext
    .split(/^#### /m)
    .slice(1)
    .map((block) => ({
      id: block.match(/Knowledge base id: `([^`]+)`/)?.[1],
      paths: block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^[\w-]+(\/[\w-]+)*$/.test(line)),
    }))
    .filter((kb): kb is {id: string; paths: string[]} => Boolean(kb.id) && kb.paths.length > 0)
}

/** knowledge_base_read returns several entries in one text, separated by a rule. */
function splitEntries(text: string) {
  return text.split(/\n-{3,}\n+(?=# )/).map((entry) => entry.trim())
}

function firstParagraph(text: string) {
  const paragraph = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith('#'))
  return (paragraph ?? '').replace(/\s+/g, ' ').slice(0, 300)
}
