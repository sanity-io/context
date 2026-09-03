import {parse} from 'groq-js'

/**
 * Convert a list of type names to a GROQ filter query
 */
export const listToQuery = (types: string[]): string => {
  const quoted = types.map((t) => `"${t}"`).join(', ')
  return `_type in [${quoted}]`
}

/**
 * Parse type names from a GROQ `_type in [...]` query
 */
export const queryToList = (query: string): string[] => {
  const match = query.match(/_type\s+in\s+\[([^\]]*)\]/)
  if (!match?.[1]) return []

  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/["']/g, ''))
    .filter(Boolean)
}

/**
 * Check if query is a simple `_type in [...]` filter that can be edited via the Types UI.
 * Returns false for complex queries like `_type in ["a"] && published == true`
 */
export const isSimpleTypeQuery = (query: string | undefined): boolean => {
  if (!query) return true // Empty is simple (can start fresh)
  return /^_type\s+in\s+\[[^\]]*\]$/.test(query.trim())
}

/**
 * Validate that input is a GROQ filter expression, not a full query.
 *
 * A filter expression is something that can appear inside `*[...]`, like:
 * - `_type == "post"`
 * - `_type in ["post", "author"] && published == true`
 *
 * This rejects:
 * - Full queries starting with `*` (e.g., `*[_type == "post"]`)
 * - Invalid GROQ syntax
 */
export const validateGroqFilter = (
  filter: string | undefined,
): {valid: boolean; error?: string} => {
  if (!filter) return {valid: true}

  const trimmed = filter.trim()

  // Quick check: reject if it looks like a full query
  if (trimmed.startsWith('*')) {
    return {
      valid: false,
      error:
        'Enter a filter expression, not a full query. Remove the leading "*[" and trailing "]".',
    }
  }

  // Parse the filter by wrapping in *[...], following the pattern from context-mcp
  // A valid filter wrapped this way produces: { type: "Filter", base: {...}, expr: {...} }
  try {
    const tree = parse(`*[${trimmed}]`)

    // After wrapping in *[...], a valid filter expression should parse to a Filter node
    // with type "Filter" and have an expr property containing the filter expression.
    // If it doesn't match this structure, it's not a valid filter.
    if (tree.type !== 'Filter' || !('expr' in tree) || !tree.expr) {
      return {
        valid: false,
        error: 'Enter a filter expression, not a full query.',
      }
    }

    return {valid: true}
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : 'Invalid GROQ filter syntax',
    }
  }
}
