import {defineState} from 'eve/context'

import type {Decision} from './decide'
import type {KnowledgeBaseIndex} from './knowledge-base'

// Jev decides. Code enforces. The model writes.
// This file is the "code enforces" part: it turns Jev's answers into this turn's model,
// instructions and tools. Edit the models, thresholds and wording here.

export const QUICK_MODEL = 'anthropic/claude-haiku-5.5'
export const CAREFUL_MODEL = 'anthropic/claude-sonnet-5.5'

/** Below this, ignore Jev's intent and let the careful model search. */
export const MIN_INTENT_CONFIDENCE = 0.55
/** Prefetch the best entry when Jev gives it at least this probability. */
export const MIN_ENTRY_PROBABILITY = 0.4
/** Also prefetch the runner-up when it's at least this likely (a question can span two entries). */
export const SECOND_ENTRY_PROBABILITY = 0.15
/** Hand off as "not covered" only when Jev is this sure no entry answers it. */
export const MIN_NOT_COVERED_PROBABILITY = 0.6

/** Where customers reach a person. Connect your helpdesk in handOff() below. */
export const SUPPORT_CONTACT = 'the support team at support@example.com'

export type RouteKind =
  'answer_from_entry' | 'search' | 'needs_a_person' | 'not_covered' | 'small_talk' | 'off_topic'

export interface Route {
  kind: RouteKind
  model: string
  /** Added to the system prompt for this turn. */
  instruction: string
  /**
   * Entry text looked up for this question. It joins the conversation history (as a user-role
   * instruction), so later turns still see the content earlier answers came from.
   */
  content: string | null
  /** Whether the agent gets the Sanity Context search tools this turn. */
  tools: boolean
  /** Entries put in the prompt, if any. */
  entries: string[]
  decision: Decision | null
}

export function routeFor(decision: Decision | null, index: KnowledgeBaseIndex | null): Route {
  const search = (reason: string): Route => ({
    kind: 'search',
    model: CAREFUL_MODEL,
    tools: true,
    entries: [],
    content: null,
    decision,
    instruction: `${reason} Look the answer up with the Sanity Context tools. If nothing you find answers it, say so and hand off: ${handOff()}\n\n${index?.initialContext ?? ''}`,
  })

  // No decision (Jev unavailable) or not sure what the customer wants: search carefully.
  if (!decision || decision.intentConfidence < MIN_INTENT_CONFIDENCE) return search('')

  switch (decision.intent) {
    case 'off_topic':
      return reply(
        decision,
        'off_topic',
        "Say in one sentence that you can only help with questions about the company and its products. Don't answer the request.",
      )
    case 'small_talk':
      return reply(
        decision,
        'small_talk',
        'Reply in one short, friendly sentence and offer to help.',
      )
    case 'needs_a_person':
      return reply(
        decision,
        'needs_a_person',
        `This message is about a specific order, payment or account, which only a person can look up. Don't guess about it. In one or two sentences, hand off: ${handOff()}`,
      )
    case 'question': {
      const [best, second] = decision.entries
      if (best && best.probability >= MIN_ENTRY_PROBABILITY && index) {
        const picked = [best, second].filter(
          (e) => e && (e === best || e.probability >= SECOND_ENTRY_PROBABILITY),
        )
        const texts = picked
          .map((e) => index.entries.find((entry) => entry.path === e!.path)?.text)
          .filter(Boolean)
        return {
          kind: 'answer_from_entry',
          // A question that spans two entries means combining sources: give it the careful model.
          model: decision.effort === 'quick' && picked.length === 1 ? QUICK_MODEL : CAREFUL_MODEL,
          tools: false,
          entries: picked.map((e) => e!.path),
          decision,
          content: `Content looked up for the next question:\n\n${texts.join('\n\n---\n\n')}`,
          instruction: `Answer from the content looked up for this question, just before it in the conversation. If it doesn't answer the question, say so and hand off: ${handOff()}`,
        }
      }
      if (decision.noEntry >= MIN_NOT_COVERED_PROBABILITY) {
        return reply(
          decision,
          'not_covered',
          `Our help content doesn't cover this question. Don't guess. Say so in one sentence and hand off: ${handOff()}`,
        )
      }
      return search("Jev wasn't sure which entry answers this.")
    }
  }
}

/** A short reply from the quick model, with no lookup. */
function reply(decision: Decision, kind: RouteKind, instruction: string): Route {
  return {kind, model: QUICK_MODEL, tools: false, entries: [], content: null, decision, instruction}
}

/**
 * What the customer is told when a person needs to take over. To open a ticket in your helpdesk
 * (Zendesk, Intercom, a Slack channel), do it in agent/hooks/decide.ts when the route is
 * needs_a_person or not_covered, and change this text to match.
 */
function handOff() {
  return `tell them a person can help, and that they can reach ${SUPPORT_CONTACT}.`
}

/** This turn's route. The decide hook writes it; the model, instructions and connection read it. */
export const route = defineState<Route>('support.route', () => routeFor(null, null))

/** The previous customer message, so Jev can read follow-ups in context. */
export const previousMessage = defineState<string | null>('support.previous-message', () => null)
