/**
 * @my-dsh/rewind host half: POST /rewind.
 *
 * Rewinding removes a message — and everything after it — from the history the
 * MODEL sees. It never touches the filesystem, and it never deletes a log
 * event: the append-only log keeps everything, and the removal is a surface
 * replacement (see surface.ts).
 *
 * This is written rather than repackaged because upstream's host calls
 * `session.recall()`, which is core runtime support that no published
 * @deepseek-ai/dsh-session has ever shipped — rc.7 and rc.8 both lack it. The
 * surface-replacement route below needs nothing that is not already public,
 * and is the same mechanism compaction uses.
 *
 * Refusals carry explicit codes:
 *   session-not-found  the session is not attached
 *   subagent-owned     subagent routing owns it
 *   agent-busy         a turn is running; stop it first
 *   message-not-found  no message matches the request
 *   rewind-rejected    the surface refused the boundary
 *
 * Trust boundary: same as the other same-origin routes here — any same-origin
 * browser client can rewind a live session.
 */
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session'
import { hasApiRemoteSubagentOwner } from '@deepseek-ai/dsh-api-remotes'
import { commitRewind, type RewindSession } from './surface.ts'

// Re-exported so the rewind planning is testable without a live session: it is
// pure, and it is the part where an off-by-one silently shadows the wrong
// range.
export { commitRewind, markerText, planRewind } from './surface.ts'
export type { RewindPlan, RewindRefusal, RewindSession } from './surface.ts'

/** Cordis plugin name. */
export const name = 'rewind'

/** Services required before load. */
export const inject = ['webServer', 'sessions', 'agents']

interface JsonResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/** Write a JSON body with no-store caching. */
function sendJson(res: JsonResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/** The refusal envelope both browser halves understand. */
function errorBody(code: string, message: string, details?: Record<string, unknown>): unknown {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } }
}

/** Read a whole request body as text. */
async function readBody(req: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Resolve the request to a boundary seq.
 *
 * `boundary` is taken as given; `messageId` is looked up across append-origin
 * surface events, which is what the durable message ids belong to.
 *
 * @param session - the live session.
 * @param payload - the request body.
 * @returns the boundary seq, or null when nothing matches.
 */
function resolveBoundary(
  session: { readonly events: readonly { seq: number }[] },
  payload: { boundary?: unknown; messageId?: unknown },
): number | null {
  if (typeof payload.boundary === 'number' && Number.isInteger(payload.boundary)) return payload.boundary
  const messageId = payload.messageId
  if (typeof messageId !== 'string' || messageId === '') return null
  for (const event of session.events) {
    if (!isAppendSurfaceEvent(event as never)) continue
    const message = deriveEventMessage(event as never)
    if (message !== null && (message as { id?: string }).id === messageId) return event.seq
  }
  return null
}

/** Mount the /rewind route. */
export function apply(ctx: {
  webServer: { register(route: unknown): void }
  sessions: { flush(session: unknown): Promise<void> }
  agents: { get(id: string): { status?: string; session: unknown } | undefined }
}): void {
  const { webServer, sessions, agents } = ctx
  webServer.register({
    kind: 'prefix',
    path: '/rewind',
    handler: async (req: { method?: string } & AsyncIterable<Buffer | string>, res: JsonResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      let payload: { sessionId?: unknown; boundary?: unknown; messageId?: unknown }
      try {
        payload = JSON.parse((await readBody(req)) || '{}') as typeof payload
      } catch {
        sendJson(res, 400, errorBody('BAD_REQUEST', 'request body must be JSON'))
        return
      }
      const sessionId = typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : null
      if (sessionId === null) {
        sendJson(res, 400, errorBody('BAD_REQUEST', 'missing sessionId'))
        return
      }
      const agent = agents.get(sessionId)
      if (agent === undefined) {
        sendJson(res, 404, errorBody('session-not-found', `session "${sessionId}" not found (not attached)`))
        return
      }
      if (hasApiRemoteSubagentOwner(ctx as never, agent.session as never, agent as never)) {
        sendJson(res, 403, errorBody('subagent-owned', 'session is owned by subagent routing'))
        return
      }
      // A rewind mid-turn would race the surface the running step derives from,
      // and an attached session rejects reentrant appends anyway.
      if (agent.status === 'running') {
        sendJson(res, 409, errorBody('agent-busy', `session "${sessionId}" is running; stop the current turn before rewinding`, { sessionId }))
        return
      }
      const boundary = resolveBoundary(agent.session as never, payload)
      if (boundary === null) {
        sendJson(res, 404, errorBody('message-not-found', `session "${sessionId}" has no message matching the request`, { sessionId }))
        return
      }
      try {
        const result = commitRewind(agent.session as unknown as RewindSession, boundary)
        await sessions.flush(agent.session)
        sendJson(res, 200, { ok: true, value: { boundary, seq: result.seq, shadowed: result.shadowed } })
      } catch (error) {
        sendJson(res, 422, errorBody('rewind-rejected', error instanceof Error ? error.message : String(error), { sessionId, boundary }))
      }
    },
  })
}
