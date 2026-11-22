import 'server-only'

import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto'

const SESSION_SECONDS = 24 * 60 * 60
const SECRET_NAME = 'SANITY_CHAT_SESSION_SECRET'

export interface ChatSession {
  id: string
  expiresAt: number
}

function sessionKey(): Buffer {
  const value = process.env[SECRET_NAME] ?? ''
  const key = Buffer.from(value, 'base64url')
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    key.length !== 32 ||
    key.toString('base64url') !== value
  ) {
    throw new Error(`${SECRET_NAME} must be 32 random bytes encoded as base64url`)
  }
  return key
}

function cookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Host-sanity-chat-session'
    : 'sanity-chat-session'
}

function signature(key: Buffer, session: ChatSession): Buffer {
  return createHmac('sha256', key)
    .update(JSON.stringify(['sanity-chat-session', 1, session.id, session.expiresAt]))
    .digest()
}

/** Only accept cookies issued by this server, never an owner supplied in the JSON body. */
export function readChatSession(request: Request): ChatSession | undefined {
  const key = sessionKey()
  const matches = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.slice(0, part.indexOf('=')) === cookieName())
  if (matches.length !== 1) return undefined
  const value = matches[0].slice(matches[0].indexOf('=') + 1)
  const match = /^v1\.([A-Za-z0-9_-]{43})\.([1-9]\d{0,11})\.([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match) return undefined
  const [, id, expiry, encodedSignature] = match
  if (Buffer.from(id, 'base64url').toString('base64url') !== id) return undefined
  const received = Buffer.from(encodedSignature, 'base64url')
  if (received.length !== 32 || received.toString('base64url') !== encodedSignature)
    return undefined
  const session = {id, expiresAt: Number(expiry)}
  if (!timingSafeEqual(received, signature(key, session))) return undefined
  if (session.expiresAt <= Math.floor(Date.now() / 1000)) return undefined
  return session
}

export function createChatSessionCookie(): string {
  const key = sessionKey()
  const session = {
    id: randomBytes(32).toString('base64url'),
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  }
  const value = `v1.${session.id}.${session.expiresAt}.${signature(key, session).toString('base64url')}`
  return `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

export function isSameOrigin(request: Request): boolean {
  try {
    const url = new URL(request.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    // Next can normalize the URL hostname. Host is the browser's HTTP authority;
    // do not use an untrusted X-Forwarded-Host value as an authorization input.
    const host = request.headers.get('host')
    if (host === null) return request.headers.get('origin') === url.origin
    if (host.trim() !== host || ['/', '\\', '?', '#', '@'].some((char) => host.includes(char)))
      return false
    return request.headers.get('origin') === new URL(`${url.protocol}//${host}`).origin
  } catch {
    return false
  }
}

export function isValidChatId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

export function conversationThreadId(
  session: ChatSession,
  organizationId: string,
  chatId: string,
): string {
  if (!organizationId || !isValidChatId(chatId)) throw new Error('Invalid conversation scope')
  return (
    'anon-v1-' +
    createHmac('sha256', sessionKey())
      .update(JSON.stringify(['sanity-chat-conversation', 1, organizationId, session.id, chatId]))
      .digest('hex')
  )
}

/** Reject before parsing the body or starting any model/MCP operation. */
export function authorizeChatRequest(request: Request): ChatSession | Response {
  const headers = {'Cache-Control': 'private, no-store'}
  if (!isSameOrigin(request))
    return Response.json({error: 'Request origin is not allowed'}, {status: 403, headers})
  try {
    const session = readChatSession(request)
    return (
      session ??
      Response.json(
        {error: 'Chat session required'},
        {
          status: 401,
          headers: {...headers, 'x-sanity-chat-session': 'required'},
        },
      )
    )
  } catch (error) {
    console.error('Chat session configuration error:', error)
    return Response.json({error: 'Unable to start chat'}, {status: 500, headers})
  }
}
