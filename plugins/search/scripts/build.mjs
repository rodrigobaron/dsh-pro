#!/usr/bin/env node
/**
 * @my-dsh/search build — a repackaging step, not a compile.
 *
 * Upstream ships this plugin prebuilt with no sources, so vendor/ holds its
 * published output verbatim and this script adapts it. Every edit is an
 * asserted exact-string rewrite: if upstream changes the line, the build fails
 * loudly instead of silently shipping a plugin that still prefers Chinese.
 *
 * Nothing is bundled. The host half imports only @deepseek-ai/dsh-settings,
 * @deepseek-ai/dsh-tools, and @deepseek-ai/schemastery, all of which the
 * harness profile already resolves.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const UPSTREAM_ID = 'dsh-free-search'

await mkdir(join(ROOT, 'lib'), { recursive: true })

/**
 * Apply one exact-string rewrite, or fail.
 *
 * @param source - file contents.
 * @param from - the exact text upstream ships.
 * @param to - its replacement.
 * @param why - what the rewrite is for, quoted in the failure.
 * @returns the rewritten contents.
 */
function rewrite(source, from, to, why) {
  const count = source.split(from).length - 1
  if (count !== 1) {
    throw new Error(
      `build: expected exactly one occurrence of ${JSON.stringify(from)} (${why}), found ${count}. `
      + 'Upstream changed; re-check the rewrite before shipping.',
    )
  }
  return source.replace(from, to)
}

// ── host half: English defaults ───────────────────────────────────────────────
// Upstream is tuned for Chinese. These four lines are the whole of it — every
// other Chinese string in the file is a comment, and the model-facing text
// (tool descriptions, the system-prompt section) is already English.
let host = await readFile(join(ROOT, 'vendor', 'index.js'), 'utf8')

// The big one. This header goes out on EVERY engine's request through the
// shared fetch helper, so it steers DuckDuckGo, Bing, SearXNG and AnySearch
// alike — more than any per-engine market setting does.
host = rewrite(
  host,
  'const ACCEPT_LANG = "zh-CN,zh;q=0.9,en;q=0.8";',
  'const ACCEPT_LANG = "en-US,en;q=0.9";',
  'Accept-Language sent to every engine',
)

// The settings UI language.
host = rewrite(host, 'lang: z.string().default("zh"),', 'lang: z.string().default("en"),', 'settings UI language')

// The default engine. Upstream picks Bing and says why: "most stable,
// optimized for Chinese (zh-CN)". That reason does not survive the switch to
// English. Measured on this machine, "what is the capital of Portugal":
// DuckDuckGo returned en.wikipedia.org/wiki/Lisbon first; Bing returned
// Capital One and a UK radio station, behind bing.com/ck/a redirect wrappers.
// DuckDuckGo rate-limits more often, which the automatic fallback chain
// already handles by moving on to Bing and the rest.
host = rewrite(host, 'provider: z.string().default("bing"),', 'provider: z.string().default("ddg"),', 'default engine')

// Bing's market, in the schema and again as a hardcoded fallback for a cleared
// setting. Both have to move or a blank field silently returns Chinese results.
host = rewrite(host, 'bingMarket: z.string().default("zh-CN"),', 'bingMarket: z.string().default("en-US"),', 'Bing market default')
host = rewrite(host, 'options?.bingMarket ?? "zh-CN"', 'options?.bingMarket ?? "en-US"', 'Bing market fallback')

// DuckDuckGo's region (the `kl` parameter). Upstream leaves it unset, which
// means DuckDuckGo's own default; naming it keeps English results English.
host = rewrite(host, 'region: z.string(),', 'region: z.string().default("us-en"),', 'DuckDuckGo region default')

await writeFile(join(ROOT, 'lib', 'index.js'), host)

// ── client half: retarget the loader id ──────────────────────────────────────
// The bundle hardcodes the package name it registers under, and the web boot
// manifest looks it up by OUR installed name. Leaving it registers a plugin
// nothing ever asks for.
// The bundle names itself twice, and they are different things: the loader
// preamble (keyed by the boot manifest) and a settings-slot entry id (which
// must be unique within its slot). Both are anchored precisely, because a
// blanket replace would be indistinguishable from either one moving.
let client = await readFile(join(ROOT, 'vendor', 'client.js'), 'utf8')

client = rewrite(
  client,
  `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(UPSTREAM_ID)},`,
  `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(pkg.name)},`,
  'client bundle loader id',
)

client = rewrite(
  client,
  `            key: "free-search",\n            id: ${JSON.stringify(UPSTREAM_ID)},`,
  `            key: "free-search",\n            id: ${JSON.stringify(pkg.name)},`,
  'settings.plugin.item slot entry id',
)

// A data-plugin attribute on the injected <style> tag. Cosmetic, but leaving
// it means two plugins' stylesheets claim the same owner in the DOM.
client = rewrite(
  client,
  `tag.dataset.plugin = ${JSON.stringify(UPSTREAM_ID)};`,
  `tag.dataset.plugin = ${JSON.stringify(pkg.name)};`,
  'injected stylesheet owner attribute',
)

await writeFile(join(ROOT, 'lib', 'client.js'), client)

// ── smoke checks ─────────────────────────────────────────────────────────────
const mod = await import(join(ROOT, 'lib', 'index.js'))
if (typeof mod.apply !== 'function') throw new Error('build: host half does not export apply()')

const out = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
for (const stale of ['"zh-CN,zh', 'default("zh")', 'default("zh-CN")']) {
  if (out.includes(stale)) throw new Error(`build: ${stale} survived in lib/index.js`)
}
const outClient = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
if (outClient.includes(JSON.stringify(UPSTREAM_ID))) {
  throw new Error(`build: ${UPSTREAM_ID} survived as an id in lib/client.js`)
}

console.log(`built ${pkg.name}:`)
console.log(`  lib/index.js  (host half, English defaults, harness imports external) ${(host.length / 1024).toFixed(0)} kB`)
console.log(`  lib/client.js (client half, loader id retargeted to ${pkg.name}) ${(client.length / 1024).toFixed(0)} kB`)
