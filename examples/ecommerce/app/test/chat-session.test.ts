import assert from 'node:assert/strict'
import {afterEach, beforeEach, mock, test} from 'node:test'

import {POST as bootstrap} from '../src/app/api/chat/session/route.js'
import {
  authorizeChatRequest,
  conversationThreadId,
  createChatSessionCookie,
  isValidChatId,
  readChatSession,
} from '../src/lib/chat-session.js'

let environment: NodeJS.ProcessEnv
beforeEach(() => {
  environment = process.env
  process.env = {
    ...environment,
    NODE_ENV: 'test',
    SANITY_CHAT_SESSION_SECRET: Buffer.alloc(32, 7).toString('base64url'),
  }
})
afterEach(() => {
  process.env = environment
  mock.restoreAll()
})
const origin = 'https://shop.test'
function request(cookie?: string, source: string | null = origin): Request {
  const headers = new Headers()
  if (source !== null) headers.set('Origin', source)
  if (cookie !== undefined) headers.set('Cookie', cookie)
  return new Request(origin + '/api/chat', {method: 'POST', headers})
}
function issued(): string {
  return createChatSessionCookie().split(';')[0]
}

test('server-issued cookie authenticates and does not contain a browser-selected owner', () => {
  const cookie = issued(),
    session = readChatSession(request(cookie))
  assert.ok(session)
  assert.equal(Buffer.from(session.id, 'base64url').length, 32)
  assert.ok(session.expiresAt > Date.now() / 1000)
  assert.ok(!(authorizeChatRequest(request(cookie)) instanceof Response))
})
test('same session and chat retain their namespace across requests', () => {
  const cookie = issued(),
    a = readChatSession(request(cookie)),
    b = readChatSession(request(cookie))
  assert.ok(a && b)
  assert.equal(conversationThreadId(a, 'org-a', 'chat'), conversationThreadId(b, 'org-a', 'chat'))
})
test('different sessions cannot target one another using the same chat ID', () => {
  const a = readChatSession(request(issued())),
    b = readChatSession(request(issued()))
  assert.ok(a && b)
  const target = conversationThreadId(a, 'org-a', 'known-chat')
  assert.notEqual(target, conversationThreadId(b, 'org-a', 'known-chat'))
  assert.notEqual(target, conversationThreadId(b, 'org-a', target))
})
test('organization and chat are separate namespace components', () => {
  const session = readChatSession(request(issued()))
  assert.ok(session)
  const a = conversationThreadId(session, 'ab', 'c')
  assert.notEqual(a, conversationThreadId(session, 'a', 'bc'))
  assert.notEqual(a, conversationThreadId(session, 'ab', 'd'))
})
test('dot/slash/Unicode client identifiers remain data in a bounded server key', () => {
  const session = readChatSession(request(issued()))
  assert.ok(session)
  for (const id of ['.', '..', 'a/b', '%2e%2e', 'разговор'])
    assert.match(conversationThreadId(session, 'org', id), /^anon-v1-[a-f0-9]{64}$/)
})
for (const value of ['', 1, null, undefined, 'x'.repeat(201)])
  test('rejects invalid chat identifier ' + String(value), () =>
    assert.equal(isValidChatId(value), false),
  )
test('missing cookie fails closed with the recognizable pre-generation challenge', () => {
  const result = authorizeChatRequest(request())
  assert.ok(result instanceof Response)
  assert.equal(result.status, 401)
  assert.equal(result.headers.get('x-sanity-chat-session'), 'required')
})
for (const source of [
  null,
  'null',
  'https://other.test',
  'http://shop.test',
  'https://shop.test:444',
])
  test(
    'rejects untrusted Origin ' + (source === null ? '<missing>' : JSON.stringify(source)),
    () => {
      const result = authorizeChatRequest(request(issued(), source))
      assert.ok(result instanceof Response)
      assert.equal(result.status, 403)
    },
  )
