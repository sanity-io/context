import {defineDynamic, defineInstructions} from 'eve/instructions'

import {getInitialContext} from './lib/initial-context'

export default defineDynamic(async (ctx) => {
  const initialContext = await getInitialContext(ctx)
  return initialContext ? defineInstructions({content: initialContext}) : null
})
