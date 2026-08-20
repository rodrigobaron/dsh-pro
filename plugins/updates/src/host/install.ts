/**
 * Applying a downloaded release to the profile.
 *
 * The order of operations is the safety argument, and it lives in
 * {@link ../core/plan.ts}. This module performs it, and its one job beyond that
 * is to never leave the profile without a scope directory: every failure after
 * the live install has been moved aside restores it before rethrowing.
 *
 * What this does NOT do is restart the harness. See {@link ../index.ts}.
 *
 * @module @dsh-pro/updates/install
 */
import { constants as fsConstants } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { x as extractTar } from 'tar'
import { MARKER_FILE, planSwap, validateStaged, type SwapPlan } from '../core/plan.ts'
import type { InstalledRelease } from '../contract.ts'

/** A failure applying an update. */
export class InstallError extends Error {
  // Assigned explicitly rather than as a parameter property: Node's strip-only
  // TypeScript mode rejects those, and the tests import these sources directly.
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'InstallError'
    this.code = code
  }
}

/** Where an update reads and writes. */
export interface InstallTarget {
  /** `<dsh home>/profiles/node_modules`. */
  readonly profileModules: string
  /** `<dsh home>/profiles/<profile>/cordis.patch.yml`. */
  readonly patchFile: string
  /** `<dsh home>/updates`. */
  readonly workRoot: string
}

/** Whether a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Read the marker an install leaves behind.
 * @param profileModules - the profile's node_modules directory.
 * @returns the recorded install, or null when there is no marker.
 */
export async function readMarker(profileModules: string): Promise<InstalledRelease | null> {
  const path = join(profileModules, '@dsh-pro', MARKER_FILE)
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const version = record.version
    if (typeof version !== 'string') return null
    const plugins = Array.isArray(record.plugins)
      ? record.plugins.filter((entry): entry is string => typeof entry === 'string')
      : []
    return {
      version,
      commit: typeof record.commit === 'string' ? record.commit : 'unknown',
      builtAt: typeof record.builtAt === 'string' ? record.builtAt : '',
      source: record.source === 'release' ? 'release' : 'local',
      plugins,
    }
  } catch {
    return null
  }
}

/** Whether the profile can be written to at all. */
export async function isWritable(profileModules: string): Promise<boolean> {
  try {
    await access(profileModules, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Unpack the tarball into the staging directory and check it is complete. */
async function stage(tarball: string, plan: SwapPlan, expectedVersion: string): Promise<readonly string[]> {
  await rm(plan.incomingDir, { recursive: true, force: true })
  await mkdir(plan.incomingDir, { recursive: true })
  const unpacked = join(plan.incomingDir, '.unpacked')
  await mkdir(unpacked, { recursive: true })
  try {
    await extractTar({ file: tarball, cwd: unpacked })
  } catch (cause) {
    throw new InstallError('unpack-failed', `could not unpack the release: ${String(cause)}`, { cause })
  }

  const modules = join(unpacked, 'modules', '@dsh-pro')
  let found: string[] = []
  try {
    const entries = await readdir(modules, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (await exists(join(modules, entry.name, 'package.json'))) found.push(`@dsh-pro/${entry.name}`)
    }
  } catch {
    throw new InstallError('unpack-failed', 'the release contains no modules/@dsh-pro directory')
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8'))
  } catch {
    manifest = undefined
  }
  const patchPath = join(unpacked, 'cordis.patch.yml')
  const validated = validateStaged(manifest, expectedVersion, found, await exists(patchPath))
  if (typeof validated === 'string') {
    throw new InstallError(validated, `the release did not unpack completely (${validated})`)
  }

  // Promote the scope directory to where the swap expects it, and keep the
  // patch beside it so the swap needs nothing from the unpack tree afterwards.
  await rename(modules, join(plan.incomingDir, 'scope'))
  await copyFile(patchPath, join(plan.incomingDir, 'cordis.patch.yml'))
  await rm(unpacked, { recursive: true, force: true })
  return validated.plugins
}

/**
 * Apply a verified release tarball to the profile.
 *
 * @param tarball - path to the downloaded, checksum-verified tarball.
 * @param version - the version the release claims to be.
 * @param target - the profile locations to write.
 * @param stamp - a run identifier used to name the backup.
 * @returns the backup directory, retained so an update can be undone by hand.
 */
export async function applyRelease(
  tarball: string,
  version: string,
  target: InstallTarget,
  stamp: string,
): Promise<{ backupDir: string, plugins: readonly string[] }> {
  const plan = planSwap({
    profileModules: target.profileModules,
    patchFile: target.patchFile,
    backupRoot: join(target.workRoot, 'backups'),
    stamp,
  })
  if (!await isWritable(target.profileModules)) {
    throw new InstallError('profile-read-only', `${target.profileModules} is not writable`)
  }

  const plugins = await stage(tarball, plan, version)
  await mkdir(plan.backupDir, { recursive: true })

  // Everything above this line is reversible by deleting the staging
  // directory. Everything below moves the live install.
  const hadScope = await exists(plan.scopeDir)
  if (hadScope) {
    await rename(plan.scopeDir, join(plan.backupDir, 'scope'))
  }
  if (await exists(plan.patchFile)) {
    await copyFile(plan.patchFile, plan.patchBackup)
  }

  const restore = async (): Promise<void> => {
    await rm(plan.scopeDir, { recursive: true, force: true })
    if (hadScope) await rename(join(plan.backupDir, 'scope'), plan.scopeDir)
    if (await exists(plan.patchBackup)) await copyFile(plan.patchBackup, plan.patchFile)
  }

  try {
    await rename(join(plan.incomingDir, 'scope'), plan.scopeDir)
    await copyFile(join(plan.incomingDir, 'cordis.patch.yml'), plan.patchFile)
    const marker: InstalledRelease = {
      version,
      commit: 'release',
      builtAt: new Date().toISOString(),
      source: 'release',
      plugins,
    }
    await writeFile(join(plan.scopeDir, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`)
  } catch (cause) {
    try {
      await restore()
    } catch (restoreFailure) {
      // Both the swap and the undo failed. Say exactly where the install is,
      // because at this point only a person can put it back.
      throw new InstallError(
        'rollback-failed',
        `applying ${version} failed and the previous install could not be restored automatically.`
        + ` It is intact at ${plan.backupDir}/scope — move it back to ${plan.scopeDir}.`
        + ` (${String(cause)}; restore: ${String(restoreFailure)})`,
        { cause },
      )
    }
    throw new InstallError('swap-failed', `applying ${version} failed and was rolled back: ${String(cause)}`, { cause })
  } finally {
    await rm(plan.incomingDir, { recursive: true, force: true })
  }

  return { backupDir: plan.backupDir, plugins }
}
