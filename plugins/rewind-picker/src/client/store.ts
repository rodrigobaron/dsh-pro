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

// ---- deferred token consumption ------------------------------------------
// The `/rewind` token stays in the composer while the dialog is open and is
// consumed when it closes. Each open path records the guard the input shell
// understands — a span CAS for a menu pick, bare-token equality for Enter —
// and the close path dispatches the scoped `slash/input-consume-token` event.
// A stale guard (the user typed meanwhile) fails soft inside the shell and
// leaves the draft alone.
//
// Without this the command left `/rewind` sitting in the composer, so the
// rewound message had nowhere to land.

export type ConsumeGuard =
  | { kind: 'span'; span: unknown }
  | { kind: 'bare-token'; token: string }

const pendingConsume = new Map<string, ConsumeGuard>()

/** Remember how to remove the command token for this session. */
export function setPendingConsume(sessionId: string, guard: ConsumeGuard): void {
  pendingConsume.set(sessionId, guard)
}

/** Take the pending guard, if any; it is single-use. */
export function takePendingConsume(sessionId: string): ConsumeGuard | undefined {
  const guard = pendingConsume.get(sessionId)
  if (guard !== undefined) pendingConsume.delete(sessionId)
  return guard
}
