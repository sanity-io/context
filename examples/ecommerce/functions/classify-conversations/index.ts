import {createClient} from '@sanity/client'
import {classifyConversations} from '@sanity/agent-context/insights'
import {scheduledEventHandler} from '@sanity/functions'
import {anthropic} from '@ai-sdk/anthropic'

export const handler = scheduledEventHandler(async ({context}) => {
  if (!context.clientOptions?.token) {
    console.error('[classify-conversations] No client token available')
    return
  }

  // SANITY_PROJECT_ID and SANITY_DATASET are injected by the blueprint's env block.
  // These are example names — adapt to match the user's env var conventions.
  const client = createClient({
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: process.env.SANITY_DATASET,
    apiVersion: '2026-01-01',
    token: context.clientOptions.token,
    useCdn: false,
  })

  const result = await classifyConversations({
    client,
    model: anthropic('claude-haiku-4-5'),
    telemetry: {
      shareMetrics: true,
      // shareConversations: true,
      // contact: 'you@company.com',
    },
  })

  console.log(
    `Classified ${result.successCount}/${result.totalFound} conversations${result.errorCount > 0 ? ` (${result.errorCount} failed)` : ''}`,
  )
})
