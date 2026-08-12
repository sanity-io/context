import {describe, expect, it, vi} from 'vitest'

import {
  fetchKnowledgeBases,
  fetchKnowledgeBasesForProject,
  fetchProjectOrganizationId,
  type RequestClient,
  type RequestOptions,
} from './atlas'

/**
 * A fake client that records requested URLs and returns queued responses. The
 * paths must be VERSION-LESS and on no project hostname — the real client
 * prepends `https://api.sanity.work/vX`. These tests pin that contract, since a
 * doubled version (`/vX/vX`) or a project-host prefix is what broke the picker.
 */
function fakeClient(responses: unknown[]): {client: RequestClient; urls: string[]} {
  const urls: string[] = []
  let i = 0
  const client: RequestClient = {
    request: vi.fn(async (options: RequestOptions) => {
      urls.push(options.url)
      return responses[i++] as never
    }),
  }
  return {client, urls}
}

describe('fetchProjectOrganizationId', () => {
  it('requests the version-less /projects/{id} path and returns the org id', async () => {
    const {client, urls} = fakeClient([{organizationId: 'oWjsciicj'}])
    const org = await fetchProjectOrganizationId(client, 'm6urx9qg')
    expect(org).toBe('oWjsciicj')
    expect(urls).toEqual(['/projects/m6urx9qg'])
  })

  it('returns null when the project has no organization', async () => {
    const {client} = fakeClient([{organizationId: null}])
    expect(await fetchProjectOrganizationId(client, 'p')).toBeNull()
  })
})

describe('fetchKnowledgeBases', () => {
  it('requests the version-less, org-scoped, non-project-host path', async () => {
    const {client, urls} = fakeClient([{data: [{id: '1', slug: 's', name: 'N'}]}])
    await fetchKnowledgeBases(client, 'oWjsciicj')
    expect(urls).toEqual(['/context/organizations/oWjsciicj/knowledge-bases'])
    // Guard against the original bug: no version in the path, no project host.
    expect(urls[0]).not.toContain('/vX/')
    expect(urls[0]).not.toContain('.api.sanity')
  })

  it('follows nextCursor across pages and concatenates results', async () => {
    const {client, urls} = fakeClient([
      {data: [{id: '1', slug: 'a', name: 'A'}], nextCursor: 'CUR'},
      {data: [{id: '2', slug: 'b', name: 'B'}]},
    ])
    const result = await fetchKnowledgeBases(client, 'org')
    expect(result.map((k) => k.id)).toEqual(['1', '2'])
    expect(urls[1]).toContain('nextCursor=CUR')
  })
})

describe('fetchKnowledgeBasesForProject', () => {
  it('resolves the org from the project, then lists its knowledge bases', async () => {
    const {client, urls} = fakeClient([
      {organizationId: 'org-x'},
      {data: [{id: '1', slug: 'a', name: 'A'}]},
    ])
    const result = await fetchKnowledgeBasesForProject(client, 'proj-1')
    expect(result).toHaveLength(1)
    expect(urls).toEqual(['/projects/proj-1', '/context/organizations/org-x/knowledge-bases'])
  })

  it('returns [] without listing when the project has no org', async () => {
    const {client, urls} = fakeClient([{organizationId: null}])
    expect(await fetchKnowledgeBasesForProject(client, 'p')).toEqual([])
    expect(urls).toEqual(['/projects/p']) // never reached the list endpoint
  })
})
