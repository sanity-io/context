import {defineDynamic, defineInstructions} from 'eve/instructions'

import extension from '../extension'

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
      if (res.ok) return await res.text()
      console.error(`[sanity-context] Could not load the initial context: HTTP ${res.status}`)
    } catch (error) {
      // An interrupted step runs again, so don't save its failure for the rest of the session.
      if (abortSignal.aborted) throw error
      console.error(`[sanity-context] Could not load the initial context: ${error}`)
    }
    // Saved for the session, so a failing endpoint doesn't slow every model call. The model loads it with the tool instead.
    return null
  })
  return initialContext
    ? defineInstructions({content: `# Sanity Context initial context\n\n${initialContext}`})
    : null
})
