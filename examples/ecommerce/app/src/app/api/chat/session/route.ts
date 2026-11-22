import {createChatSessionCookie, isSameOrigin, readChatSession} from '@/lib/chat-session'

export async function POST(request: Request): Promise<Response> {
  const headers = new Headers({'Cache-Control': 'private, no-store'})
  if (!isSameOrigin(request))
    return Response.json({error: 'Request origin is not allowed'}, {status: 403, headers})
  try {
    if (!readChatSession(request)) headers.set('Set-Cookie', createChatSessionCookie())
    return new Response(null, {status: 204, headers})
  } catch (error) {
    console.error('Chat session configuration error:', error)
    return Response.json({error: 'Unable to start chat'}, {status: 500, headers})
  }
}
