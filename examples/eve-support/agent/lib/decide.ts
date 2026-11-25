import {decide} from 'eve/ai'

import type {Entry} from './knowledge-base'

// Jev is a decision model from TypeSafe AI. It doesn't write text: it puts probabilities on the
// options you give it, in a few hundred milliseconds, through the Vercel AI Gateway. eve's
// decide() uses it by default.

export const NONE = 'none_of_these'

/**
 * Jev picks from at most this many entries. A larger Knowledge Base skips the entry question,
 * and questions take the search route instead.
 */
export const MAX_ENTRY_OPTIONS = 100

const intent = {
  type: 'choice',
  instructions: 'What does the customer want from their latest message?',
  criteria: {
    question:
      'A question the company\'s published content could answer: products, sizing, care, shipping, returns, warranty, store policies. Examples: "What is your return window?", "Is the 4/3 wetsuit warm enough for 12°C water?"',
    needs_a_person:
      'Something only a person with account access can do: a specific order, refund, charge, delivery problem, account change or complaint. Examples: "Where is order #1234?", "I was charged twice", "Cancel my order".',
    small_talk:
      'A greeting, thanks or chit-chat with no question in it. Examples: "Hi!", "Thanks, that helped".',
    off_topic:
      'Unrelated to the company and its products, or junk. Examples: "Write me a poem", "Who will win the election?", "asdfgh".',
  },
} as const

const effort = {
  type: 'choice',
  instructions: 'How much work does a good answer to the latest message take?',
  criteria: {
    quick: 'One fact from one place: a policy detail, a price, a yes or no.',
    careful:
      'Comparing products, combining several policies, several steps, or a frustrated customer who needs care.',
  },
} as const

export type Intent = keyof (typeof intent)['criteria']
export type Effort = keyof (typeof effort)['criteria']

export interface Decision {
  intent: Intent
  intentConfidence: number
  effort: Effort
  /** Entry paths with Jev's probability that each one answers the question, best first. */
  entries: {path: string; probability: number}[]
  /** Jev's probability that no entry answers the question (0 when Jev wasn't asked). */
  noEntry: number
  ms: number
}

/** Asks Jev all three questions in one request: what they want, how hard it is, and where the answer is. */
export async function decideTurn(
  message: string,
  previousMessage: string | null,
  entries: Entry[],
): Promise<Decision> {
  const started = Date.now()
  const entry =
    entries.length > 0 && entries.length <= MAX_ENTRY_OPTIONS
      ? {
          type: 'choice' as const,
          instructions: 'Which Knowledge Base entry most likely answers the latest message?',
          criteria: {
            ...Object.fromEntries(entries.map((e) => [e.path, e.summary || e.path])),
            [NONE]: 'No entry covers the question.',
          },
        }
      : undefined

  const {answers} = await decide({
    // Include the previous message so follow-ups like "and for kids?" read correctly.
    state: previousMessage
      ? {latest_message: message, previous_message: previousMessage}
      : {latest_message: message},
    questions: entry ? {intent, effort, entry} : {intent, effort},
  })

  const intentAnswer = choiceOf(answers.intent)
  const entryAnswer = entry ? choiceOf(answers.entry) : undefined
  const entryProbabilities = entryAnswer?.probabilities ?? {}
  return {
    intent: intentAnswer.choice as Intent,
    intentConfidence: intentAnswer.probabilities[intentAnswer.choice] ?? 1,
    effort: choiceOf(answers.effort).choice as Effort,
    entries: Object.entries(entryProbabilities)
      .filter(([path]) => path !== NONE)
      .map(([path, probability]) => ({path, probability}))
      .sort((a, b) => b.probability - a.probability),
    // Without an entry question (no Knowledge Base, or too many entries), "not covered" is unknown: 0.
    noEntry: entry ? (entryProbabilities[NONE] ?? (entryAnswer?.choice === NONE ? 1 : 0)) : 0,
    ms: Date.now() - started,
  }
}

/** Reads a choice answer: the chosen option and the probability of every option. */
function choiceOf(answer: unknown): {choice: string; probabilities: Record<string, number>} {
  const a = answer as {type?: string; choice?: string; probabilities?: Record<string, number>}
  if (a?.type !== 'choice' || !a.choice) throw new Error('Jev returned no choice')
  return {choice: a.choice, probabilities: {...(a.probabilities ?? {[a.choice]: 1})}}
}
