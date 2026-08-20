/**
 * The harness surface this plugin touches, described structurally rather than
 * imported — the same decoupling git-review uses. These shapes are small and
 * stable, and stating them keeps the plugin buildable without the harness's
 * own type packages resolving.
 */

/**
 * One node in the conversation window. `user` nodes carry the rewind boundary.
 *
 * The fields are FLAT on the node. The `conversation.chat.node` slot hands its
 * renderer a `{ node: { data } }` wrapper, which is a different shape and an
 * easy thing to assume applies here too; the snapshot's own nodes do not have
 * that wrapper.
 */
export interface ConversationNode {
  readonly kind?: string
  readonly seq?: number
  readonly time?: number
  readonly content?: readonly { readonly type?: string; readonly text?: string }[]
}

/** The slice of the conversation snapshot the picker reads. */
export interface ConversationSnapshotLike {
  readonly nodes?: readonly ConversationNode[]
  readonly running?: boolean
}

export type UseSessionLike = <T>(select: (snapshot: ConversationSnapshotLike) => T) => T

/** Props a session-scoped slot entry receives. */
export interface SessionStandardProps {
  sessionId?: string
  useSession?: UseSessionLike
}

/** A per-session boolean store — the shape the slot `hooks` compartment binds. */
export interface OpenStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): boolean
  set(open: boolean): void
}

/** One entry the `/` trigger menu offers. */
export interface TriggerCandidate {
  name: string
  description?: string
}

/** The `/` trigger seam, consumed opportunistically through ctx.get. */
export interface InputTriggersFace {
  registerSource(source: {
    trigger: string
    name: string
    order?: number
    candidates(session: { sessionId: string }, request: { position?: string; query: string }): Promise<readonly TriggerCandidate[]>
    onPick(pick: { session: { sessionId: string }; span?: unknown }): 'handled' | undefined
    matchEnter(session: { sessionId: string }, line: string): Promise<'handled' | undefined>
  }): () => void
}

/** Enough of the client root context for what this plugin does. */
export interface ClientCtx {
  effect(setup: () => unknown, label?: string): unknown
  get(key: string): unknown
  slots: {
    inject(name: string, setup: () => unknown): unknown
    register(options: Record<string, unknown>, component?: unknown): () => void
  }
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(namespace: string): (key: string, params?: Record<string, string | number>) => string
  }
  sessions?: { scope?(sessionId: string): unknown }
}

/** The host envelope POST /rewind settles to. */
export type RewindResponse =
  | { ok: true; value?: { boundary?: number; seq?: number } }
  | { ok: false; error?: { code?: string; message?: string } }
