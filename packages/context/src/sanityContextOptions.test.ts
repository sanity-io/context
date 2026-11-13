import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {createInitialContextCache} from './sanityContextOptions'

const url = 'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/s'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('createInitialContextCache', () => {
  it('reuses a successful fetch until the TTL expires', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => new Response('# A'))
    vi.stubGlobal('fetch', fetch)
    const get = createInitialContextCache({url, token: 't', cacheTtlMs: 1000})
    expect(await get()).toBe('# A')
    expect(await get()).toBe('# A')
    expect(fetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1001)
    await get()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure and retries on the next call', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', {status: 502}))
      .mockResolvedValue(new Response('# A'))
    vi.stubGlobal('fetch', fetch)
    const get = createInitialContextCache({url, token: 't'})
    expect(await get()).toBeNull()
    expect(await get()).toBe('# A')
  })

  it('keeps serving the last successful value when a refresh fails', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('# A'))
      .mockResolvedValueOnce(new Response('', {status: 502}))
      .mockResolvedValue(new Response('# B'))
    vi.stubGlobal('fetch', fetch)
    const get = createInitialContextCache({url, token: 't', cacheTtlMs: 1000})
    expect(await get()).toBe('# A')
    vi.advanceTimersByTime(1001)
    expect(await get()).toBe('# A')
    expect(await get()).toBe('# B')
  })

  it('shares one in-flight fetch between concurrent callers', async () => {
    const fetch = vi.fn(async () => new Response('# A'))
    vi.stubGlobal('fetch', fetch)
    const get = createInitialContextCache({url, token: 't'})
    await Promise.all([get(), get(), get()])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
