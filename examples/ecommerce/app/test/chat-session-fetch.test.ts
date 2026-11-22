import assert from 'node:assert/strict'
import {mock, test} from 'node:test'

import {createChatSessionFetch} from '../src/lib/chat-session-fetch.js'

const url = 'https://shop.test/api/chat'
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return {promise, resolve}
}
function challenge(): Response {
  return new Response('session required', {
    status: 401,
    headers: {'x-sanity-chat-session': 'required'},
  })
}

test('simultaneous sends share one bootstrap and wait before forwarding', async () => {
  const gate = deferred<Response>()
  let bootstraps = 0,
    chats = 0
  const call = createChatSessionFetch(async (input, init) => {
    if (input === '/api/chat/session') {
      bootstraps++
      assert.equal(init?.credentials, 'same-origin')
      return gate.promise
    }
    assert.ok(input instanceof Request)
    assert.equal(input.credentials, 'same-origin')
    chats++
    return new Response('ok')
  })
  const a = call(url),
    b = call(url)
  assert.equal(bootstraps, 1)
  assert.equal(chats, 0)
  gate.resolve(new Response(null, {status: 204}))
  await Promise.all([a, b])
  assert.equal(chats, 2)
  await call(url)
  assert.equal(bootstraps, 1)
})
test('failed initialization is retryable and forwards no chat', async () => {
  let n = 0,
    chats = 0
  const call = createChatSessionFetch(async (input) => {
    if (input === '/api/chat/session') return new Response(null, {status: ++n === 1 ? 500 : 204})
    chats++
    return new Response('ok')
  })
  await assert.rejects(call(url), /Could not start/)
  assert.equal(chats, 0)
  await call(url)
  assert.equal(n, 2)
  assert.equal(chats, 1)
})
test('pre-aborted send performs no initialization or chat', async () => {
  let calls = 0
  const call = createChatSessionFetch(async () => {
    calls++
    return new Response('ok')
  })
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(call(url, {signal: controller.signal}), /cancelled/)
  assert.equal(calls, 0)
})
test('one cancelled waiter does not cancel another send or shared bootstrap', async () => {
  const gate = deferred<Response>()
  let bootSignal: AbortSignal | null | undefined,
    chats = 0
  const call = createChatSessionFetch(async (input, init) => {
    if (input === '/api/chat/session') {
      bootSignal = init?.signal
      return gate.promise
    }
    chats++
    return new Response('ok')
  })
  const controller = new AbortController(),
    a = call(url, {signal: controller.signal}),
    b = call(url)
  controller.abort(new Error('one caller cancelled'))
  await assert.rejects(a, /one caller cancelled/)
  assert.equal(bootSignal?.aborted, false)
  gate.resolve(new Response(null, {status: 204}))
  await b
  assert.equal(chats, 1)
})
test('session-required response refreshes once and preserves the POST body', async () => {
  let starts = 0
  const bodies: string[] = []
  const call = createChatSessionFetch(async (input) => {
    if (input === '/api/chat/session') {
      starts++
      return new Response(null, {status: 204})
    }
    assert.ok(input instanceof Request)
    bodies.push(await input.text())
    return bodies.length === 1 ? challenge() : new Response('ok')
  })
  const response = await call(url, {method: 'POST', body: 'same payload'})
  assert.equal(response.status, 200)
  assert.equal(starts, 2)
  assert.deepEqual(bodies, ['same payload', 'same payload'])
})
test('concurrent stale challenges share the refresh instead of rotating again', async () => {
  const stale = deferred<Response>()
  let starts = 0,
    chats = 0
  const call = createChatSessionFetch(async (input) => {
    if (input === '/api/chat/session') {
      starts++
      return starts === 2 ? stale.promise : new Response(null, {status: 204})
    }
    return ++chats <= 2 ? challenge() : new Response('ok')
  })
  const a = call(url),
    b = call(url)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(starts, 2)
  stale.resolve(new Response(null, {status: 204}))
  await Promise.all([a, b])
  assert.equal(starts, 2)
  assert.equal(chats, 4)
})
for (const status of [401, 403, 429, 500])
  test('does not replay ordinary HTTP error ' + status, async () => {
    let chats = 0,
      starts = 0
    const call = createChatSessionFetch(async (input) => {
      if (input === '/api/chat/session') {
        starts++
        return new Response(null, {status: 204})
      }
      chats++
      return new Response('error', {status})
    })
    assert.equal((await call(url)).status, status)
    assert.equal(chats, 1)
    assert.equal(starts, 1)
  })
test('a second challenge is returned, never retried indefinitely', async () => {
  let chats = 0,
    starts = 0
  const call = createChatSessionFetch(async (input) => {
    if (input === '/api/chat/session') {
      starts++
      return new Response(null, {status: 204})
    }
    chats++
    return challenge()
  })
  assert.equal((await call(url)).status, 401)
  assert.equal(chats, 2)
  assert.equal(starts, 2)
})

test('bootstrap timeout aborts initialization, forwards no chat and permits retry', async () => {
  mock.timers.enable({apis: ['setTimeout']})
  try {
    let starts = 0,
      chats = 0
    const call = createChatSessionFetch(async (input, init) => {
      if (input === '/api/chat/session') {
        if (++starts > 1) return new Response(null, {status: 204})
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          assert.ok(signal)
          signal.addEventListener('abort', () => reject(signal.reason), {once: true})
        })
      }
      chats++
      return new Response('ok')
    })
    const pending = call(url)
    const rejected = assert.rejects(pending, {name: 'AbortError'})
    mock.timers.tick(10_000)
    await rejected
    assert.equal(chats, 0)
    assert.equal((await call(url)).status, 200)
    assert.equal(starts, 2)
    assert.equal(chats, 1)
  } finally {
    mock.timers.reset()
  }
})
