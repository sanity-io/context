import {isSlug} from 'sanity'

/**
 * Construct the MCP URL for a Sanity Context document
 */
export const getMcpURL = (payload: {
  apiHost: string
  projectId: string
  dataset: string
  slug: unknown
}): string => {
  if (!isSlug(payload.slug)) return ''

  const currentSlug = payload.slug.current

  // Use the current date YYYY-MM-DD as the API version
  const currentDate = new Date().toISOString().split('T')[0]
  const apiVersion = `v${currentDate}`

  return `${payload.apiHost}/${apiVersion}/context/mcp/${payload.projectId}/${payload.dataset}/${currentSlug}`
}
