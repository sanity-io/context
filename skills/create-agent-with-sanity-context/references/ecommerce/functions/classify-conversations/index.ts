import {anthropic} from '@ai-sdk/anthropic'
import {createClient} from '@sanity/client'
import {classifyConversations} from '@sanity/context/insights'
import {scheduledEventHandler} from '@sanity/functions'

export const handler = scheduledEventHandler(async () => {
  // SANITY_ORGANIZATION_ID, SANITY_CONTEXT_ENDPOINT_NAME, and SANITY_API_TOKEN
  // are injected by the blueprint's env block. These are example names — adapt to
  // match the user's env var conventions.
  const {SANITY_ORGANIZATION_ID, SANITY_CONTEXT_ENDPOINT_NAME, SANITY_API_TOKEN} = process.env

  if (!SANITY_ORGANIZATION_ID || !SANITY_CONTEXT_ENDPOINT_NAME || !SANITY_API_TOKEN) {
    console.error(
      '[classify-conversations] Missing SANITY_ORGANIZATION_ID, SANITY_CONTEXT_ENDPOINT_NAME, or SANITY_API_TOKEN',
    )
    return
  }

  const client = createClient({
    apiVersion: 'v2025-11-27',
    token: SANITY_API_TOKEN,
    context: {organizationId: SANITY_ORGANIZATION_ID},
    useCdn: false,
    useProjectHostname: false,
  })

  const result = await classifyConversations({
    client,
    mcpEndpoint: SANITY_CONTEXT_ENDPOINT_NAME,
    model: anthropic('claude-haiku-4-5'),
  })

  console.log(
    `Classified ${result.successCount}/${result.totalFound} conversations${result.errorCount > 0 ? ` (${result.errorCount} failed)` : ''}`,
  )
})
