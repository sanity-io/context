import {type BadgeTone, useMediaIndex} from '@sanity/ui'
import {useCallback, useMemo} from 'react'
import {useObservable} from 'react-rx'
import {EMPTY, merge, of, Subject} from 'rxjs'
import {catchError, debounceTime, map, startWith, switchMap} from 'rxjs/operators'
import {DEFAULT_STUDIO_CLIENT_OPTIONS, useClient} from 'sanity'

import type {Sentiment} from './types'

export function useCompactLayout(): boolean {
  return useMediaIndex() < 3
}

export function formatSentiment(sentiment: Sentiment): string {
  return sentiment.charAt(0).toUpperCase() + sentiment.slice(1)
}

/**
 * Score threshold constants for success score evaluation.
 * Scores are on a 1-10 scale where:
 * - 8-10: Good (positive)
 * - 6-7: Okay (caution)
 * - 1-5: Poor (critical)
 */
const SCORE_THRESHOLDS = {
  GOOD: 8,
  OKAY: 6,
}

/**
 * Returns the Sanity UI tone for a success score.
 */
export function getScoreTone(
  score: number | undefined,
): 'default' | 'positive' | 'caution' | 'critical' {
  if (score === undefined) return 'default'
  if (score >= SCORE_THRESHOLDS.GOOD) return 'positive'
  if (score >= SCORE_THRESHOLDS.OKAY) return 'caution'
  return 'critical'
}

/**
 * Returns the Sanity UI tone for a sentiment value.
 */
export function getSentimentTone(sentiment: Sentiment | undefined): BadgeTone {
  switch (sentiment) {
    case 'positive':
      return 'positive'
    case 'negative':
      return 'critical'
    default:
      return 'default'
  }
}

export interface UseQueryResult<T> {
  data: T | null
  error: string | null
  loading: boolean
  retry: () => void
}

const LOADING_RESULT: UseQueryResult<never> = {
  data: null,
  error: null,
  loading: true,
  retry: () => {},
}

const LISTEN_DEBOUNCE_MS = 1000

interface UseListenQueryOptions {
  /**
   * A separate GROQ query to fetch data with.
   *
   * Use when the listen query differs from the fetch query, e.g. when the
   * fetch query uses `array::unique(...)` or other expressions the listen
   * endpoint can't filter on. When omitted, the listen query is used for both.
   */
  fetchQuery?: string
}

/**
 * Subscribes to document mutations via `client.observable.listen` and
 * re-fetches data whenever a matching mutation occurs. Live updates
 * replace data in the background without a loading flash.
 *
 * The first argument is the listen query — the GROQ query whose filter
 * determines which mutations trigger a re-fetch. By default the same
 * query is used to fetch data. Pass `fetchQuery` when the data query
 * differs (e.g. uses `array::unique`).
 */
export function useListenQuery<T>(
  query: string,
  params: Record<string, unknown> = {},
  options?: UseListenQueryOptions,
): UseQueryResult<T> {
  const client = useClient(DEFAULT_STUDIO_CLIENT_OPTIONS)
  const fetchQuery = options?.fetchQuery ?? query

  const retry$ = useMemo(() => new Subject<void>(), [])
  const retry = useCallback(() => retry$.next(), [retry$])

  const result$ = useMemo(
    () => {
      const fetchData$ = client.observable.fetch<T>(fetchQuery, params)

      const listen$ = client.observable
        .listen(query, params, {
          visibility: 'query',
          events: ['mutation'],
          includeResult: false,
        })
        .pipe(
          debounceTime(LISTEN_DEBOUNCE_MS),
          map(() => 'listen' as const),
          catchError(() => EMPTY),
        )

      const initialOrRetry$ = merge(
        of('initial' as const),
        retry$.pipe(map(() => 'retry' as const)),
      )

      const toResult$ = fetchData$.pipe(
        map((data): UseQueryResult<T> => ({data, error: null, loading: false, retry})),
        catchError((err: unknown) =>
          of<UseQueryResult<T>>({
            data: null,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
            retry,
          }),
        ),
      )

      return merge(initialOrRetry$, listen$).pipe(
        switchMap((source) =>
          source === 'listen'
            ? toResult$
            : toResult$.pipe(
                startWith<UseQueryResult<T>>({
                  data: null,
                  error: null,
                  loading: true,
                  retry,
                }),
              ),
        ),
      )
    },
    // Serialized params for value-based comparison — callers pass inline objects
    // which are new references each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, query, fetchQuery, JSON.stringify(params), retry$, retry],
  )

  return useObservable(result$, {...LOADING_RESULT, retry})
}
