/**
 * @my-dsh/git-review — host half.
 *
 * Serves the `/git/*` JSON API the review tab calls. Two protections apply to
 * every request, because this endpoint can WRITE to a repository:
 *
 *   Containment — the requested directory must resolve inside a registered
 *   workspace or the process cwd, and must be a git work tree. Resolution
 *   goes through `ctx.fs`, so symlink escapes are caught by the backend's
 *   canonicalization rather than by prefix matching here.
 *
 *   Same-origin — mutating routes require a custom header and a matching
 *   Origin. A browser cannot set a custom header on a cross-origin request
 *   without a preflight, and the preflight is refused, so a page on another
 *   origin cannot reach these routes even though the server listens on
 *   loopback. Without this, any site the user visited could commit or push.
 */

import type { Context } from '@deepseek-ai/cordis'
import { GitError, diff, git, status } from './git'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const name = 'git-review'

/** `workspaceRegistry` is what makes every open workspace reviewable. */
export const inject = ['webServer', 'fs', 'workspaceRegistry']

const ROUTE_PREFIX = '/git'

/** Required on mutating requests; a cross-origin page cannot set it. */
const CSRF_HEADER = 'x-git-review'

/** Cap on a single diff response, so one enormous file cannot exhaust memory. */
const MAX_DIFF_BYTES = 4 * 1024 * 1024

class RequestError extends Error {
  constructor(readonly httpStatus: number, message: string) {
    super(message)
  }
}

// ── containment ─────────────────────────────────────────────────────────────

interface FsLike {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>
  contains(parent: unknown, child: unknown): boolean
  processPath(target: unknown): string
  stat(target: unknown): Promise<{ type: string } | undefined>
}

function rootPaths(ctx: Context): string[] {
  const paths: string[] = []
  try {
    const registry = (ctx as unknown as { workspaceRegistry?: { list?: () => { path?: string }[] } }).workspaceRegistry
    for (const ws of registry?.list?.() ?? []) if (ws?.path) paths.push(ws.path)
  } catch {
    // A composition without the registry still has the cwd root below.
  }
  paths.push(process.cwd())
  return [...new Set(paths)]
}

/**
 * Resolve a caller-supplied directory and prove it sits inside an allowed
 * root. Returns the canonical path git should run in.
 */
async function resolveRepoDir(ctx: Context, dir: string): Promise<string> {
  const fs = (ctx as unknown as { fs: FsLike }).fs
  let target: unknown
  try {
    target = await fs.resolve(dir, { cwd: process.cwd() })
  } catch {
    throw new RequestError(404, 'directory not found')
  }

  let contained = false
  for (const root of rootPaths(ctx)) {
    try {
      if (fs.contains(await fs.resolve(root), target)) {
        contained = true
        break
      }
    } catch {
      // A configured workspace whose directory is gone grants nothing.
    }
  }
  if (!contained) throw new RequestError(403, 'directory is outside the workspace')

  const info = await fs.stat(target).catch(() => undefined)
  if (info === undefined || info.type !== 'directory') throw new RequestError(404, 'not a directory')

  const path = fs.processPath(target)
  // Reject a non-repository up front, so every later failure is a real git
  // error rather than "not a git repository" wearing a different hat.
  try {
    const inside = (await git(path, ['rev-parse', '--is-inside-work-tree'])).trim()
    if (inside !== 'true') throw new RequestError(400, 'not a git work tree')
  } catch (error) {
    if (error instanceof RequestError) throw error
    throw new RequestError(400, 'not a git repository')
  }
  return path
}

/**
 * Reject a path argument that git would read as an option.
 *
 * Every path reaches git after a `--` separator, so this is belt-and-braces —
 * but a caller that forgets the separator in a future route would otherwise
 * turn a filename into a flag.
 */
function assertPathArg(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new RequestError(400, `${field} is required`)
  if (value.startsWith('-')) throw new RequestError(400, `${field} may not begin with '-'`)
  if (value.includes('\0')) throw new RequestError(400, `${field} contains a NUL byte`)
  return value
}

function assertPathList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new RequestError(400, `${field} must be a non-empty array`)
  if (value.length > 1000) throw new RequestError(400, `${field} has too many entries`)
  return value.map((entry, i) => assertPathArg(entry, `${field}[${i}]`))
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store',
  }
}

function sendJson(res: ServerResponse, httpStatus: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(httpStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.byteLength),
    ...securityHeaders(),
  })
  res.end(payload)
}

const MAX_BODY_BYTES = 1024 * 1024

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new RequestError(413, 'request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return reject(new RequestError(400, 'body must be a JSON object'))
        }
        resolve(parsed as Record<string, unknown>)
      } catch {
        reject(new RequestError(400, 'body is not valid JSON'))
      }
    })
    req.on('error', () => reject(new RequestError(400, 'request failed')))
  })
}

