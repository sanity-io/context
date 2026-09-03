import {describe, expect, it, vi} from 'vitest'

import {getMcpURL} from './mcpUrlUtils'

describe('getMcpURL', () => {
  it('should correctly construct the URL with a valid slug, projectId, dataset, and apiHost', () => {
    const result = getMcpURL({
      apiHost: 'https://api.sanity.io',
      projectId: 'test-project',
      dataset: 'production',
      slug: {_type: 'slug', current: 'my-agent-context'},
    })

    // Extract the date part to verify the format
    const dateMatch = result.match(/v(\d{4}-\d{2}-\d{2})/)
    expect(dateMatch).toBeTruthy()
    expect(dateMatch?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Verify the URL structure
    expect(result).toContain('https://api.sanity.io')
    expect(result).toContain('context/mcp/test-project/production/my-agent-context')
  })

  it('should return an empty string if the slug is invalid', () => {
    // Slug is null
    expect(
      getMcpURL({
        apiHost: 'https://api.sanity.io',
        projectId: 'test-project',
        dataset: 'production',
        slug: null,
      }),
    ).toBe('')

    // Slug is undefined
    expect(
      getMcpURL({
        apiHost: 'https://api.sanity.io',
        projectId: 'test-project',
        dataset: 'production',
        slug: undefined,
      }),
    ).toBe('')

    // Slug is a string instead of an object
    expect(
      getMcpURL({
        apiHost: 'https://api.sanity.io',
        projectId: 'test-project',
        dataset: 'production',
        slug: 'invalid-slug',
      }),
    ).toBe('')

    // Slug object missing current property
    expect(
      getMcpURL({
        apiHost: 'https://api.sanity.io',
        projectId: 'test-project',
        dataset: 'production',
        slug: {},
      }),
    ).toBe('')
  })

  it('should use the current date in YYYY-MM-DD format as the API version', () => {
    const mockDate = new Date('2024-03-15T10:30:00Z')
    vi.setSystemTime(mockDate)

    const result = getMcpURL({
      apiHost: 'https://api.sanity.io',
      projectId: 'test-project',
      dataset: 'production',
      slug: {_type: 'slug', current: 'my-agent-context'},
    })

    expect(result).toContain('/v2024-03-15/')
    expect(result).toBe(
      'https://api.sanity.io/v2024-03-15/context/mcp/test-project/production/my-agent-context',
    )

    vi.useRealTimers()
  })
})
