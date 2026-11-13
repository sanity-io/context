import {fetchInitialContext} from '@sanity/context'
import {defineDynamic, defineInstructions} from 'eve/instructions'

import extension from './extension'

export default defineDynamic(async (ctx) => {
  const initialContext = await ctx.memo(ctx.session.id, () => fetchInitialContext(extension.config))
  return defineInstructions({
    content:
      initialContext ??
      "Sanity Context's initial context couldn't be loaded. Call the initial_context tool before your first lookup.",
  })
})
