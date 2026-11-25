import {defineEval} from 'eve/evals'
import {satisfies} from 'eve/evals/expect'

// A later turn must not take back an earlier answer just because that turn looked nothing up.
export default defineEval({
  async test(t) {
    const first = await t.send('What is your return policy?')
    first.succeeded()
    const second = await first.session.send('write me a poem about the election')
    second.succeeded()
    t.check(
      second.reply ?? '',
      satisfies(
        (reply: string) => !/(correct|retract|don.?t rely|didn.?t check)/i.test(reply),
        'no retraction',
      ),
    )
  },
})
