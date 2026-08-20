/**
 * The /api/updates route family.
 *
 * Same loopback-and-same-origin fence the other write-capable plugins here use.
 * It matters more than usual on this one: these routes replace the code the
 * harness loads at boot, so a cross-origin page reaching them would be remote
 * code execution rather than an annoyance.
 *
 *   GET  /api/updates/state  → what is installed, what is available
 *   POST /api/updates/check  → re-read the release feed
 *   POST /api/updates/apply  → download, verify, and swap in a release
 *
 * @module @dsh-pro/updates/routes
 */
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  HostRoute, NodeIncomingMessage, NodeServerResponse,
} from './contracts.ts'
import { API_PREFIX, type UpdateResponse, type UpdateState } from '../contract.ts'
import type { Release } from '../core/release.ts'
import { isNewer } from '../core/version.ts'
import { ReleaseCheckError, downloadRelease, latestRelease, type GitHubOptions } from './github.ts'
import { InstallError, applyRelease, isWritable, readMarker, type InstallTarget } from './install.ts'

/** Loopback literal check plus browser same-origin markers (dsh-ssh fence). */
function isLoopbackRequest(request: NodeIncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const originHeader = request.headers.origin
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: NodeServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

/** Send a structured failure. */
function fail(res: NodeServerResponse, status: number, code: string, message: string): void {
  const body: UpdateResponse<never> = { ok: false, error: { code, message } }
  writeJson(res, status, body)
}

/** What the routes need from the plugin. */
export interface RouteDeps {
  readonly target: InstallTarget
  readonly github: () => GitHubOptions
  /** Injected for tests. */
  readonly now?: () => Date
}

/** Cached feed state, so rendering the section does not hit GitHub every time. */
interface FeedCache {
  release: Release | undefined
  checkedAt: string | null
  error: string | undefined
  reason: UpdateState['reason']
}

/**
 * Build the route family.
 * @param deps - profile target and GitHub options.
 * @returns the routes to register on the webserver.
 */
export function makeRoutes(deps: RouteDeps): HostRoute[] {
  const now = deps.now ?? (() => new Date())
  const cache: FeedCache = { release: undefined, checkedAt: null, error: undefined, reason: undefined }
  let pendingRestart: UpdateState['pendingRestart'] = null
  let applying = false

  /** Read the feed and remember the outcome. */
  const refresh = async (): Promise<void> => {
    try {
      cache.release = await latestRelease(deps.github())
      cache.checkedAt = now().toISOString()
      cache.error = undefined
      cache.reason = cache.release === undefined ? 'no-releases' : undefined
    } catch (error) {
      cache.release = undefined
      cache.error = error instanceof Error ? error.message : String(error)
      cache.reason = error instanceof ReleaseCheckError
        && (error.code === 'authentication-required' || error.code === 'no-releases' || error.code === 'repository-unreachable')
        ? error.code
        : 'repository-unreachable'
    }
  }

  /** Assemble the state the settings section renders. */
  const state = async (): Promise<UpdateState> => {
    const installed = await readMarker(deps.target.profileModules)
    const options = deps.github()
    const writable = await isWritable(deps.target.profileModules)
    const supported = writable && cache.reason === undefined && cache.release !== undefined
    const reason: UpdateState['reason'] = !writable
      ? 'profile-read-only'
      : cache.reason
    return {
      installed,
      latest: cache.release === undefined ? null : {
        tag: cache.release.tag,
        version: cache.release.version,
        notes: cache.release.notes,
        publishedAt: cache.release.publishedAt,
        sizeBytes: cache.release.asset.size,
        prerelease: cache.release.prerelease,
      },
      updateAvailable: cache.release !== undefined && isNewer(installed?.version, cache.release.version),
      checkedAt: cache.checkedAt,
      supported,
      ...reason === undefined ? {} : { reason },
      repository: options.repository,
      authenticated: options.token !== undefined && options.token !== '',
      pendingRestart,
      ...cache.error === undefined ? {} : { lastError: cache.error },
    }
  }

  const stateRoute: HostRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return fail(res, 403, 'forbidden', 'loopback-only')
      if ((req.method ?? 'GET') !== 'GET') return fail(res, 405, 'method-not-allowed', 'GET only')
      // First read of the session populates the cache, so the section shows
      // something real without the user pressing Check.
      if (cache.checkedAt === null && cache.error === undefined) await refresh()
      const body: UpdateResponse<UpdateState> = { ok: true, value: await state() }
      writeJson(res, 200, body)
    },
  }

  const checkRoute: HostRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/check`,
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return fail(res, 403, 'forbidden', 'loopback-only')
      if ((req.method ?? 'GET') !== 'POST') return fail(res, 405, 'method-not-allowed', 'POST only')
      await refresh()
      const body: UpdateResponse<UpdateState> = { ok: true, value: await state() }
      writeJson(res, 200, body)
    },
  }

  const applyRoute: HostRoute = {
    kind: 'exact',
    path: `${API_PREFIX}/apply`,
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return fail(res, 403, 'forbidden', 'loopback-only')
      if ((req.method ?? 'GET') !== 'POST') return fail(res, 405, 'method-not-allowed', 'POST only')
      // Two concurrent swaps would race over the same scope directory, and the
      // loser would restore a backup on top of the winner's install.
      if (applying) return fail(res, 409, 'busy', 'an update is already being applied')
      if (cache.release === undefined) await refresh()
      const release = cache.release
      if (release === undefined) {
        return fail(res, 409, cache.reason ?? 'no-releases', cache.error ?? 'no release is available to install')
      }
      const installed = await readMarker(deps.target.profileModules)
      if (!isNewer(installed?.version, release.version)) {
        return fail(res, 409, 'up-to-date', `${release.version} is not newer than the installed version`)
      }

      applying = true
      const stamp = now().toISOString().replace(/[:.]/g, '-')
      const downloadDir = join(deps.target.workRoot, 'download')
      const tarball = join(downloadDir, release.asset.name)
      try {
        await mkdir(downloadDir, { recursive: true })
        await downloadRelease(release, tarball, deps.github())
        const applied = await applyRelease(tarball, release.version, deps.target, stamp)
        pendingRestart = {
          fromVersion: installed?.version ?? 'unknown',
          toVersion: release.version,
        }
        writeJson(res, 200, {
          ok: true,
          value: {
            fromVersion: pendingRestart.fromVersion,
            toVersion: pendingRestart.toVersion,
            backupPath: applied.backupDir,
            restartRequired: true,
          },
        })
      } catch (error) {
        const code = error instanceof ReleaseCheckError || error instanceof InstallError
          ? error.code
          : 'update-failed'
        fail(res, 500, code, error instanceof Error ? error.message : String(error))
      } finally {
        applying = false
        await rm(tarball, { force: true }).catch(() => {})
      }
    },
  }

  return [stateRoute, checkRoute, applyRoute]
}
