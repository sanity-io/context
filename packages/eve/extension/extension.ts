import {defineExtension} from 'eve/extension'
import {z} from 'zod'

export default defineExtension({
  config: z.object({
    /** The Context MCP endpoint URL. */
    url: z.string().url(),
    /** An organization API token with Context access. */
    token: z.string().min(1),
  }),
})
