/**
 * Version parsing and comparison.
 *
 * Releases are tagged `vMAJOR.MINOR.PATCH` with an optional prerelease suffix.
 * That is a small enough slice of semver to implement exactly rather than carry
 * a dependency for, and being exact matters: this comparison is the only thing
 * standing between "an update is available" and "reinstall the same release
 * forever".
 *
 * @module @dsh-pro/updates/version
 */

/** A parsed version. `prerelease` is the dot-separated tail after `-`. */
export interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly string[]
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Parse a version string, with or without a leading `v`.
 * @param raw - the version or tag text.
 * @returns the parsed version, or undefined when it is not one.
 */
export function parseVersion(raw: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(raw.trim())
  if (match === null) return undefined
  const [, major, minor, patch, prerelease] = match
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined || prerelease === '' ? [] : prerelease.split('.'),
  }
}

/** Compare two prerelease identifier lists by the semver precedence rules. */
function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  // No prerelease outranks any prerelease: 1.0.0 is newer than 1.0.0-rc.1.
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index]
    const right = b[index]
    // A shorter run of identifiers is lower precedence when all else matched.
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right)
      if (diff !== 0) return diff < 0 ? -1 : 1
      continue
    }
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/**
 * Compare two parsed versions.
 * @param a - left version.
 * @param b - right version.
 * @returns negative when a precedes b, 0 when equal, positive when a follows b.
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Whether `candidate` is a newer release than `installed`.
 *
 * An unparseable or missing installed version is treated as "older than
 * anything": a profile with no release marker predates this plugin, and the
 * honest offer there is the newest release. An unparseable candidate is never
 * newer — a tag we cannot read is a tag we must not act on.
 *
 * @param installed - the installed version, if it is known.
 * @param candidate - the version offered by the release feed.
 * @returns true when updating would move forward.
 */
export function isNewer(installed: string | undefined, candidate: string): boolean {
  const next = parseVersion(candidate)
  if (next === undefined) return false
  if (installed === undefined) return true
  const current = parseVersion(installed)
  if (current === undefined) return true
  return compareVersions(next, current) > 0
}
