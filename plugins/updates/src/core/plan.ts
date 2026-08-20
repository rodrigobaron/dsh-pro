/**
 * The swap plan: which directories move where when an update is applied.
 *
 * Pure, and separated from the code that performs it, because the ordering here
 * is the whole safety argument. Getting it wrong does not throw — it deletes an
 * install and leaves nothing to put back.
 *
 * The sequence is:
 *
 *   1. unpack the release into `<scope>.incoming` (beside the live scope, so
 *      the rename below stays on one filesystem and stays atomic)
 *   2. rename `<scope>` -> `<backup>`      — the live install is now safe
 *   3. rename `<scope>.incoming` -> `<scope>`  — the new install is now live
 *
 * Between 2 and 3 there is no scope directory at all. That window is two
 * renames wide and cannot be closed entirely without the harness supporting an
 * atomic swap, which it does not; a failure inside it is recoverable because
 * the backup is a complete install that step 2 already put somewhere safe.
 *
 * @module @dsh-pro/updates/plan
 */

/** The scope every plugin in this repository installs under. */
export const SCOPE = '@dsh-pro'

/** The marker file an install leaves in the scope directory. */
export const MARKER_FILE = '.release.json'

/** One planned swap. */
export interface SwapPlan {
  /** The live scope directory, e.g. `<profile>/node_modules/@dsh-pro`. */
  readonly scopeDir: string
  /** Where the release is unpacked before anything live is touched. */
  readonly incomingDir: string
  /** Where the current install is moved. Retained after a successful update. */
  readonly backupDir: string
  /** The loader patch this install owns. */
  readonly patchFile: string
  /** Where the current patch is copied before being overwritten. */
  readonly patchBackup: string
}

/**
 * Build the swap plan for one update.
 * @param options - the resolved profile locations and a run stamp.
 * @returns the paths every step of the update uses.
 */
export function planSwap(options: {
  readonly profileModules: string
  readonly patchFile: string
  readonly backupRoot: string
  readonly stamp: string
}): SwapPlan {
  const scopeDir = `${options.profileModules}/${SCOPE}`
  return {
    scopeDir,
    incomingDir: `${scopeDir}.incoming`,
    backupDir: `${options.backupRoot}/${options.stamp}`,
    patchFile: options.patchFile,
    patchBackup: `${options.backupRoot}/${options.stamp}/cordis.patch.yml`,
  }
}

/** What a staged release directory must contain before it may be swapped in. */
export interface StagedRelease {
  readonly version: string
  readonly plugins: readonly string[]
}

/** Why a staged release was rejected. */
export type StagingProblem =
  | 'no-manifest'
  | 'no-patch'
  | 'version-mismatch'
  | 'no-plugins'
  | 'missing-plugin'

/**
 * Check that an unpacked release is complete before it replaces anything.
 *
 * Called with the manifest and the plugin directories actually found on disk.
 * A tarball that unpacked short would otherwise be swapped in and only then
 * discovered, with the live install already moved aside.
 *
 * @param manifest - the parsed manifest.json from the tarball.
 * @param expectedVersion - the version the release claimed to be.
 * @param foundPlugins - plugin directory names that exist and have a manifest.
 * @param hasPatch - whether cordis.patch.yml unpacked.
 * @returns the validated release, or the reason it is unusable.
 */
export function validateStaged(
  manifest: unknown,
  expectedVersion: string,
  foundPlugins: readonly string[],
  hasPatch: boolean,
): StagedRelease | StagingProblem {
  if (typeof manifest !== 'object' || manifest === null) return 'no-manifest'
  const record = manifest as Record<string, unknown>
  const version = record.version
  const plugins = record.plugins
  if (typeof version !== 'string') return 'no-manifest'
  if (!hasPatch) return 'no-patch'
  // The tag, the manifest, and the asset name all state the version
  // independently. If they disagree, something upstream of here is wrong and
  // the safe move is to install nothing.
  if (version !== expectedVersion) return 'version-mismatch'
  if (!Array.isArray(plugins) || plugins.length === 0) return 'no-plugins'
  const named = plugins.filter((entry): entry is string => typeof entry === 'string')
  if (named.length !== plugins.length) return 'no-plugins'
  const found = new Set(foundPlugins)
  for (const name of named) {
    if (!found.has(name)) return 'missing-plugin'
  }
  return { version, plugins: named }
}
