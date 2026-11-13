import {fetchInitialContext} from '@sanity/context'
import {defineDynamic, defineInstructions} from 'eve/instructions'

import extension from './extension'

export default defineDynamic(async (ctx) => {
  const initialContext = await ctx.memo(ctx.session.id, () => fetchInitialContext(extension.config))
  return initialContext ? defineInstructions({content: initialContext}) : null
})
