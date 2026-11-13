import {fetchInitialContext} from '@sanity/context'
import {defineDynamic, defineInstructions} from 'eve/instructions'

import extension from './extension'

class InitialContextUnavailable extends Error {}

export default defineDynamic(async (ctx) => {
  // A failing memo saves nothing, so a failed fetch is retried on the next model call.
  const initialContext = await ctx
    .memo(ctx.session.id, async () => {
      const text = await fetchInitialContext(extension.config)
      if (text === null) throw new InitialContextUnavailable()
      return text
    })
    .catch((error: unknown) => {
      if (error instanceof InitialContextUnavailable) return null
      throw error
    })
  return initialContext ? defineInstructions({content: initialContext}) : null
})
