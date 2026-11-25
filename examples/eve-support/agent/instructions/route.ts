import {defineDynamic, defineInstructions} from 'eve/instructions'

import {route} from '../lib/rules'

// Adds this turn's rule, and any content looked up for it, to the system prompt.
export default defineDynamic(() =>
  defineInstructions({content: `# For this message\n\n${route.get().instruction}`}),
)
