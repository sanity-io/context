import type {SanityClient} from '@sanity/client'
import {type Mock, vi} from 'vitest'

interface ClientStub {
  client: SanityClient
  fetch: Mock
  save: Mock
  classify: Mock
  get: Mock
}

/**
 * A stub `@sanity/client` for insights tests: `config()` carries the org id
 * and every `client.context` method is a `vi.fn()` handed back for assertions.
 */
export function makeClientStub(overrides?: {organizationId?: string | undefined}): ClientStub {
  const organizationId =
    overrides && 'organizationId' in overrides ? overrides.organizationId : 'org-123'
  const fetch = vi.fn()
  const save = vi.fn()
  const classify = vi.fn()
  const get = vi.fn()
  const client = {
    config: () => ({context: {organizationId}}),
    context: {fetch, conversations: {save, classify, get}},
  } as unknown as SanityClient
  return {client, fetch, save, classify, get}
}
