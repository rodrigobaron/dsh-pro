/**
 * Reading a GitHub release into the shape this plugin acts on.
 *
 * Everything here is pure: given the JSON the API returned, decide which asset
 * is the payload, what its expected checksum is, and whether it is worth
 * installing. Keeping the decisions out of the network code is what makes them
 * testable, and these are decisions that must not be wrong — the checksum in
 * particular is the only thing that distinguishes "the release we published"
 * from "whatever arrived over the wire".
 *
 * @module @dsh-pro/updates/release
 */
import { isNewer } from './version.ts'

/** The tarball asset name for a version, as the release workflow packs it. */
export function assetNameFor(version: string): string {
  return `dsh-pro-${version}.tar.gz`
}

/** The checksum manifest published beside the tarball. */
export const CHECKSUM_ASSET = 'SHA256SUMS'

/** One release asset, as much of it as this plugin uses. */
export interface ReleaseAsset {
  readonly name: string
  readonly url: string
  readonly size: number
}

/** A release reduced to what an update needs. */
export interface Release {
  readonly tag: string
  readonly version: string
  readonly notes: string
  readonly publishedAt: string
  readonly asset: ReleaseAsset
  readonly checksums?: ReleaseAsset
  readonly prerelease: boolean
}

/** Why a release could not be used. */
export type ReleaseProblem =
  | 'not-a-release'
  | 'draft'
  | 'unreadable-tag'
  | 'no-tarball-asset'

/** Narrow an unknown value to a record without asserting its fields. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read one asset entry, if it has the fields a download needs. */
function readAsset(value: unknown): ReleaseAsset | undefined {
  const record = asRecord(value)
  if (record === undefined) return undefined
  const name = record.name
  // The API-authenticated download URL, which works for private repositories
  // when paired with an Accept: application/octet-stream header. The
  // browser_download_url does not: for a private repo it redirects to a
  // sign-in page, and the tarball check would then fail on an HTML body.
  const url = record.url
  const size = record.size
  if (typeof name !== 'string' || typeof url !== 'string') return undefined
  return { name, url, size: typeof size === 'number' ? size : 0 }
}

/**
 * Reduce a GitHub release payload to a {@link Release}.
 * @param payload - the parsed JSON of one release object.
 * @returns the release, or the reason it cannot be used.
 */
export function readRelease(payload: unknown): Release | ReleaseProblem {
  const record = asRecord(payload)
  if (record === undefined) return 'not-a-release'
  if (record.draft === true) return 'draft'
  const tag = record.tag_name
  if (typeof tag !== 'string') return 'not-a-release'
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  // A tag we cannot parse cannot be compared, and a release we cannot compare
  // must not be offered — it would either never install or install forever.
  if (!isNewer(undefined, version)) return 'unreadable-tag'

  const assets = Array.isArray(record.assets) ? record.assets : []
  const parsed = assets.map(readAsset).filter((asset): asset is ReleaseAsset => asset !== undefined)
  const asset = parsed.find(candidate => candidate.name === assetNameFor(version))
  if (asset === undefined) return 'no-tarball-asset'

  const notes = typeof record.body === 'string' ? record.body : ''
  const publishedAt = typeof record.published_at === 'string' ? record.published_at : ''
  const checksums = parsed.find(candidate => candidate.name === CHECKSUM_ASSET)
  return {
    tag,
    version,
    notes,
    publishedAt,
    asset,
    ...checksums === undefined ? {} : { checksums },
    prerelease: record.prerelease === true,
  }
}

/**
 * Pick the newest usable release from a listing.
 *
 * `/releases/latest` already excludes prereleases and drafts, but the listing
 * endpoint does not, and it is the one that answers when a repository has only
 * ever published prereleases. Ordering by version rather than trusting the
 * feed's order keeps a re-tagged older release from winning.
 *
 * @param payload - the parsed JSON array of releases.
 * @param includePrereleases - whether a prerelease may be offered.
 * @returns the newest usable release, or undefined when there is none.
 */
export function pickRelease(payload: unknown, includePrereleases: boolean): Release | undefined {
  const list = Array.isArray(payload) ? payload : [payload]
  const usable: Release[] = []
  for (const entry of list) {
    const release = readRelease(entry)
    if (typeof release === 'string') continue
    if (release.prerelease && !includePrereleases) continue
    usable.push(release)
  }
  let best: Release | undefined
  for (const release of usable) {
    if (best === undefined || isNewer(best.version, release.version)) best = release
  }
  return best
}

/**
 * Find one file's expected digest in a `sha256sum` manifest.
 *
 * The format is `<hex>  <name>`, two spaces by convention but any run of
 * whitespace in practice.
 *
 * @param manifest - the SHA256SUMS body.
 * @param fileName - the asset to look up.
 * @returns the lowercase hex digest, or undefined when the file is not listed.
 */
export function digestFor(manifest: string, fileName: string): string | undefined {
  for (const line of manifest.split('\n')) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (match === null) continue
    const [, digest, name] = match
    if (digest === undefined || name === undefined) continue
    if (name === fileName) return digest.toLowerCase()
  }
  return undefined
}
