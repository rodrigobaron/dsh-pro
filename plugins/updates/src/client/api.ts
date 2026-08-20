/**
 * The browser half's view of the update host, over /api/updates/*.
 *
 * The host is authoritative: it decides what is installed, what is available,
 * and whether an update is worth offering. Nothing is compared here.
 */
import { API_PREFIX, type UpdateResponse, type UpdateResult, type UpdateState } from '../contract.ts'

/** A refusal, carrying whatever the host said about it. */
export class UpdateRequestError extends Error {
  /** Explicit, not a parameter property: Node's strip-only mode rejects those. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'UpdateRequestError'
    this.code = code
  }
}

/** Issue one request and unwrap it. */
async function call<T>(path: string, method: 'GET' | 'POST'): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers: { accept: 'application/json' },
  })
  let body: UpdateResponse<T> | undefined
  try {
    body = await response.json() as UpdateResponse<T>
  } catch {
    body = undefined
  }
  if (body === undefined) {
    throw new UpdateRequestError('bad-response', `the host answered ${response.status} with no JSON body`)
  }
  // The host explains refusals — an expired token, a checksum mismatch, a
  // release that is not newer. Flattening those to "something went wrong"
  // would throw away the only thing that tells you what to do next.
  if (!body.ok) throw new UpdateRequestError(body.error.code, body.error.message)
  return body.value
}

/** Read the current state without contacting GitHub unless it must. */
export const readState = (): Promise<UpdateState> => call<UpdateState>('/state', 'GET')

/** Re-read the release feed. */
export const checkNow = (): Promise<UpdateState> => call<UpdateState>('/check', 'POST')

/** Download, verify, and swap in the newest release. */
export const applyUpdate = (): Promise<UpdateResult> => call<UpdateResult>('/apply', 'POST')
