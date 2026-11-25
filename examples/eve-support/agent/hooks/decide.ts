import {defineHook} from 'eve/hooks'

import {previousMessage, route, routeFor} from '../lib/rules'

// Runs before the turn's first model call: load the Knowledge Base index, ask Jev, apply the
// rules. agent/agent.ts, agent/instructions/route.ts and agent/connections/sanity.ts read the
// result from state.
export default defineHook({
  events: {
    // Warm the Knowledge Base index when a chat opens, so the first message doesn't wait for it.
    async 'session.started'() {
      const {loadIndex} = await import('../lib/knowledge-base')
      await loadIndex().catch((error: Error) =>
        console.warn(`Knowledge Base index not loaded: ${error.message}`),
      )
    },
    async 'turn.started'(_event, ctx) {
      const message = (ctx.turn?.input ?? [])
        .map((part) => (part.kind === 'text' ? part.text : ''))
        .join('\n')
        .trim()
      const {loadIndex, SanityContextError} = await import('../lib/knowledge-base')
      const {decideTurn} = await import('../lib/decide')

      // A message with no text (a file only) gets the careful search route, not the last turn's.
      if (!message) {
        route.update(() => routeFor(null, null))
        return
      }

      const started = Date.now()
      let index = null
      try {
        index = await loadIndex()
      } catch (error) {
        // A rejected token stops the turn with a clear error: never answer without your content.
        if (error instanceof SanityContextError && (error.status === 401 || error.status === 403))
          throw error
        // Anything else (a timeout, a server error) falls back to searching with the careful model.
        console.warn(`Knowledge Base index not loaded: ${(error as Error).message}`)
      }
      const indexMs = Date.now() - started

      let decision = null
      try {
        decision = await decideTurn(message, previousMessage.get(), index?.entries ?? [])
      } catch (error) {
        // Jev is an optimization, not a dependency: without it, the agent searches carefully.
        console.warn(`Jev decision skipped: ${(error as Error).message}`)
      }

      const next = routeFor(decision, index)
      route.update(() => next)
      previousMessage.update(() => message)

      const top = decision?.entries[0]
      console.log(
        decision
          ? `Jev ${decision.ms} ms: ${decision.intent} (${decision.intentConfidence.toFixed(2)}), ${decision.effort}, ` +
              `entry ${top ? `${top.path} (${top.probability.toFixed(2)})` : 'none'} → ${next.kind}` +
              `${next.entries.length ? ` [${next.entries.join(', ')}]` : ''} on ${next.model} · index ${indexMs} ms`
          : `Jev: no decision → ${next.kind} on ${next.model}`,
      )
    },
  },
})
