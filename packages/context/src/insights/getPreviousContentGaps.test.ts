import {describe, expect, it} from 'vitest'

import {makeClientStub} from './clientStub'
import {getPreviousContentGaps} from './getPreviousContentGaps'

describe('getPreviousContentGaps', () => {
  it('queries classified conversations and ranks gaps by frequency', async () => {
    const {client, fetch} = makeClientStub()
    fetch.mockResolvedValue([
      ['billing info', 'return policy'],
      ['return policy'],
      ['return policy', 'shipping rates'],
    ])

    const result = await getPreviousContentGaps({client})

    expect(result).toEqual(['return policy', 'billing info', 'shipping rates'])
    const [query, params] = fetch.mock.calls[0]!
    expect(query).toContain('coreMetrics.contentGaps')
    expect(params).toEqual({organizationId: 'org-123'})
  })

  it('caps the result at the top 50 gaps', async () => {
    const {client, fetch} = makeClientStub()
    const gaps = Array.from({length: 60}, (_, i) => `gap-${i}`)
    fetch.mockResolvedValue([gaps, ['gap-59']])

    const result = await getPreviousContentGaps({client})

    expect(result).toHaveLength(50)
    expect(result[0]).toBe('gap-59')
  })
})
