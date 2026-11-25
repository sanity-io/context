'use client'

/** A browser-local bootstrap, shared by simultaneous sends, not a server session store. */
export function createChatSessionFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  let ready: Promise<void> | undefined

  function initialize(): Promise<void> {
    if (ready) return ready
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const pending = (async () => {
      try {
        const response = await fetchImpl('/api/chat/session', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Could not start the chat. Please try again.')
      } finally {
        clearTimeout(timeout)
      }
    })()
    ready = pending
    void pending.catch(() => {
      if (ready === pending) ready = undefined
    })
    return pending
  }

  function wait(pending: Promise<void>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        signal.removeEventListener('abort', abort)
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, {once: true})
      void pending.then(
        () => {
          signal.removeEventListener('abort', abort)
          resolve()
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        },
      )
    })
  }

  return async (input, init) => {
    const request = new Request(input, {...init, credentials: 'same-origin'})
    request.signal.throwIfAborted()
    const initialized = initialize()
    await wait(initialized, request.signal)
    const response = await fetchImpl(request.clone())
    if (response.status !== 401 || response.headers.get('x-sanity-chat-session') !== 'required')
      return response
    await response.body?.cancel()
    if (ready === initialized) ready = undefined
    await wait(initialize(), request.signal)
    return fetchImpl(request)
  }
}

export const chatSessionFetch = createChatSessionFetch()
