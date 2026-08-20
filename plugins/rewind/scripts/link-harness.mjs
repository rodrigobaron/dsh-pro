#!/usr/bin/env node
/**
 * Link the installed harness into node_modules so `tsc` can see it.
 *
 * This plugin's client half imports harness client packages for the module
 * augmentations that declare the composer slots it fills — without them the
 * slot names are unknown strings and the whole file fails to check. The
 * packages are runtime-provided and the build externalizes them, so they are
 * not dependencies; they are only needed to type-check.
 *
 * Installing them from npm does not work. The published rc.7 packages peer
 * `^0.1.0-rc.7`, npm resolves that to rc.8, and rc.8 peers `^0.1.0-rc.8`, so
 * the graph has no solution. Pinning rc.8 would install but would check
 * against a version that is not the one running, which is worse than no check
 * at all.
 *
 * So we check against the harness that IS running: symlink its packages into
 * this plugin's node_modules. The version can never drift from the deployment,
 * because it IS the deployment. Symlinks (rather than tsconfig `paths`) keep
 * ordinary resolution, so each package's `exports` map still governs subpaths
 * like `@deepseek-ai/dsh-client-runtime/client`, and their own type imports
 * resolve among their siblings in the harness tree.
 *
 * Only the packages listed below are linked. A partial scope directory does
 * not shadow the rest of `@deepseek-ai`, because node resolves the full
 * package path at each level — so schemastery still comes from this
 * repository's own lockfile, and the build stays reproducible.
 *
 * `npm install` prunes these links, since nothing in package.json claims them.
 * That is why `npm run typecheck` runs this first rather than expecting a
 * setup step to have happened: the links are rebuilt on demand, every time.
 */
import { mkdir, readdir, readlink, rm, symlink } from 'node:fs/promises'
import { existsSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Harness packages this plugin imports for types only. */
const PACKAGES = [
  'cordis',
  'dsh-api-remotes',
  'dsh-llm',
  'dsh-session',
]

/**
 * Find the `@deepseek-ai` scope directory of the installed harness.
 *
 * The profile's healed node_modules is the authoritative answer — it is the
 * tree the running deployment resolves from. The npx cache is the fallback for
 * a checkout whose profile has not been created yet.
 *
 * @returns absolute path to a directory containing the harness packages.
 */
async function findHarnessScope() {
  const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  const fromProfile = join(dshHome, 'profiles', 'node_modules', '@deepseek-ai')
  if (existsSync(join(fromProfile, 'dsh-session'))) return fromProfile

  const npxRoot = join(homedir(), '.npm', '_npx')
  if (existsSync(npxRoot)) {
    for (const entry of await readdir(npxRoot)) {
      const candidate = join(npxRoot, entry, 'node_modules', '@deepseek-ai')
      if (existsSync(join(candidate, 'dsh-session'))) return candidate
    }
  }

  throw new Error(
    'link-harness: no installed DeepSeek Harness found. Looked in '
    + `${fromProfile} and ~/.npm/_npx/*/node_modules/@deepseek-ai. `
    + 'Run dsh once so its profile is created, or set DSH_HOME.',
  )
}

const scope = await findHarnessScope()
const target = join(ROOT, 'node_modules', '@deepseek-ai')
await mkdir(target, { recursive: true })

let linked = 0
for (const pkg of PACKAGES) {
  const source = resolve(scope, pkg)
  if (!existsSync(source)) {
    throw new Error(`link-harness: the installed harness has no ${pkg} (looked in ${scope})`)
  }
  const link = join(target, pkg)
  // Replace only our own symlinks. A real directory here would be an npm-owned
  // install, and silently deleting one is not this script's business.
  if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false }) !== undefined) {
    if (!lstatSync(link).isSymbolicLink()) {
      throw new Error(`link-harness: ${link} is a real directory, not a link this script owns`)
    }
    if (resolve(dirname(link), await readlink(link)) === source) {
      linked += 1
      continue
    }
    await rm(link, { recursive: true, force: true })
  }
  await symlink(source, link, 'dir')
  linked += 1
}

console.log(`  linked ${linked} harness packages for type-checking from ${scope}`)
