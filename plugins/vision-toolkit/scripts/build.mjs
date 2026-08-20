#!/usr/bin/env node
/**
 * @dsh-pro/vision-toolkit build — a repackaging step, not a compile.
 *
 * Upstream's own build needs its full toolchain (a Python bootstrap, an
 * upstream-manifest check, a skill verification, and three tsc passes), so
 * upstream/ holds its PUBLISHED output and this script adapts that to install
 * alongside the other plugins here. Three things need adapting:
 *
 *   lib/index.js  — upstream publishes a multi-file ESM tree importing saxes,
 *                   tar, and undici. Its own installer npm-installs those into
 *                   the profile; ours only copies files, and the harness
 *                   profile provides none of them. esbuild bundles the tree
 *                   with those three inlined, leaving `@deepseek-ai/*` and
 *                   `node:*` external because the profile does provide those.
 *
 *   lib/client.js — the browser bundle hardcodes the package name as the id it
 *                   registers under; the web boot manifest looks a bundle up by
 *                   the INSTALLED name, so the id is retargeted.
 *
 *   payload dirs  — assets/, vendor/, runtime/, workers/, patches/ are read at
 *                   runtime through paths relative to the host module
 *                   (lib/index.js -> ../assets/skill/SKILL.md and friends), so
 *                   they are copied to the package root beside lib/. Only the
 *                   parts the code actually reads are vendored; upstream's
 *                   README screenshots are not.
 */
import { build } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UP = join(ROOT, 'upstream')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const upstreamPkg = JSON.parse(await readFile(join(UP, 'package.json'), 'utf8'))
const UPSTREAM_ID = upstreamPkg.name

await rm(join(ROOT, 'lib'), { recursive: true, force: true })
const TUTORIAL_URL = 'https://github.com/rodrigobaron/dsh-pro/blob/main/docs/groq-vision-key.md'

await mkdir(join(ROOT, 'lib'), { recursive: true })

// ---- host half: inline the three missing runtime deps ----------------------
await build({
  entryPoints: [join(UP, 'lib', 'index.js')],
  outfile: join(ROOT, 'lib', 'index.js'),
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  bundle: true,
  external: ['@deepseek-ai/*', 'node:*'],
  // tar and undici are CJS and call require() at runtime. esbuild's ESM output
  // otherwise replaces require with a stub that throws ("Dynamic require of
  // node:assert is not supported"), which kills the plugin at import.
  banner: { js: "import { createRequire as __nodeCreateRequire } from 'node:module'\nconst require = __nodeCreateRequire(import.meta.url)" },
  logLevel: 'error',
  sourcemap: false,
})

// ---- client half: retarget the loader id -----------------------------------
const client = await readFile(join(UP, 'lib', 'client.js'), 'utf8')
const needle = `id: ${JSON.stringify(UPSTREAM_ID)}`
if (!client.includes(needle)) {
  throw new Error(`build: ${needle} not found in upstream/lib/client.js — upstream changed its bundle preamble`)
}
let clientOut = client.replace(needle, `id: ${JSON.stringify(pkg.name)}`)

// ---- client half: repoint the Groq tutorial at our copy ---------------------
// Upstream links both locale variants at its own repository. That doc now lives
// in this repository (docs/groq-vision-key.md), English-only, so both variants
// point at the same place. Asserted: an upstream URL change fails the build
// rather than quietly shipping a link to somebody else's repo.
const TUTORIAL_URLS = [
  'https://github.com/Anionex/dsh-vision-toolkit/blob/main/docs/groq-qwen3.6-vision.md',
  'https://github.com/Anionex/dsh-vision-toolkit/blob/main/docs/groq-qwen3.6-vision.zh.md',
]
for (const url of TUTORIAL_URLS) {
  const quoted = JSON.stringify(url).replace(/"/g, "'")
  if (!clientOut.includes(quoted)) {
    throw new Error(`build: ${url} not found in upstream/lib/client.js — upstream moved the Groq tutorial link`)
  }
  clientOut = clientOut.replaceAll(quoted, JSON.stringify(TUTORIAL_URL).replace(/"/g, "'"))
}

// ---- client half: retire the upstream update panel -------------------------
// Updating is @dsh-pro/updates' job now, and upstream's panel cannot do it here
// regardless: it is a pnpm/npm-registry updater that requires the plugin to be
// a direct dependency of the profile installed from a registry spec. These
// plugins are directories copied into the profile by install.sh, so its own
// capability check reports "not a direct dependency" and it refuses. All it can
// render is a dead panel explaining why it will not work, next to a working
// Updates section that does the same job.
//
// Hidden rather than cut out: the panel lives inside upstream's published
// bundle, and rewriting a vendored blob's structure trades its byte-for-byte
// fidelity for something a stylesheet does exactly as well.
const CSS_END = '}\n`;\nfunction installStyles()'
if (!clientOut.includes(CSS_END)) {
  throw new Error('build: the client stylesheet literal did not end as expected — upstream reshaped its bundle')
}
if (!clientOut.includes('dvt-update-panel')) {
  throw new Error('build: .dvt-update-panel is gone from upstream/lib/client.js — the hide rule is now dead code')
}
clientOut = clientOut.replace(CSS_END, `}.dvt-update-panel{display:none}${CSS_END}`)

await writeFile(join(ROOT, 'lib', 'client.js'), clientOut)

// ---- runtime payload: beside lib/, where the host half looks for it --------
for (const dir of ['assets', 'vendor', 'runtime', 'workers', 'patches']) {
  await rm(join(ROOT, dir), { recursive: true, force: true })
  await cp(join(UP, dir), join(ROOT, dir), { recursive: true })
}

// ---- smoke checks ----------------------------------------------------------
const out = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
for (const dep of ['saxes', 'tar', 'undici']) {
  if (new RegExp(`from\\s*["']${dep}["']`).test(out)) {
    throw new Error(`build: ${dep} is still external — it would not resolve in the profile`)
  }
}
new Function(await readFile(join(ROOT, 'lib', 'client.js'), 'utf8'))

console.log(`built ${pkg.name}:`)
console.log('  lib/index.js  (host half, saxes/tar/undici inlined)')
console.log(`  lib/client.js (client half, loader id retargeted to ${pkg.name})`)
console.log('  assets/ vendor/ runtime/ workers/ patches/  (runtime payload)')
