#!/usr/bin/env node
/**
 * @my-dsh/browser build.
 *
 *   lib/index.js — host half: src/ bundled to plain ESM.
 *
 * There is no client half; this plugin adds no UI. `playwright-core` stays
 * external because it is a real package on disk, not something that can be
 * inlined: it reads its own package.json, spawns a driver process, and locates
 * browser builds relative to its install path. The installer places it beside
 * the plugin in the profile. Everything else — schemastery included — is
 * bundled, because the harness profile resolves only what it ships.
 *
 * Type checking is a separate step (npm run typecheck); this transpiles and
 * smoke-checks that the output parses and has the expected plugin shape.
 */
import { build } from 'esbuild'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

await mkdir(join(ROOT, 'lib'), { recursive: true })

await build({
  entryPoints: [join(ROOT, 'src', 'index.ts')],
  outfile: join(ROOT, 'lib', 'index.js'),
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  bundle: true,
  external: ['playwright-core'],
  sourcemap: false,
})

const output = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
for (const expected of ['function apply', 'browser_open', 'browser_screenshot']) {
  if (!output.includes(expected)) {
    throw new Error(`build: lib/index.js is missing ${expected}; the bundle is not what the loader expects`)
  }
}
console.log(`  browser: lib/index.js (${(output.length / 1024).toFixed(1)} kB)`)
