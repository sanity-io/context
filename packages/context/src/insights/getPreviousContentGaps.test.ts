import {describe, expect, it} from 'vitest'

import {rankByFrequency} from './getPreviousContentGaps'

describe('rankByFrequency', () => {
  it('deduplicates case-insensitively and preserves first-seen casing', () => {
    const gaps = ['billing info', 'Billing Info', 'billing info']
    const result = rankByFrequency(gaps, 50)
    expect(result).toEqual(['billing info'])
  })

  it('ranks by frequency descending', () => {
    const gaps = [
      'return policy',
      'billing info',
      'billing info',
      'billing info',
      'return policy',
      'shipping rates',
    ]
    const result = rankByFrequency(gaps, 50)
    expect(result).toEqual(['billing info', 'return policy', 'shipping rates'])
  })

  it('respects the limit parameter', () => {
    const gaps = ['a', 'a', 'b', 'b', 'c', 'd', 'e']
    const result = rankByFrequency(gaps, 2)
    expect(result).toHaveLength(2)
    expect(result).toEqual(['a', 'b'])
  })

  it('returns empty array for empty input', () => {
    expect(rankByFrequency([], 50)).toEqual([])
  })

  it('handles single gap', () => {
    expect(rankByFrequency(['only one'], 50)).toEqual(['only one'])
  })
})
