import {describe, expect, it} from 'vitest'

import {describeError} from './describeError'

const httpError = (status: number, text: string) =>
  Object.assign(new Error(`Error POSTing to endpoint: ${text}`), {status, data: {status, text}})

describe('describeError', () => {
  it("gives the status and the server's message from a JSON-RPC body", () => {
    const body =
      '{"jsonrpc":"2.0","error":{"code":-32602,"message":"No schema deployed"},"id":null}'
    const error = new Error('Failed to load tools', {cause: httpError(400, body)})
    expect(describeError(error)).toBe('HTTP 400: No schema deployed')
  })

  it('gives only the status for a body without a message', () => {
    expect(describeError(httpError(502, '<html><body>502 Bad Gateway</body></html>'))).toBe(
      'HTTP 502',
    )
  })

  it("reads Mastra's error details", () => {
    const details = {
      httpStatus: 401,
      message:
        'Error POSTing to endpoint: {"error":"Unauthorized","message":"Invalid token"} (HTTP 401)',
    }
    expect(describeError(details)).toBe('HTTP 401: Invalid token')
  })

  it('keeps the first line of an error without a status', () => {
    expect(describeError(new Error('fetch failed\n    at node_modules/x.js'))).toBe('fetch failed')
  })

  it('stops on a cause chain that loops back on itself', () => {
    const error = new Error('first line\nsecond line')
    Object.assign(error, {cause: error})
    expect(describeError(error)).toBe('first line')
  })

  it('never throws, even for an error without a prototype', () => {
    expect(describeError(Object.create(null))).toBe('Unknown error')
  })
})
