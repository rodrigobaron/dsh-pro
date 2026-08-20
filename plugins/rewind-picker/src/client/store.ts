/**
 * Per-session open state for the picker overlay.
 *
 * Module-level so the state survives overlay remounts: the trigger source
 * opens it and the overlay component subscribes. Implements the
 * subscribe/getSnapshot pair the slot `hooks` compartment binds as a selector
 * hook, the same shape the /context modal uses.
 */
import type { OpenStore } from './services.ts'

const stores = new Map<string, OpenStore>()

/**
 * The open-state store for one session, created on first use.
 * @param sessionId - the session the overlay belongs to.
 * @returns that session's store.
 */
export function pickerStoreOf(sessionId: string): OpenStore {
  const existing = stores.get(sessionId)
  if (existing !== undefined) return existing
  let open = false
  const listeners = new Set<() => void>()
  const store: OpenStore = {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => open,
    set(next) {
      if (next === open) return
      open = next
      for (const listener of listeners) listener()
    },
  }
  stores.set(sessionId, store)
  return store
}
