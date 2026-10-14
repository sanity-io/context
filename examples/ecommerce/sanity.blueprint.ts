import {defineBlueprint, defineScheduledFunction} from '@sanity/blueprints'
import 'dotenv/config'

// Read from .env at deploy time (dotenv/config reads .env, not .env.local). Unset values are
// skipped, so ANTHROPIC_API_KEY can instead be set after deploy with `sanity functions env add`.
const env: Record<string, string> = {}
for (const name of [
  'ANTHROPIC_API_KEY',
  'SANITY_ORGANIZATION_ID',
  'SANITY_CONTEXT_ENDPOINT_NAME',
  'SANITY_ORGANIZATION_TOKEN',
]) {
  const value = process.env[name]
  if (value) env[name] = value
}

export default defineBlueprint({
  resources: [
    defineScheduledFunction({
      name: 'classify-conversations',
      timeout: 600,
      env,
      event: {
        expression: '*/10 * * * *',
      },
    }),
  ],
})
