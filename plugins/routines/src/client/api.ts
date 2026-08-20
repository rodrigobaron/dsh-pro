/**
 * The browser half's view of the host engine, over /api/routines/*.
 *
 * The host is authoritative: it owns the ledger, computes next-run times, and
 * fires. Nothing is scheduled here — this only reads and edits.
 */

/** One routine as the host reports it. */
export interface Routine {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly prompt: string
  readonly status: 'idle' | 'running' | string
  readonly target?: { readonly workdir?: string; readonly sessionId?: string }
  readonly schedule?: { readonly enabled?: boolean; readonly cron?: string; readonly nextRunAt?: number }
  readonly executions?: readonly { readonly startedAt?: number; readonly ok?: boolean; readonly error?: string }[]
}

/** Fields a create or update accepts. */
export interface RoutineDraft {
  title: string
  prompt: string
  cron: string
  workdir?: string
}

const BASE = '/api/routines'

/** A failed request, carrying whatever the host said about it. */
export class RoutineError extends Error {}

/**
 * Issue one request and unwrap it, throwing RoutineError on a refusal.
 *
 * The host answers 400 with a reason for bad input (an unparseable cron, for
 * instance), which is worth surfacing verbatim rather than flattening to
 * "something went wrong".
 */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(BASE + path, init)
  } catch (error) {
    throw new RoutineError(error instanceof Error ? error.message : String(error))
  }
  const text = await response.text()
  let body: unknown = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = null
  }
  if (!response.ok) {
    const message = (body as { error?: string; message?: string } | null)?.error
      ?? (body as { message?: string } | null)?.message
      ?? `HTTP ${response.status}`
    throw new RoutineError(message)
  }
  return body as T
}

const JSON_POST = (payload: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

/** Every routine in the ledger. */
export async function listRoutines(): Promise<readonly Routine[]> {
  return (await call<{ jobs?: readonly Routine[] }>('/jobs')).jobs ?? []
}

/** Create one routine. */
export async function createRoutine(draft: RoutineDraft): Promise<void> {
  await call('/jobs', JSON_POST(draft))
}

/** Patch one routine's fields. */
export async function updateRoutine(id: string, patch: Record<string, unknown>): Promise<void> {
  await call(`/jobs?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** Remove one routine. */
export async function removeRoutine(id: string): Promise<void> {
  await call(`/jobs?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Fire one routine now, in the background. */
export async function runRoutine(id: string): Promise<void> {
  await call(`/jobs/run?id=${encodeURIComponent(id)}`, { method: 'POST' })
}

/** The workspaces a routine may target. */
export async function listWorkspaces(): Promise<readonly { id: string; path: string }[]> {
  try {
    return (await call<{ workspaces?: readonly { id: string; path: string }[] }>('/workspaces')).workspaces ?? []
  } catch {
    // A missing workspace registry is not worth failing the whole panel for;
    // the workdir field just falls back to free text.
    return []
  }
}
