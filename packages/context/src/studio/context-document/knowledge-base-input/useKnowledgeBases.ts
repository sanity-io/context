import {useCallback, useMemo} from 'react'
import {useObservable} from 'react-rx'
import {firstValueFrom, of, Subject} from 'rxjs'
import {catchError, map, startWith, switchMap} from 'rxjs/operators'
import {DEFAULT_STUDIO_CLIENT_OPTIONS, useClient, useProjectId} from 'sanity'

import {fetchKnowledgeBasesForProject, type KnowledgeBase, type RequestClient} from './atlas'

export interface KnowledgeBasesState {
  knowledgeBases: KnowledgeBase[]
  loading: boolean
  error: string | null
  retry: () => void
}

const INITIAL: KnowledgeBasesState = {
  knowledgeBases: [],
  loading: true,
  error: null,
  retry: () => {},
}

/**
 * Fetch the current project's knowledge bases from Atlas. Resolves the org from
 * the projectId, then lists its knowledge bases, exposing loading/error/retry —
 * the same shape the insights dashboard uses for its data hooks.
 */
export function useKnowledgeBases(): KnowledgeBasesState {
  const studioClient = useClient(DEFAULT_STUDIO_CLIENT_OPTIONS)
  const projectId = useProjectId()

  const retry$ = useMemo(() => new Subject<void>(), [])
  const retry = useCallback(() => retry$.next(), [retry$])

  const state$ = useMemo(() => {
    // The Atlas / Context endpoints are GLOBAL (org-scoped), served from the
    // bare API host — not the project hostname the Studio client uses by
    // default. With project hostnames on, the client builds
    // `https://<projectId>.api.sanity.work/<version>/...`, which 404s/CORS-fails.
    // Reconfigure to hit the bare host with apiVersion `vX`; the atlas helpers
    // then pass version-less paths (`/context/...`) and the client prepends
    // `https://api.sanity.work/vX`.
    const client = studioClient.withConfig({
      useProjectHostname: false,
      apiVersion: 'vX',
    })

    const requestClient: RequestClient = {
      request: (options) => firstValueFrom(client.observable.request(options)),
    }

    const load = () =>
      of(null).pipe(
        switchMap(() => fetchKnowledgeBasesForProject(requestClient, projectId)),
        map(
          (knowledgeBases): KnowledgeBasesState => ({
            knowledgeBases,
            loading: false,
            error: null,
            retry,
          }),
        ),
        catchError((err: unknown) =>
          of<KnowledgeBasesState>({
            knowledgeBases: [],
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            retry,
          }),
        ),
        startWith({...INITIAL, retry}),
      )

    return retry$.pipe(
      startWith(undefined),
      switchMap(() => load()),
    )
  }, [studioClient, projectId, retry, retry$])

  return useObservable(state$, {...INITIAL, retry})
}
