import {defineAgent} from 'eve'
import {anthropic} from 'eve/models/anthropic'

export default defineAgent({
  model: anthropic(process.env.HARNESS_MODEL ?? 'claude-sonnet-5-5'),
  modelContextWindowTokens: 200_000,
})
