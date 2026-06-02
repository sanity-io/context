import type {Ref} from 'react'

export function useComposedRefs<T>(...refs: (Ref<T> | undefined)[]): (node: T | null) => void {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ;(ref as {current: T | null}).current = node
      }
    }
  }
}
