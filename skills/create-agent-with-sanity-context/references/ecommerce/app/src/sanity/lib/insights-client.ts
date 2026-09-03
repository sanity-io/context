import {createClient} from '@sanity/client'

/**
 * Org-scoped client for conversation telemetry. Server-side only: the token
 * must never reach the browser.
 */
export const insightsClient = createClient({
  apiVersion: 'v2025-11-27',
  token: process.env.SANITY_API_TOKEN,
  context: {organizationId: process.env.SANITY_ORGANIZATION_ID},
  useCdn: false,
  useProjectHostname: false,
  ...(process.env.NEXT_PUBLIC_SANITY_API_HOST && {
    apiHost: process.env.NEXT_PUBLIC_SANITY_API_HOST,
  }),
})
