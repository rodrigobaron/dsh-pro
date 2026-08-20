/**
 * The rewind itself: a surface replacement.
 *
 * The session log is append-only, and the model-visible history is a *surface*
 * projected on top of it. A surface event may enter as `'append'` or as
 * `{ op: 'replace', start, end }`, which substitutes one node for the range
 * `start..end` inclusive. Compaction uses exactly this to swap a stretch of
 * history for a summary; the type docs say plainly that "any surface-replacing
 * producer may use it".
 *
 * So rewinding is: replace [boundary .. last surface node] with a single
 * marker. The log keeps every original event — nothing is deleted, nothing on
 * disk is touched — but `session.deriveMessages()` stops projecting them, so
 * the model no longer sees them.
 *
 * The one thing the op cannot do is empty a range: a replacement always leaves
 * exactly one node behind. That node is the marker below.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** The source tag the marker carries, so consumers can recognize it. */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'rewind': { kind: 'rewind'; boundary: number; shadowed: number }
  }
}

/** Enough of a live session for the rewind append. */
export interface RewindSession {
  readonly surface: { readonly nodes: readonly number[] }
  append(type: 'user/message', data: unknown, intent: {
    surfaceOp: { op: 'replace'; start: number; end: number }
    sourceEventSeqs: number[]
  }): { seq: number }
}

/** Why a rewind could not be planned. */
export type RewindRefusal = 'not-on-surface' | 'nothing-after'

/** A validated rewind, ready to append. */
export interface RewindPlan {
  readonly start: number
  readonly end: number
  readonly shadowed: readonly number[]
}

/**
 * Work out which surface nodes a rewind to `boundary` would shadow.
 *
 * @param nodes - the current surface node seqs, in model-visible order.
 * @param boundary - the seq of the message to rewind to.
 * @returns the plan, or the reason it cannot be done.
 */
export function planRewind(nodes: readonly number[], boundary: number): RewindPlan | RewindRefusal {
  const index = nodes.indexOf(boundary)
  // Already shadowed by an earlier rewind, or never a surface event at all.
  if (index === -1) return 'not-on-surface'
  const shadowed = nodes.slice(index)
  const end = shadowed[shadowed.length - 1]
  if (end === undefined) return 'nothing-after'
  return { start: boundary, end, shadowed }
}

/**
 * The marker text left in place of the rewound range.
 *
 * The model reads this, so it says what happened rather than pretending
 * nothing did: a silently shorter history invites the model to re-derive
 * conclusions it has no record of reaching.
 *
 * @param count - how many surface nodes were shadowed.
 * @returns the marker text.
 */
export function markerText(count: number): string {
  const messages = count === 1 ? '1 message' : `${count} messages`
  return `[The conversation was rewound here. ${messages} that followed have been removed from this history and are no longer available. Files on disk were not changed.]`
}

/**
 * Commit one rewind.
 *
 * @param session - the live session to rewind.
 * @param boundary - the seq of the message to rewind to.
 * @returns the appended marker's seq and the plan it committed.
 * @throws when the boundary is not a current surface node.
 */
export function commitRewind(session: RewindSession, boundary: number): { seq: number; shadowed: number } {
  const plan = planRewind(session.surface.nodes, boundary)
  if (plan === 'not-on-surface') {
    throw new Error('that message is not part of the current conversation history (it may already have been rewound)')
  }
  if (plan === 'nothing-after') throw new Error('there is nothing to rewind')
  const marker = createUserMessage({
    content: [{ type: 'text', text: markerText(plan.shadowed.length) }],
    source: { kind: 'rewind', boundary, shadowed: plan.shadowed.length },
  })
  const logged = session.append('user/message', marker, {
    surfaceOp: { op: 'replace', start: plan.start, end: plan.end },
    // Every shadowed node must be cited; the surface validator rejects a
    // replacement whose coverage is incomplete.
    sourceEventSeqs: [...plan.shadowed],
  })
  return { seq: logged.seq, shadowed: plan.shadowed.length }
}
