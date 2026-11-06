import type {SanityClient} from '@sanity/client'
import {type Mock, vi} from 'vitest'

interface ClientStub {
  client: SanityClient
  fetch: Mock
  save: Mock
  classify: Mock
}

/**
 * A stub `@sanity/client` for insights tests: `config()` carries the org id,
 * and `context.fetch` plus the conversation `PUT` and `PATCH` requests are
 * `vi.fn()`s handed back for assertions, called with `{threadId, ...body}`.
 */
export function makeClientStub(overrides?: {organizationId?: string | undefined}): ClientStub {
  const organizationId =
    overrides && 'organizationId' in overrides ? overrides.organizationId : 'org-123'
  const fetch = vi.fn()
  const save = vi.fn()
  const classify = vi.fn()
  const routes: Record<string, Mock> = {
    'PUT /organizations/{organizationId}/conversations/{threadId}': save,
    'PATCH /organizations/{organizationId}/conversations/{threadId}': classify,
  }
  const request = (route: string, init: {params: {threadId: string}; body: object}) =>
    routes[route]!({threadId: init.params.threadId, ...init.body})
  const client = {
    config: () => ({context: {organizationId}}),
    context: {fetch, request},
  } as unknown as SanityClient
  return {client, fetch, save, classify}
}
