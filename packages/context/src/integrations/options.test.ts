import {describe, expect, it} from 'vitest'

import {validateOptions} from './options'

const url = 'https://api.sanity.io/v2026-11-03/context/organizations/o1/mcp/s'

describe('validateOptions', () => {
  it('names the missing url', () => {
    expect(() => validateOptions({url: undefined as unknown as string, token: 't'})).toThrow(
      'Sanity Context needs a url: the Context MCP endpoint URL.',
    )
  })

  it('names the missing token', () => {
    expect(() => validateOptions({url, token: ''})).toThrow(
      'Sanity Context needs a token: an organization API token with Context access.',
    )
  })

  it('refuses a url that is not https, or not a url', () => {
    expect(() => validateOptions({url: 'not a url', token: 't'})).toThrow(
      'Sanity Context needs an https URL.',
    )
  })

  it('accepts an https url and a token', () => {
    expect(() => validateOptions({url, token: 't'})).not.toThrow()
  })
})
