import {defineAgent, defineDynamic} from 'eve'

import {route} from './lib/rules'

export default defineAgent({
  // Jev picks the model for each turn (see agent/hooks/decide.ts and agent/lib/rules.ts).
  // Both models go through the Vercel AI Gateway.
  model: defineDynamic(() => route.get().model),
  // Answer only from your Sanity content: no shell, file or web tools.
  defaultTools: false,
})
