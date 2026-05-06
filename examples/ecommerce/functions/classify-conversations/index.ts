import {createClient} from '@sanity/client'
import {classifyConversations} from '@sanity/agent-context/insights'
import {scheduledEventHandler} from '@sanity/functions'
import {anthropic} from '@ai-sdk/anthropic'
import {env} from 'node:process'

export const handler = scheduledEventHandler(async ({context}) => {
  const {SANITY_PROJECT_ID, SANITY_DATASET} = env

  if (!context.clientOptions?.token) {
    console.error('[classify-conversations] No client token available')
    return
  }

  const client = createClient({
    projectId: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
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
