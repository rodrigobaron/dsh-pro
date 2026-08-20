/**
 * Talking to @my-dsh/rewind's host route, and putting the rewound text back
 * in the composer.
 *
 * Both halves of the feature POST the same `/rewind` route; this package owns
 * no host code of its own.
 */
import type { ClientCtx, ConversationNode, RewindResponse } from './services.ts'

/** The plain text of one user node, flattened from its content blocks. */
export function nodeText(node: ConversationNode): string {
  const blocks = node.content ?? []
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text.trim()
}

/**
 * The user messages in the window, oldest first, each with its rewind boundary.
 *
 * The user node's `seq` IS the boundary the host expects — it removes that
 * event and every later one — so no turn lookup is needed.
 *
 * @param nodes - the conversation snapshot's nodes.
 * @returns one entry per user message that carries a usable boundary.
 */
export function rewindPoints(nodes: readonly ConversationNode[] | undefined): { seq: number; text: string; time?: number }[] {
  const points: { seq: number; text: string; time?: number }[] = []
  for (const node of nodes ?? []) {
    if (node.kind !== 'user') continue
    const seq = node.seq
    if (typeof seq !== 'number') continue
    points.push({ seq, text: nodeText(node), time: node.time })
  }
  return points
}

/**
 * The durable ids of user messages already rewound in this session.
 *
 * Asked on mount so a page reload does not resurrect hidden messages.
 *
 * @param sessionId - the session to query.
 * @returns the rewound message ids, or an empty list when the query fails.
 */
/**
 * POST one rewind request.
 *
 * Settles to the host envelope rather than throwing, so a transport failure
 * and a refusal are handled the same way by the caller.
 *
 * @param sessionId - the session to rewind.
 * @param boundary - the seq of the user message to rewind to.
 * @returns the host envelope, or a synthesized transport error.
 */
export async function requestRewindState(sessionId: string): Promise<readonly string[]> {
  const body = await postRewind({ sessionId, query: true })
  return body.ok === true ? (body.value as { rewound?: readonly string[] } | undefined)?.rewound ?? [] : []
}

/** POST one request to the rewind route, settling to its envelope. */
async function postRewind(payload: Record<string, unknown>): Promise<RewindResponse> {
  try {
    const response = await fetch('/rewind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body: unknown = await response.json().catch(() => null)
    if (body === null || typeof body !== 'object') {
      return { ok: false, error: { code: 'transport', message: `HTTP ${response.status}` } }
    }
    return body as RewindResponse
  } catch (error) {
    return { ok: false, error: { code: 'transport', message: error instanceof Error ? error.message : String(error) } }
  }
}

export async function requestRewind(sessionId: string, boundary: number): Promise<RewindResponse> {
  return postRewind({ sessionId, boundary })
}

/**
 * Write the rewound message's text back into the composer draft.
 *
 * The other half of a rewind: you get the message back to edit and resend.
 * Resolved lazily through the client root ctx, and a no-op rather than a crash
 * when the services are not there.
 *
 * @param ctx - the client root context.
 * @param sessionId - the session whose composer receives the text.
 * @param text - the rewound message's plain text; empty writes nothing.
 * @returns whether the draft write was attempted.
 */
export function restoreDraft(ctx: ClientCtx, sessionId: string, text: string): boolean {
  if (text === '') return false
  try {
    const scope = ctx.sessions?.scope
    if (typeof scope !== 'function') return false
    const actx = scope.call(ctx.sessions, sessionId)
    if (actx === undefined) return false
    const conversation = ctx.get('conversation') as { input?: { for?(scope: unknown): { setDraft?(text: string): void } } } | undefined
    const facade = conversation?.input?.for?.(actx)
    if (typeof facade?.setDraft !== 'function') return false
    facade.setDraft(text)
    return true
  } catch (error) {
    console.warn('[rewind-picker] draft restore failed:', error)
    return false
  }
}
