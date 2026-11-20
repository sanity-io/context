import {defineDynamic, defineInstructions} from 'eve/instructions'

import extension from './extension'

// Only when the fetch failed: next to an inlined initial context, models follow this and load it again.
const LOAD_INITIAL_CONTEXT =
  "Before you use the Sanity Context connection, make sure you've seen its initial context. It describes the content the connection covers and how to look things up. If it isn't already in your instructions or this conversation, load it first: find the connection's `initial_context` tool with `eve__search` and call it with `eve__tool`."

export default defineDynamic(async (ctx) => {
  const initialContext = await ctx.memo(ctx.session.id, async ({abortSignal}) => {
    const {url, token} = extension.config
    const endpoint = new URL(url)
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/initial-context`
    try {
      const res = await fetch(endpoint, {
        headers: {Authorization: `Bearer ${token}`},
        signal: AbortSignal.any([abortSignal, AbortSignal.timeout(10_000)]),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (!text) throw new Error('empty response')
      return text
    } catch (error) {
      // An interrupted step runs again, so don't save its failure for the rest of the session.
      if (abortSignal.aborted) throw error
      console.warn(
        `[sanity-context] Could not load the initial context: ${(error as Error).message}`,
      )
      // Saved for the session, so a failing endpoint doesn't slow every model call.
      return null
    }
  })
  return defineInstructions({content: initialContext ?? LOAD_INITIAL_CONTEXT})
})
