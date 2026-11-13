import {afterEach, describe, expect, it, vi} from 'vitest'

import {fetchInitialContext} from './initialContext'

const url = 'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/support/?x=1'

function mockFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchInitialContext', () => {
  it('appends /initial-context to the path, keeps the query and sends the token', async () => {
    const spy = mockFetch(async () => new Response('# Outline'))
    await expect(fetchInitialContext({url, token: 't'})).resolves.toBe('# Outline')
    const [target, init] = spy.mock.calls[0] as unknown as [URL, RequestInit]
    expect(target.href).toBe(
      'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/support/initial-context?x=1',
    )
    expect(init.headers).toEqual({Authorization: 'Bearer t'})
  })

  it.each([401, 403])('throws on %i', async (status) => {
    mockFetch(async () => new Response('nope', {status}))
    await expect(fetchInitialContext({url, token: 't'})).rejects.toThrow(`(${status}): nope`)
  })

  it('returns null and warns on a server error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => new Response('', {status: 500}))
    await expect(fetchInitialContext({url, token: 't'})).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('(500)'))
  })

  it('returns null and warns when the request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(fetchInitialContext({url, token: 't'})).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fetch failed'))
  })

  it('returns null and warns when reading the body fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => {
      const response = new Response('# Outline')
      vi.spyOn(response, 'text').mockRejectedValue(
        new Error('The operation was aborted due to timeout'),
      )
      return response
    })
    await expect(fetchInitialContext({url, token: 't'})).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('aborted due to timeout'))
  })

  it('returns null and warns on an empty response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => new Response('  '))
    await expect(fetchInitialContext({url, token: 't'})).resolves.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('empty response'))
  })
})
