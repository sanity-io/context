/**
 * One line describing a failed MCP request. An HTTP error becomes its status and the server's own
 * message, without the raw response body, which can be a gateway's HTML page.
 */
export function describeError(error: unknown): string {
  try {
    return httpError(error)?.text ?? messageOf(error).split('\n')[0] ?? ''
  } catch {
    return 'Unknown error'
  }
}

/** The error to throw when the endpoint's tools can't be listed. */
export function connectionError(error: unknown): Error {
  const http = httpError(error)
  const detail = http?.text ?? describeError(error)
  const message =
    http?.status === 401 || http?.status === 403
      ? `Sanity Context rejected the token (${detail}). Use an organization API token with Context access.`
      : `Could not connect to Sanity Context: ${detail}`
  return new Error(message, {cause: error})
}

/** The status and server message of the first HTTP error in the cause chain, if there is one. */
export function httpError(error: unknown): {status: number; text: string} | undefined {
  try {
    return findHttpError(error)
  } catch {
    return undefined
  }
}

function findHttpError(error: unknown): {status: number; text: string} | undefined {
  let e = error
  for (let depth = 0; depth < 10 && e && typeof e === 'object'; depth++) {
    const {status, data, cause} = e as {status?: unknown; data?: {text?: unknown}; cause?: unknown}
    if (typeof status === 'number') {
      const detail = serverMessage(typeof data?.text === 'string' ? data.text : messageOf(e))
      return {status, text: detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`}
    }
    e = cause
  }
  return undefined
}

function messageOf(error: unknown) {
  const message = (error as {message?: unknown} | undefined)?.message
  return typeof message === 'string' ? message : String(error)
}

function serverMessage(text: string) {
  try {
    const body = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    const message = body?.error?.message ?? body?.message ?? body?.error
    return typeof message === 'string' ? message : undefined
  } catch {
    return undefined
  }
}
