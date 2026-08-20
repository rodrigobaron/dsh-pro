/**
 * Talking to the GitHub Releases API.
 *
 * The repository this reads may be private, which shapes everything here: the
 * asset download uses the API URL with `Accept: application/octet-stream`
 * rather than `browser_download_url`, because the latter answers a private repo
 * with a sign-in page — a 200 response containing HTML, which is exactly the
 * failure mode a naive downloader writes straight to disk and then tries to
 * untar.
 *
 * @module @dsh-pro/updates/github
 */
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { pickRelease, digestFor, type Release } from '../core/release.ts'

/** How long a check may take before it is abandoned. */
const CHECK_TIMEOUT_MS = 20_000

/** How long a download may take. */
const DOWNLOAD_TIMEOUT_MS = 300_000

/** Refuse to buffer a release larger than this. */
const MAX_ASSET_BYTES = 256 * 1024 * 1024

/** GitHub's API version pin, so a future default cannot reshape the payload. */
const API_VERSION = '2022-11-28'

/** A failure that the settings section can explain to a person. */
export class ReleaseCheckError extends Error {
  /** Explicit, not a parameter property: Node's strip-only mode rejects those. */
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ReleaseCheckError'
    this.code = code
  }
}

/** How to reach the repository. */
export interface GitHubOptions {
  /** `owner/repo`. */
  readonly repository: string
  /** A token with `contents: read`. Required for a private repository. */
  readonly token?: string
  /** Whether a prerelease may be offered. */
  readonly includePrereleases: boolean
  /** Injected for tests. */
  readonly fetchImpl?: typeof fetch
}

/** Headers common to every request. */
function headers(options: GitHubOptions, accept: string): Record<string, string> {
  const base: Record<string, string> = {
    accept,
    'x-github-api-version': API_VERSION,
    'user-agent': 'dsh-pro-updates',
  }
  if (options.token !== undefined && options.token !== '') {
    base.authorization = `Bearer ${options.token}`
  }
  return base
}

/** Translate a transport failure into a code the UI can act on. */
function checkFailure(status: number, repository: string, authenticated: boolean): ReleaseCheckError {
  if (status === 401 || status === 403) {
    return new ReleaseCheckError(
      'authentication-required',
      authenticated
        ? `GitHub rejected the configured token for ${repository} (${status}). It needs "contents: read" on that repository.`
        : `${repository} needs a GitHub token to read its releases (${status}).`,
    )
  }
  // A private repository answers 404 to an unauthenticated caller rather than
  // admitting it exists, so this is the same problem wearing a different code.
  if (status === 404) {
    return new ReleaseCheckError(
      authenticated ? 'no-releases' : 'authentication-required',
      authenticated
        ? `${repository} has no releases, or the token cannot see them.`
        : `${repository} was not found. A private repository answers 404 without a token.`,
    )
  }
  return new ReleaseCheckError('repository-unreachable', `GitHub answered ${status} for ${repository}.`)
}

/**
 * Find the newest release worth installing.
 * @param options - repository, token, and prerelease policy.
 * @returns the release, or undefined when the repository has published none.
 */
export async function latestRelease(options: GitHubOptions): Promise<Release | undefined> {
  const call = options.fetchImpl ?? fetch
  const authenticated = options.token !== undefined && options.token !== ''
  // The listing endpoint rather than /releases/latest: /latest excludes
  // prereleases entirely, so a repository that has only ever published
  // prereleases reports "no releases" through it.
  const url = `https://api.github.com/repos/${options.repository}/releases?per_page=20`
  let response: Response
  try {
    response = await call(url, {
      headers: headers(options, 'application/vnd.github+json'),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new ReleaseCheckError('repository-unreachable', `could not reach GitHub: ${String(cause)}`, { cause })
  }
  if (!response.ok) throw checkFailure(response.status, options.repository, authenticated)
  const payload: unknown = await response.json()
  return pickRelease(payload, options.includePrereleases)
}

/** Fetch one asset's bytes, enforcing the size ceiling. */
async function assetBytes(url: string, options: GitHubOptions, timeoutMs: number): Promise<Buffer> {
  const call = options.fetchImpl ?? fetch
  const response = await call(url, {
    headers: headers(options, 'application/octet-stream'),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new ReleaseCheckError('download-failed', `downloading ${url} answered ${response.status}`)
  }
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_ASSET_BYTES) {
    throw new ReleaseCheckError('download-failed', `asset is ${declared} bytes, over the ${MAX_ASSET_BYTES} ceiling`)
  }
  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength > MAX_ASSET_BYTES) {
    throw new ReleaseCheckError('download-failed', `asset is ${body.byteLength} bytes, over the ceiling`)
  }
  return body
}

/**
 * Download a release tarball to `destination`, verifying its checksum.
 *
 * The verification is not optional. A release that publishes no SHA256SUMS is
 * refused rather than trusted, because "no checksum" and "wrong checksum" have
 * the same consequence once the bytes are unpacked over a live install.
 *
 * @param release - the release to fetch.
 * @param destination - where to write the tarball.
 * @param options - repository and token.
 * @returns the verified digest.
 */
export async function downloadRelease(
  release: Release,
  destination: string,
  options: GitHubOptions,
): Promise<string> {
  if (release.checksums === undefined) {
    throw new ReleaseCheckError(
      'no-checksums',
      `release ${release.tag} publishes no ${'SHA256SUMS'} asset, so its tarball cannot be verified`,
    )
  }
  const manifest = (await assetBytes(release.checksums.url, options, CHECK_TIMEOUT_MS)).toString('utf8')
  const expected = digestFor(manifest, release.asset.name)
  if (expected === undefined) {
    throw new ReleaseCheckError('no-checksums', `${release.asset.name} is not listed in the release's SHA256SUMS`)
  }
  const body = await assetBytes(release.asset.url, options, DOWNLOAD_TIMEOUT_MS)
  const actual = createHash('sha256').update(body).digest('hex')
  if (actual !== expected) {
    throw new ReleaseCheckError(
      'checksum-mismatch',
      `${release.asset.name} hashed ${actual}, expected ${expected} — refusing to install it`,
    )
  }
  await writeFile(destination, body)
  return actual
}
