#!/usr/bin/env node
/**
 * @dsh-pro/archived-sessions build — a repackaging step, not a compile.
 *
 * Upstream ships this plugin prebuilt with no sources, so vendor/ holds its
 * published output verbatim and this script adapts it to install alongside the
 * other plugins here. Two things need adapting:
 *
 *   lib/index.js  — upstream imports `schemastery` as a runtime dependency,
 *                   which its own installer pulls into the profile via npm.
 *                   Ours only copies files, and the harness profile does NOT
 *                   provide schemastery, so an as-is copy dies at load with
 *                   ERR_MODULE_NOT_FOUND. esbuild inlines that one dependency
 *                   and leaves every `@deepseek-ai/*` and `node:*` import
 *                   external, since the harness supplies those.
 *
 *   lib/client.js — the browser bundle hardcodes the package name as the id it
 *                   registers under (`__ModuleLoader__.load({ id })`). The web
 *                   boot manifest looks the bundle up by OUR package name, so
 *                   the id is rewritten to match; leaving it would register a
 *                   plugin nothing ever asks for.
 */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const UPSTREAM_ID = 'dsh-archived-sessions'

await mkdir(join(ROOT, 'lib'), { recursive: true })

// ---- host half: inline schemastery, keep harness imports external ----------
await build({
  entryPoints: [join(ROOT, 'vendor', 'index.js')],
  outfile: join(ROOT, 'lib', 'index.js'),
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  bundle: true,
  external: ['@deepseek-ai/*', 'node:*'],
  sourcemap: false,
})

// ---- client half: retarget the loader id ----------------------------------
const client = await readFile(join(ROOT, 'vendor', 'client.js'), 'utf8')
const needle = `id: ${JSON.stringify(UPSTREAM_ID)}`
if (!client.includes(needle)) {
  throw new Error(`build: could not find ${needle} in vendor/client.js — upstream changed its bundle preamble`)
}
await writeFile(join(ROOT, 'lib', 'client.js'), client.replace(needle, `id: ${JSON.stringify(pkg.name)}`))

// ---- smoke checks ----------------------------------------------------------
const host = await import(join(ROOT, 'lib', 'index.js'))
if (typeof host.name !== 'string' || !Array.isArray(host.inject) || typeof host.apply !== 'function') {
  throw new Error('build: host half does not export { name, inject, apply }')
}
const out = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
if (/from\s*["']schemastery["']/.test(out)) {
  throw new Error('build: schemastery is still external — it would not resolve in the profile')
}
const rebuilt = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
new Function(rebuilt) // parse only; never executed here (window is undefined)

console.log(`built ${pkg.name}:`)
console.log('  lib/index.js  (host half, schemastery inlined, harness imports external)')
console.log(`  lib/client.js (client half, loader id retargeted to ${pkg.name})`)
