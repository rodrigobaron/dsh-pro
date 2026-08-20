#!/usr/bin/env node
/**
 * @my-dsh/rewind build.
 *
 *   lib/index.js  — host half: vendor/index.js, repackaged. Upstream ships it
 *                   prebuilt with no sources, so vendor/ holds its published
 *                   output verbatim and the edits below are asserted
 *                   exact-string rewrites; a changed upstream line fails the
 *                   build rather than shipping something unintended.
 *   lib/client.js — client half: vendor/client.js, repackaged the same way.
 *
 * Nothing is compiled here. The `/rewind` command and its picker live in the
 * companion @my-dsh/rewind-picker package, which drives this plugin's route.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

await mkdir(join(ROOT, 'lib'), { recursive: true })

/**
 * Apply one exact-string rewrite to vendored output, or fail.
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

// ── host half ────────────────────────────────────────────────────────────────
let host = await readFile(join(ROOT, 'vendor', 'index.js'), 'utf8')
host = rewrite(host, 'const name = "recall";', 'const name = "rewind";', 'cordis plugin name')
host = rewrite(host, 'path: "/recall",', 'path: "/rewind",', 'route path')
// The one Chinese fragment in the host half is a parenthetical gloss in the
// module docstring; this repository writes English only.
host = rewrite(host, 'Message recall (撤回) for the DSH Web UI.', 'Message rewind for the DSH Web UI.', 'docstring gloss')
// A capability check, because the failure is otherwise unreadable.
//
// `session.recall()` is core runtime support, not a plugin seam — upstream's
// own README says so. It does not exist in @deepseek-ai/dsh-session rc.7, and
// grepping rc.8 finds no match either, so no published harness has it. Without
// this check the route reaches the call and returns the raw TypeError, which
// reads as "Recall failed: agent.session.recall is not a function" and looks
// like a bug in this plugin rather than a missing runtime feature.
host = rewrite(
  host,
  '\t\t\ttry {\n\t\t\t\tconst logged = agent.session.recall(boundary);',
  `\t\t\tif (typeof agent.session.recall !== "function") {
\t\t\t\tsendJson(res, 501, errorBody("rewind-unsupported", "this DeepSeek Harness build has no session recall support, which is core runtime behaviour rather than something a plugin can provide", { sessionId }));
\t\t\t\treturn;
\t\t\t}
\t\t\ttry {
\t\t\t\tconst logged = agent.session.recall(boundary);`,
  'session.recall capability check',
)

await writeFile(join(ROOT, 'lib', 'index.js'), host)

// ── client half ──────────────────────────────────────────────────────────────
// Kept from upstream rather than rewritten. The rewind button lives on every
// user message, which means shadowing the framework's keyed user-bubble
// renderer and reproducing the bubble — images, lightbox, content blocks and
// all. Upstream already does that faithfully; redoing it would be risk without
// benefit. Only identity, the route, and the language default move.
let client = await readFile(join(ROOT, 'vendor', 'client.js'), 'utf8')

// The boot manifest looks a bundle up by the installed package name.
client = rewrite(client, 'id: "dsh-recall",', `id: ${JSON.stringify(pkg.name)},`, 'client bundle loader id')

// The host route moved with the plugin.
client = rewrite(client, 'fetch("/recall", {', 'fetch("/rewind", {', 'client route')

// English under BOTH locale ids. Upstream registers a Simplified Chinese
// dictionary alongside English; this repository writes English only, and an
// unregistered namespace renders raw message keys, which is worse than
// English for a reader who selected Chinese.
client = rewrite(
  client,
  'ctx.effect(() => locale.register(NS, {\n\t\t\t\tzh,\n\t\t\t\ten\n\t\t\t}), "dsh-recall: dictionaries");',
  'ctx.effect(() => locale.register(NS, {\n\t\t\t\tzh: en,\n\t\t\t\ten\n\t\t\t}), "rewind: dictionaries");',
  'locale registration (effect path)',
)
client = rewrite(
  client,
  'else locale.register(NS, { zh, en });',
  'else locale.register(NS, { zh: en, en });',
  'locale registration (fallback path)',
)

// Claim the stylesheet, so the plugin inventory does not attribute these rules
// to whichever plugin happened to be loading.
client = rewrite(client, 'tag.dataset.plugin = "dsh-recall";', `tag.dataset.plugin = ${JSON.stringify(pkg.name)};`, 'stylesheet owner attribute')
client = rewrite(client, 'const CSS_TAG = "dsh-recall/Recall.module.css";', 'const CSS_TAG = "@my-dsh/rewind/Rewind.module.css";', 'stylesheet tag')
client = rewrite(client, '"[dsh-recall] draft restore failed:"', '"[rewind] draft restore failed:"', 'log prefix')

// User-facing copy follows the plugin's name. Upstream says "recall"; the
// button, the confirmation, and the tombstone notice all now say "rewind", so
// the UI and the /rewind command agree with each other.
client = rewrite(
  client,
  '"action": "Recall this turn",',
  '"action": "Rewind to here",',
  'button label',
)
client = rewrite(
  client,
  '"confirmTurn": "Recall this turn and everything after it? The message will be restored to the input box for editing and resending. Any code or file changes it produced will NOT be reverted.",',
  '"confirmTurn": "Rewind to this message? It and everything after it leave the conversation, and its text returns to the composer for editing. File changes are NOT undone \\u2014 code the agent wrote stays exactly as it is.",',
  'confirmation copy',
)
client = rewrite(client, '"notice": "Recalled message",', '"notice": "Rewound from here",', 'tombstone notice')
client = rewrite(
  client,
  '"errorBusy": "The agent is running; stop the current turn before recalling",',
  '"errorBusy": "The agent is running; stop the current turn before rewinding",',
  'busy message',
)

await writeFile(join(ROOT, 'lib', 'client.js'), client)

// ── smoke checks ─────────────────────────────────────────────────────────────
const outHost = await readFile(join(ROOT, 'lib', 'index.js'), 'utf8')
const outClient = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')
for (const [label, source, expected] of [
  ['lib/index.js', outHost, ['function apply', '"/rewind"', 'session.recall(boundary)']],
  ['lib/client.js', outClient, ['__ModuleLoader__', `id: "${pkg.name}"`, 'fetch("/rewind"']],
]) {
  for (const needle of expected) {
    if (!source.includes(needle)) throw new Error(`build: ${label} is missing ${needle}`)
  }
}
for (const [label, source] of [['lib/index.js', outHost], ['lib/client.js', outClient]]) {
  if (source.includes('"/recall"') || source.includes('fetch("/recall"')) {
    throw new Error(`build: the old /recall route survived in ${label}`)
  }
  if (source.includes('"dsh-recall"')) throw new Error(`build: dsh-recall survived as an id in ${label}`)
}
console.log(`built ${pkg.name}:`)
console.log(`  lib/index.js  (host half, repackaged, route /rewind) ${(outHost.length / 1024).toFixed(0)} kB`)
console.log(`  lib/client.js (client half, repackaged, per-message rewind buttons) ${(outClient.length / 1024).toFixed(0)} kB`)
