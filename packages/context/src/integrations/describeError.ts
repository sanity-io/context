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

/** The status and server message of the first HTTP error in the cause chain, if there is one. */
export function describeHttpError(error: unknown): string | undefined {
  return httpError(error)?.text
}

/** The error to throw when the endpoint's tools can't be listed. */
export function connectionError(error: unknown): Error {
  const detail = describeError(error)
  const status = httpError(error)?.status
  const message =
    status === 401 || status === 403
      ? `Sanity Context rejected the token (${detail}). Use an organization API token with Context access.`
      : `Could not connect to Sanity Context: ${detail}`
  return new Error(message, {cause: error})
}

function httpError(error: unknown): {status: number; text: string} | undefined {
  let e = error
  for (let depth = 0; depth < 10 && e && typeof e === 'object'; depth++) {
    const {status, httpStatus, data, cause} = e as {
      status?: unknown
      httpStatus?: unknown
      data?: {text?: unknown}
      cause?: unknown
    }
    const code = typeof status === 'number' ? status : httpStatus
    if (typeof code === 'number') {
      const detail = serverMessage(typeof data?.text === 'string' ? data.text : messageOf(e))
      return {status: code, text: detail ? `HTTP ${code}: ${detail}` : `HTTP ${code}`}
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
