/**
 * Client half of the /git API.
 *
 * Every mutating call carries the CSRF header the host requires; a page on
 * another origin cannot set it, which is what keeps these write routes from
 * being reachable by anything but this tab.
 */

import type { GitStatus } from './types'

const BASE = '/git'
const CSRF_HEADER = 'X-Git-Review'

/** A non-2xx reply, carrying the host's message so the UI can show it. */
export class ApiError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly fromGit: boolean) {
    super(message)
    this.name = 'ApiError'
  }
}

async function unwrap(response: Response): Promise<any> {
  const text = await response.text()
  let body: any = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = null
  }
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${response.status})`
    throw new ApiError(message, response.status, body?.git === true)
  }
  return body
}

async function post(route: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER]: '1' },
    body: JSON.stringify(body),
  })
  return unwrap(response)
}

export async function fetchRoots(): Promise<string[]> {
  const body = await unwrap(await fetch(`${BASE}/roots`))
  return Array.isArray(body?.roots) ? body.roots : []
}

export async function fetchStatus(dir: string): Promise<GitStatus> {
  return unwrap(await fetch(`${BASE}/status?dir=${encodeURIComponent(dir)}`))
}

export async function fetchDiff(
  dir: string,
  path: string,
  staged: boolean,
  untracked: boolean,
): Promise<{ diff: string; truncated: boolean }> {
  const query = new URLSearchParams({ dir, path, staged: staged ? '1' : '0', untracked: untracked ? '1' : '0' })
  return unwrap(await fetch(`${BASE}/diff?${query.toString()}`))
}

export function stage(dir: string, paths: string[]): Promise<GitStatus> {
  return post('/stage', { dir, paths })
}

export function unstage(dir: string, paths: string[]): Promise<GitStatus> {
  return post('/unstage', { dir, paths })
}

export function discard(dir: string, paths: string[], untracked: boolean): Promise<GitStatus> {
  return post('/discard', { dir, paths, untracked })
}

export function commit(dir: string, message: string, amend: boolean): Promise<{ output: string; status: GitStatus }> {
  return post('/commit', { dir, message, amend })
}

export function push(dir: string, setUpstream: boolean): Promise<{ output: string; status: GitStatus }> {
  return post('/push', { dir, setUpstream })
}
