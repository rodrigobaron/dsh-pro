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
// English, and Bing turns out to be the engine that gets answers WRONG:
// cookieless requests silently ignore site:/filetype:/inurl: and return a
// confident result set for a different query.
//
// Measured here across three queries per engine, availability and correctness
// separately, because a returned result is not a right one:
//
//   engine      available  median   site:  question
//   keenable        3/3     518ms    yes     yes
//   anysearch       3/3    1317ms    yes     yes
//   exa             3/3    1331ms    yes     yes
//   tavily          3/3    1727ms    yes     yes
//   bing            3/3     268ms    NO      yes
//   ddg             2/3     943ms    403     403
//   ddg-lite        1/3    3234ms    rate-limited
//
// keenable it is: fastest of the engines that are actually correct, and it
// needs no key (keyless MCP; KEENABLE_API_KEY only raises the quota). ddg was
// the earlier pick here on the strength of one good query, and then spent the
// rest of the session rate-limited. The fallback chain covers a bad day for
// any of them.
host = rewrite(host, 'provider: z.string().default("bing"),', 'provider: z.string().default("keenable"),', 'default engine')

// Bing's market, in the schema and again as a hardcoded fallback for a cleared
// setting. Both have to move or a blank field silently returns Chinese results.
host = rewrite(host, 'bingMarket: z.string().default("zh-CN"),', 'bingMarket: z.string().default("en-US"),', 'Bing market default')
host = rewrite(host, 'options?.bingMarket ?? "zh-CN"', 'options?.bingMarket ?? "en-US"', 'Bing market fallback')

// DuckDuckGo's region (the `kl` parameter). Upstream leaves it unset, which
// means DuckDuckGo's own default; naming it keeps English results English.
host = rewrite(host, 'region: z.string(),', 'region: z.string().default("us-en"),', 'DuckDuckGo region default')

// ── host half: hand back real URLs, not Bing's redirector ───────────────────
// Every organic Bing result is wrapped in a bing.com/ck/a redirect, and the
// scraper takes the first href in the block — so the agent receives
// "https://www.bing.com/ck/a?!&&p=..." for every single result instead of the
// site it actually found. That breaks web_fetch on the result, breaks dedup by
// URL, and hides the domain the model would otherwise judge a source by.
//
// The destination is right there in the base64 `u` parameter (Bing prefixes it
// "a1"); <cite> carries a display-formatted copy as a fallback. Verified
// against live Bing HTML: all ten blocks decode to their true URLs.
host = rewrite(
  host,
  'async function searchBing(query, maxResults, options, signal) {',
  `function resolveBingUrl(href, block) {
  const raw = href.replace(/&amp;/g, "&");
  const encoded = /[?&]u=([^&"]+)/.exec(raw);
  if (encoded) {
    const payload = encoded[1].startsWith("a1") ? encoded[1].slice(2) : encoded[1];
    try {
      const decoded = Buffer.from(payload, "base64url").toString("utf8");
      if (/^https?:\\/\\//.test(decoded)) return decoded;
    } catch {
      // Not base64 after all; fall through to <cite>.
    }
  }
  const cite = /<cite[^>]*>([\\s\\S]*?)<\\/cite>/.exec(block);
  if (cite) {
    const text = stripTags(cite[1]).replace(/\\s*\u203a\\s*/g, "/").replace(/\\s+/g, "");
    if (/^https?:\\/\\//.test(text) && !text.includes("\u2026")) return text;
  }
  return raw;
}

async function searchBing(query, maxResults, options, signal) {`,
  'Bing redirect-URL resolver',
)
host = rewrite(host, 'url: hrefMatch[1],', 'url: resolveBingUrl(hrefMatch[1], block),', 'Bing result URL')

// Bing ignores site:, filetype: and friends for cookieless requests. Verified
// with two header profiles including a full browser fingerprint: it echoes the
// query back in og:title and then returns generic entity results anyway.
//
// The dangerous part is that it does not FAIL. It returns a confident, healthy
// looking result set for a completely different query, so the automatic
// fallback chain never fires and nothing downstream can tell. Measured on
// "site:linkedin.com/in Rodrigo Baron machine learning": Bing returned ten
// Olivia Rodrigo results, while tavily and exa both returned the intended
// profile first. Only the model can avoid this, so the model is told.
host = rewrite(
  host,
  '"- bing (Bing) - FREE, no key (most stable)",',
  '"- bing (Bing) - FREE, no key (most stable for plain queries, but SILENTLY IGNORES site:/filetype:/inurl: operators and returns unfiltered results anyway - for an operator query use ddg, tavily or exa)",',
  'Bing line in the system-prompt section',
)

// ── host half: SearXNG is bring-your-own-instance ────────────────────────────
// Upstream ships six public instances. None of them work, and not because of
// transient rate limiting: SearXNG disables the JSON output format by default
// and its bot limiter rejects anonymous `format=json`. Probed 2026-08-20, all
// six upstream defaults plus ten more public instances returned 429 to a
// SINGLE request, 403, HTML instead of JSON (the format is simply off), or
// nothing at all. Zero served JSON.
//
// That matters beyond one failing engine: searxng sits in the automatic
// fallback chain, so every fallback spent six pointless requests on third
// parties — up to 8s each when an instance hangs rather than refusing fast —
// before moving on. Emptying the list makes it fail instantly and honestly
// with "no instances configured", a case upstream already handles.
//
// The engine stays, because it is genuinely good against a SELF-HOSTED
// SearXNG, where JSON is enabled and no limiter is in the way. Point
// `searxngInstances` at your own in Settings > Plugins > Free Search. The
// upstream defaults, for reference: opnxng.com, priv.au, searx.be,
// searx.tiekoetter.com, search.inetol.net, paulgo.io.
host = rewrite(
  host,
  `const SEARXNG_INSTANCES = [\n  "https://opnxng.com",\n  "https://priv.au",\n`
  + `  "https://searx.be",\n  "https://searx.tiekoetter.com",\n`
  + `  "https://search.inetol.net",\n  "https://paulgo.io",\n];`,
  'const SEARXNG_INSTANCES = [];',
  'SearXNG default instance list',
)

// And tell the model the truth about it, so it stops picking an engine that
// cannot work until someone configures it.
host = rewrite(
  host,
  '"- searxng (meta-search, multi-instance) - FREE, no key",',
  '"- searxng (meta-search) - FREE, but ONLY with a self-hosted instance configured in settings; public instances do not serve the JSON API",',
  'SearXNG line in the system-prompt section',
)

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