/**
 * Refuse a mutating request that a cross-origin page could have forged.
 *
 * The custom header is the actual defence: setting it forces a preflight,
 * which this server never answers. The Origin check is the belt to that
 * braces — a same-origin fetch either omits Origin or sends the server's own.
 */
function assertSameOrigin(req: IncomingMessage): void {
  if (req.headers[CSRF_HEADER] === undefined) {
    throw new RequestError(403, `missing ${CSRF_HEADER} header`)
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = req.headers.host
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      throw new RequestError(403, 'bad Origin')
    }
    if (host === undefined || originHost !== host) throw new RequestError(403, 'cross-origin request refused')
  }
}

// ── routes ──────────────────────────────────────────────────────────────────

async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '', 'http://localhost')
  const route = url.pathname.slice(ROUTE_PREFIX.length)
  const method = req.method ?? 'GET'

  if (method === 'GET') {
    if (route === '/roots') {
      return sendJson(res, 200, { roots: rootPaths(ctx) })
    }
    const dir = await resolveRepoDir(ctx, assertPathArg(url.searchParams.get('dir'), 'dir'))
    if (route === '/status') {
      return sendJson(res, 200, await status(dir))
    }
    if (route === '/diff') {
      const path = assertPathArg(url.searchParams.get('path'), 'path')
      const text = await diff(dir, path, url.searchParams.get('staged') === '1', url.searchParams.get('untracked') === '1')
      const truncated = text.length > MAX_DIFF_BYTES
      return sendJson(res, 200, { diff: truncated ? text.slice(0, MAX_DIFF_BYTES) : text, truncated })
    }
    throw new RequestError(404, 'unknown route')
  }

  if (method !== 'POST') throw new RequestError(405, 'method not allowed')

  assertSameOrigin(req)
  const body = await readJsonBody(req)
  const dir = await resolveRepoDir(ctx, assertPathArg(body.dir, 'dir'))

  switch (route) {
    case '/stage': {
      const paths = assertPathList(body.paths, 'paths')
      // `add` covers a new file, a modification, and a deletion alike.
      await git(dir, ['add', '--', ...paths])
      return sendJson(res, 200, await status(dir))
    }
    case '/unstage': {
      const paths = assertPathList(body.paths, 'paths')
      // `restore --staged` fails on a repo with no commits (there is no HEAD
      // to restore from); `rm --cached` is the equivalent there.
      try {
        await git(dir, ['restore', '--staged', '--', ...paths])
      } catch (error) {
        if (!(error instanceof GitError)) throw error
        await git(dir, ['rm', '--cached', '-r', '--', ...paths])
      }
      return sendJson(res, 200, await status(dir))
    }
    case '/discard': {
      // Destructive and irreversible — uncommitted work is not recoverable
      // afterwards. The client confirms before calling; the server still
      // requires each path explicitly and never accepts a "discard all" flag.
      const paths = assertPathList(body.paths, 'paths')
      const untracked = body.untracked === true
      if (untracked) {
        await git(dir, ['clean', '-fd', '--', ...paths])
      } else {
        await git(dir, ['restore', '--worktree', '--', ...paths])
      }
      return sendJson(res, 200, await status(dir))
    }
    case '/commit': {
      const message = body.message
      if (typeof message !== 'string' || message.trim() === '') {
        throw new RequestError(400, 'message is required')
      }
      const args = ['commit', '--message', message]
      if (body.amend === true) args.push('--amend')
      const output = await git(dir, args)
      return sendJson(res, 200, { output, status: await status(dir) })
    }
    case '/push': {
      const args = ['push']
      if (body.setUpstream === true) {
        const current = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
        args.push('--set-upstream', 'origin', current)
      }
      const output = await git(dir, args, 120_000)
      return sendJson(res, 200, { output, status: await status(dir) })
    }
    default:
      throw new RequestError(404, 'unknown route')
  }
}

export function apply(ctx: Context): void {
  ctx.effect(
    () =>
      (ctx as unknown as {
        webServer: { register(route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }): () => void }
      }).webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
          handle(ctx, req, res).catch((error: unknown) => {
            if (res.headersSent) return void res.end()
            if (error instanceof RequestError) return sendJson(res, error.httpStatus, { error: error.message })
            if (error instanceof GitError) {
              // Git's own stderr is the most useful thing the UI can show, and
              // it is the user's own repository — there is nothing to redact.
              return sendJson(res, 422, { error: error.message, git: true })
            }
            sendJson(res, 500, { error: 'git command failed' })
          })
        },
      }),
    'git-review: /git routes',
  )
}
