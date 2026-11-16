/** @public */
export interface SanityContextOptions {
  /** The Context MCP endpoint URL. */
  url: string
  /** An organization API token with Context access. */
  token: string
}

export function validateOptions({url, token}: SanityContextOptions): void {
  if (!url) throw new Error('Sanity Context needs a url: the Context MCP endpoint URL.')
  if (!token)
    throw new Error('Sanity Context needs a token: an organization API token with Context access.')
  // The token goes in a header, so a plain http URL would send it in clear text.
  if (!URL.canParse(url) || new URL(url).protocol !== 'https:')
    throw new Error('Sanity Context needs an https URL.')
}
