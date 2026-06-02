import {createClient, type SanityClient} from '@sanity/client'
import {createPublishedId, getVersionId} from '@sanity/id-utils'

export const AGENT_CONTEXT_PLATFORM_ID = '7c2e8da2-c322-41b9-870d-b524d8c187be'

export function getClient(): SanityClient {
  const projectId = process.env.CHANGELOG_SANITY_PROJECT_ID
  const dataset = process.env.CHANGELOG_SANITY_DATASET
  const token = process.env.CHANGELOG_SANITY_WRITE_TOKEN

  if (!projectId) throw new Error('CHANGELOG_SANITY_PROJECT_ID environment variable is required')
  if (!dataset) throw new Error('CHANGELOG_SANITY_DATASET environment variable is required')
  if (!token) throw new Error('CHANGELOG_SANITY_WRITE_TOKEN environment variable is required')

  return createClient({
    projectId,
    dataset,
    apiVersion: '2025-09-16',
    useCdn: false,
    token,
  })
}

export function createDocumentIds(version: string) {
  const versionId = Buffer.from(version).toString('base64url')
  const releaseId = `rcontext-pkg-${versionId}`

  const createId = (input: string) => {
    const published = createPublishedId(input)
    return {
      published,
      version: getVersionId(published, releaseId),
    }
  }

  const changelogDocumentId = createId(`context-pkg-${versionId}`)
  const apiVersionDocId = createId(`${changelogDocumentId.published}-api-version`)

  return {releaseId, changelogDocumentId, apiVersionDocId}
}
