import {defineDynamic, defineInstructions} from 'eve/instructions'

import {route} from '../lib/rules'

// Puts the entries looked up for this question into the conversation, just before it. Unlike the
// system prompt, the conversation keeps them, so later turns still see what earlier answers used.
export default defineDynamic(() => {
  const {content} = route.get()
  return content ? defineInstructions({role: 'user', content}) : null
})
