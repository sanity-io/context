import {defineEval} from 'eve/evals'
import {satisfies} from 'eve/evals/expect'

// Checks the agent answers a basic question end to end. Use a question your content covers.
export default defineEval({
  async test(t) {
    const turn = await t.send('What is your return policy?')
    t.succeeded()
    t.noFailedCalls()
    t.check(
      turn.reply ?? '',
      satisfies((reply: string) => reply.trim().length > 20, 'a real answer'),
    )
  },
})
