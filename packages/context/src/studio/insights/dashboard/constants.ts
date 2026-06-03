import type {ScoreRange, Sentiment} from './types'

export const SCORE_RANGES: Record<ScoreRange, {min: number; max: number; label: string}> = {
  good: {min: 8, max: 11, label: 'Good (8-10)'},
  okay: {min: 6, max: 8, label: 'Okay (6-7)'},
  poor: {min: 4, max: 6, label: 'Poor (4-5)'},
  critical: {min: 0, max: 4, label: 'Critical (1-3)'},
}

export const SENTIMENT_OPTIONS: Sentiment[] = ['positive', 'neutral', 'negative']

export const METRIC_INFO = {
  conversations: 'Total conversations recorded.',
  averageScore:
    "Each conversation is scored from 1 to 10 based on how well the agent resolved the user's needs. This is the average across all analyzed conversations.",
  avgMessages:
    'The typical number of messages exchanged per conversation, including both user and agent messages.',
  analyzed:
    'Conversations are automatically analyzed to produce a score, sentiment rating, and content gaps. This shows how many have been analyzed so far.',
  scores:
    'How conversations break down by quality. Each is scored from 1 to 10 based on how well the agent helped the user.',
  sentiment:
    'The overall mood of each conversation: whether the user seemed satisfied (positive), neutral, or frustrated (negative).',
  contentGaps:
    'Topics where the agent lacked information to help the user. These highlight areas where adding or improving content could be valuable.',
  agentPerformance:
    'Performance per agent: number of conversations handled and average quality score.',
}
