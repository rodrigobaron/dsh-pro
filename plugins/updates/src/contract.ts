/**
 * The wire contract between the update host and its settings section.
 *
 * Both halves build from this file, so a field renamed on one side fails the
 * other's typecheck rather than silently becoming undefined at runtime — the
 * exact failure that made routines report success while creating jobs with no
 * project attached.
 *
 * @module @dsh-pro/updates/contract
 */

/** The route family this plugin serves. The package name is not a URL path. */
export const API_PREFIX = '/api/updates'

/** What the profile records about the install it is running. */
export interface InstalledRelease {
  readonly version: string
  readonly commit: string
  readonly builtAt: string
  /** `local` for ./install.sh, `release` for a tarball this plugin applied. */
  readonly source: 'local' | 'release'
  readonly plugins: readonly string[]
}

/** A release this plugin could install. */
export interface AvailableRelease {
  readonly tag: string
  readonly version: string
  readonly notes: string
  readonly publishedAt: string
  readonly sizeBytes: number
  readonly prerelease: boolean
}

/** Why updating is not possible right now. */
export type UnsupportedReason =
  | 'profile-not-found'
  | 'profile-read-only'
  | 'no-release-marker'
  | 'repository-unreachable'
  | 'authentication-required'
  | 'no-releases'

/** Everything the settings section renders. */
export interface UpdateState {
  /** Null when the profile carries no marker (installed before this plugin). */
  readonly installed: InstalledRelease | null
  readonly latest: AvailableRelease | null
  readonly updateAvailable: boolean
  /** ISO timestamp of the last successful check. */
  readonly checkedAt: string | null
  readonly supported: boolean
  readonly reason?: UnsupportedReason
  /** The repository the check reads, for display. */
  readonly repository: string
  /** True when a token is configured; the token itself is never sent. */
  readonly authenticated: boolean
  /** Set after an applied update, until the host restarts. */
  readonly pendingRestart: {
    readonly fromVersion: string
    readonly toVersion: string
  } | null
  readonly lastError?: string
}

/** The outcome of applying an update. */
export interface UpdateResult {
  readonly fromVersion: string
  readonly toVersion: string
  /** Where the previous install was moved, in case a manual undo is wanted. */
  readonly backupPath: string
  /** Always true: this plugin never restarts the host for you. See routes. */
  readonly restartRequired: true
}

/** One structured failure. */
export interface UpdateError {
  readonly code: string
  readonly message: string
}

/** Envelope shared by every route in this family. */
export type UpdateResponse<T> =
  | { readonly ok: true, readonly value: T }
  | { readonly ok: false, readonly error: UpdateError }
