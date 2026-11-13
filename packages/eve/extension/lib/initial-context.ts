import {fetchInitialContext} from '@sanity/context'

import extension from '../extension'

class InitialContextUnavailable extends Error {}

type Memo = <T>(key: string, fn: () => Promise<T>) => Promise<T>

/** `null` when inlining is off. Otherwise fetched once per session. A failing memo saves nothing, so a failed fetch is retried on the next model call. */
export async function getInitialContext(ctx: {
  memo: Memo
  session: {id: string}
}): Promise<string | null> {
  if (!extension.config.inlineInitialContext) return null
  return ctx
    .memo(ctx.session.id, async () => {
      const text = await fetchInitialContext(extension.config)
      if (text === null) throw new InitialContextUnavailable()
      return text
    })
    .catch((error: unknown) => {
      if (error instanceof InitialContextUnavailable) return null
      throw error
    })
}
