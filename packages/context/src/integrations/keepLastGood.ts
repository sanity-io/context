/**
 * Falls back to the last successful result when `get` rejects, with a warning. Rejects only if there
 * has never been a success.
 *
 * @internal
 */
export function keepLastGood<T>(what: string, get: () => Promise<T>): () => Promise<T> {
  let lastGood: {value: T} | undefined
  return async () => {
    try {
      const value = await get()
      lastGood = {value}
      return value
    } catch (error) {
      if (!lastGood) throw error
      console.warn(
        `[sanity-context] Could not refresh ${what}, using the previous ones: ${(error as Error).message}`,
      )
      return lastGood.value
    }
  }
}
