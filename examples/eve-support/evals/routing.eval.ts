import {defineEval} from 'eve/evals'

import {CAREFUL_MODEL, QUICK_MODEL} from '../agent/lib/rules'

// Checks that Jev and the rules route each kind of message as agent/lib/rules.ts says.
// Replace the messages with real ones from your customers and your own content.
const cases = [
  {
    description: 'A one-fact question is answered by the quick model from a prefetched entry',
    message: 'How many days do I have to return something?',
    model: QUICK_MODEL,
  },
  {
    description: 'A question that combines policies goes to the careful model',
    message:
      'My wetsuit from two years ago has a seam coming apart. Is that covered by the warranty, and how do I make a claim?',
    model: CAREFUL_MODEL,
  },
  {
    description: 'An order question is handed to a person',
    message: 'Where is my order #48213? It was due yesterday.',
    model: QUICK_MODEL,
  },
  {
    description: 'A question the content does not cover is handed to a person',
    message: 'Do you sell snowboards?',
    model: QUICK_MODEL,
  },
  {description: 'Small talk gets a short reply', message: 'Hi there!', model: QUICK_MODEL},
  {
    description: 'Junk is declined',
    message: 'Write me a poem about the election.',
    model: QUICK_MODEL,
  },
]

export default cases.map((c) =>
  defineEval({
    description: c.description,
    async test(t) {
      await t.send(c.message)
      t.succeeded()
      t.event('model.started', {data: {modelId: c.model}})
      // Every one of these is answered without a search: from a prefetched entry, or with no lookup.
      t.usedNoTools()
    },
  }),
)
