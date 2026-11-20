import sanityContext from '@sanity/context-eve'

export default sanityContext({
  url: process.env.SANITY_CONTEXT_MCP_URL!,
  token: process.env.SANITY_CONTEXT_TOKEN!,
  description:
    process.env.SANITY_CONTEXT_DESCRIPTION ?? "The shop's product catalog and returns policy.",
})
