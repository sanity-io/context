/** @public */
export interface InitialContextOptions {
  /** The Context MCP endpoint URL. */
  url: string
  /** An organization API token with Context access. */
  token: string
  /** Milliseconds to wait before giving up. Defaults to 10 seconds. */
  timeoutMs?: number
}

/**
 * Fetches the endpoint's initial context (schema overview and/or Knowledge Base outline, plus its
 * Instructions) for inlining into a system prompt.
 *
 * Throws if the token is rejected (401/403). Returns `null` on any other failure, so the agent can
 * fall back to the `initial_context` tool.
 *
 * @public
 */
export async function fetchInitialContext({
  url,
  token,
  timeoutMs = 10_000,
}: InitialContextOptions): Promise<string | null> {
  const target = new URL(url)
  target.pathname = `${target.pathname.replace(/\/$/, '')}/initial-context`

  let response: Response
  try {
    response = await fetch(target, {
      headers: {Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    console.warn(
      `[sanity-context] Could not fetch the initial context: ${(error as Error).message}`,
    )
    return null
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Sanity Context rejected the token (${response.status}): ${await response.text()}`,
    )
  }
  if (!response.ok) {
    console.warn(`[sanity-context] Could not fetch the initial context (${response.status})`)
    return null
  }
  return response.text()
}
