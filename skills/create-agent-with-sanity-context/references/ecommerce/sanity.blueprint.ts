import {defineBlueprint, defineScheduledFunction} from '@sanity/blueprints'
import 'dotenv/config'

export default defineBlueprint({
  resources: [
    defineScheduledFunction({
      name: 'classify-conversations',
      timeout: 600,
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        SANITY_ORGANIZATION_ID: process.env.SANITY_ORGANIZATION_ID,
        SANITY_CONTEXT_ENDPOINT_NAME: process.env.SANITY_CONTEXT_ENDPOINT_NAME,
        SANITY_API_TOKEN: process.env.SANITY_API_TOKEN,
      },
      event: {
        expression: '*/10 * * * *',
      },
    }),
  ],
})