test('forged session and changed expiry cannot authenticate', () => {
  const cookie = issued(),
    [prefix, sid, expiry, sig] = cookie.split('=')[1].split('.')
  for (const value of [
    `${prefix}.${sid}.${Number(expiry) + 1}.${sig}`,
    `${prefix}.${sid}.${expiry}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`,
    'v1.owner.99999999999.signature',
  ])
    assert.equal(readChatSession(request('sanity-chat-session=' + value)), undefined)
})
test('valid signed cookie expires at its server-defined deadline', () => {
  const cookie = issued(),
    session = readChatSession(request(cookie))
  assert.ok(session)
  mock.method(Date, 'now', () => session.expiresAt * 1000)
  assert.equal(readChatSession(request(cookie)), undefined)
})
test('duplicate cookies cannot select a preferred owner', () => {
  const a = issued(),
    b = issued()
  assert.equal(readChatSession(request(a + '; ' + b)), undefined)
})
test('secret rotation rejects the old cookie', () => {
  const cookie = issued()
  process.env.SANITY_CHAT_SESSION_SECRET = Buffer.alloc(32, 8).toString('base64url')
  assert.equal(readChatSession(request(cookie)), undefined)
})
test('production cookie is host-only, Secure, HttpOnly and SameSite', () => {
  process.env = {...process.env, NODE_ENV: 'production'}
  const cookie = createChatSessionCookie()
  assert.match(cookie, /^__Host-sanity-chat-session=/)
  for (const attribute of ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=86400', 'Secure'])
    assert.ok(cookie.includes(attribute))
  assert.ok(!cookie.includes('Domain='))
  assert.ok(readChatSession(request(cookie.split(';')[0])))
})
test('bootstrap issues once and does not rotate a valid cookie', async () => {
  const first = await bootstrap(request())
  assert.equal(first.status, 204)
  const cookie = first.headers.get('set-cookie')
  assert.ok(cookie)
  const next = await bootstrap(request(cookie.split(';')[0]))
  assert.equal(next.status, 204)
  assert.equal(next.headers.get('set-cookie'), null)
  assert.equal(first.headers.get('cache-control'), 'private, no-store')
})
test('independent cookie-free bootstraps cannot choose a shared owner', async () => {
  const results = await Promise.all([bootstrap(request()), bootstrap(request())])
  const cookies = results.map((r) => r.headers.get('set-cookie')?.split(';')[0])
  assert.ok(cookies[0] && cookies[1])
  assert.notEqual(cookies[0], cookies[1])
  assert.ok(readChatSession(request(cookies[0])) && readChatSession(request(cookies[1])))
})
test('bootstrap does not set a cookie for a cross-origin request', async () => {
  const result = await bootstrap(request(undefined, 'https://other.test'))
  assert.equal(result.status, 403)
  assert.equal(result.headers.get('set-cookie'), null)
})
test('invalid secret configuration never issues a session', async () => {
  process.env.SANITY_CHAT_SESSION_SECRET = ''
  mock.method(console, 'error', () => {})
  const result = await bootstrap(request())
  assert.equal(result.status, 500)
  assert.equal(result.headers.get('set-cookie'), null)
  const guard = authorizeChatRequest(request())
  assert.ok(guard instanceof Response)
  assert.equal(guard.status, 500)
})

for (const [scheme, host] of [
  ['http:', '127.0.0.1:3000'],
  ['https:', 'shop.test'],
  ['http:', '[::1]:3000'],
]) {
  test('accepts the HTTP Host when Next normalizes the request URL: ' + host, () => {
    const result = authorizeChatRequest(
      new Request(scheme + '//localhost/api/chat', {
        method: 'POST',
        headers: {Host: host, Origin: scheme + '//' + host, Cookie: issued()},
      }),
    )
    assert.ok(!(result instanceof Response))
  })
}
for (const [host, source, forwarded] of [
  ['shop.test', 'https://evil.test', 'evil.test'],
  ['shop.test', 'http://shop.test', 'shop.test'],
  ['shop.test/path', 'https://shop.test', 'shop.test'],
  ['evil@shop.test', 'https://shop.test', 'shop.test'],
]) {
  test(
    'does not authorize through mismatched/invalid Host or untrusted forwarded Host: ' +
      host +
      ' ' +
      source,
    () => {
      const result = authorizeChatRequest(
        new Request('https://localhost/api/chat', {
          method: 'POST',
          headers: {
            'Host': host,
            'Origin': source,
            'X-Forwarded-Host': forwarded,
            'Cookie': issued(),
          },
        }),
      )
      assert.ok(result instanceof Response)
      assert.equal(result.status, 403)
    },
  )
}
