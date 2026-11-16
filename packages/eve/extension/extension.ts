import {defineExtension} from 'eve/extension'
import {z} from 'zod'

export default defineExtension({
  config: z.object({
    /** The Context MCP endpoint URL. */
    url: z.url({protocol: /^https$/, error: 'Sanity Context needs an https URL.'}),
    /** An organization API token with Context access. */
    token: z
      .string()
      .min(1, 'Sanity Context needs a token: an organization API token with Context access.'),
    /**
     * What the endpoint's content covers, such as "Acme's product catalog and support articles". The
     * model reads it to decide when to look here.
     */
    description: z
      .string()
      .trim()
      .min(1, "Sanity Context needs a description: what the endpoint's content covers."),
  }),
})
