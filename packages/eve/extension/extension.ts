import {defineExtension} from 'eve/extension'
import {z} from 'zod'

export default defineExtension({
  config: z.object({
    /** The Context MCP endpoint URL. */
    url: z.url(),
    /** An organization API token with Context access. */
    token: z.string().min(1),
    /**
     * Inline the initial context into the instructions and hide the `initial_context` tool. Set to
     * `false` to keep the tool instead; the agent then loads the initial context itself by calling it.
     */
    inlineInitialContext: z.boolean().default(true),
  }),
})
