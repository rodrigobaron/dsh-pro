# dsh-pro

A personal [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
environment: standalone plugins, installed into a local `dsh` profile.

```bash
./install.sh
```

Each plugin is self-contained — nothing here depends on `reference/`, which
holds upstream checkouts consulted while porting and is not distributed.

## Plugins

DeepSeek Harness plugins developed in this workspace. One installer builds and
installs all of them.

```bash
./plugins/install.sh
```

Then restart the harness. The installer touches only the profile patch and
`profiles/node_modules`; it creates no agent preset and does not change which
preset is default.

## Plugins

| Directory | What it adds |
| --- | --- |
| `tool-file-canvas` | the `show_file` tool (behind the `file-artifacts` skill) and the contained `GET /canvas/file` reader |
| `client-ui-file-canvas` | the artifact panel and its renderers |
| `client-ui-layout-wide` | a wide, resizable details column |
| `context` | a context dashboard tab and the `/context` command |
| `git-review` | a Git tab: review the diff, stage, discard, commit, and push |
| `archived-sessions` | a session manager in Settings: browse, archive, and delete conversations |
| `vision-toolkit` | vision skills for the agent: image Q&A, OCR, grounding, pixel diff |
| `browser` | browser skills for the agent: open pages, read, click, fill, screenshot |
| `at-file` | `@path` references in the composer: a workspace path picker and filter settings |
| `search` | free web search: ten engines with automatic fallback, no API key |
| `notification` | desktop notifications when a session finishes a turn |
| `rewind` | a rewind button on every user message: drop it and everything after |
| `rewind-picker` | the `/rewind` command: pick the message to rewind to from a list |
| `routines` | scheduled agent routines: a cron engine that fires real sessions |
| `deep-research` | `/deep-research <topic>`: a controlled multi-round search loop |

## Adding a plugin

Add a directory. The installer discovers it — there is no list to update.

Most plugins here are built from `src/`. Four (`archived-sessions`,
`vision-toolkit`, `search`, `rewind`) are repackaged from upstream releases
rather than compiled: their published output is committed and the build script adapts it. Either
shape is just "a directory with a build script" as far as the installer is
concerned.

Repackaging exists because upstream plugins are installed by `dsh plugin add`,
which npm-installs their runtime dependencies into the profile. The harness
profile resolves only what it ships itself, so a plugin's own dependencies have
to arrive some other way or it dies at load with `ERR_MODULE_NOT_FOUND`. There
are two answers, and the first is almost always right:

- **Bundle it.** The build script inlines the dependency, and nothing extra is
  installed. `context`, `archived-sessions`, and `browser` all inline
  schemastery this way.
- **Carry it.** Anything listed in `dependencies` is copied, with its transitive
  closure, into `<plugin>/node_modules` in the profile. Reserve this for
  packages that genuinely cannot be bundled: `playwright-core` finds its driver
  and its browser builds relative to its own install path, so it has to exist as
  a real directory on disk.

A plugin directory holds a `package.json` and may contribute:

| File | Purpose |
| --- | --- |
| `package.json` | required. `name` decides the install path; a `scripts.build` entry is run first; `dependencies` are carried into the profile |
| `cordis.patch.yml` | loader rows merged into the profile patch |

**This repository creates no agent preset.** An agent-preset row is the
conventional way to give the model a tool, and it is what every shipped tool
plugin uses — but it confines the tool to presets that list it, and a preset
this repo owns is one more thing to install, rename, and orphan sessions with.

Instead, a plugin registers its tool into `agent.ctx.tools` when its skill
loads, reading the agent off `exec.agent` in a `tools/result` handler. The tool
then works under whatever presets the deployment already has — `standard`,
`code`, `minimal`, or the user's own — and costs nothing in agents that never
ask for it. `tool-file-canvas`, `vision-toolkit`, and `browser` all work this way.

Two traps worth knowing if you copy the pattern:

- `tools.restrict()` filters the **global** tool surface. It rejects an
  agent-scoped registration ("names unknown global tool"), and the throw lands
  inside your event handler. Gate by registering late, not by registering early
  and hiding.
- `SkillRegistration` requires `source` (use `'runtime'`). Omitting it registers
  the skill fine and fails only when the model tries to load it.

The profile patch and the preset are generated whole on every run, so
re-running never accumulates duplicate rows.

## Build

Plugins are either build-free (plain ESM committed as-is) or declare a
`scripts.build`. The installer runs `npm install` once if any plugin needs a
build, then builds each before installing.

The harness serves a client package's `./client` export **verbatim** — it does
not bundle — so a browser half must already be wrapped in the
`window.__ModuleLoader__.load({ id, factory })` closure form, resolving its
imports through the injected `require`. Both build scripts here do exactly
that; nothing else is required of them.

Build output is gitignored and reproduced by the installer.

Plugins built from `src/` also declare a `typecheck`. One command runs every
one that has it:

```bash
npm run typecheck
```

## The file artifact panel

Two triggers put a file on screen, and both produce the same envelope, so
there is a single render path:

- **the model calls `show_file`** — available under any preset, though hidden
  until the model loads the `file-artifacts` skill (see below). The envelope
  rides the tool result's
  `presentationMeta`, so the panel rebuilds from the session log alone and the
  file body never passes through the model;
- **you click a file path in the transcript** — resolved through
  `GET /canvas/file?path=…&meta=1`.

Images and PDFs carry a `url` rather than `content`, so the browser streams the
bytes instead of dragging base64 through the session log.

### Progressive exposure

`show_file` is registered into every agent and then immediately restricted with
`agent.ctx.tools.restrict({ deny: ['show_file'] })`, so it costs nothing in the
tool schema until it is wanted. Calling `skill('file-artifacts')` lifts the
restriction for that agent alone — `restrict` returns the disposer that lifts
it, so holding that disposer is what makes the reveal possible.

The skill body carries the guidance that would otherwise sit in the system
prompt, including the distinction that actually matters: `read` pulls a file
into the model's context, `show_file` puts it in front of the user and never
enters context. Neither implies the other.

### Containment

A path is readable only if it resolves inside the session's workspace, a
registered workspace, or the process cwd. Resolution goes through `ctx.fs`, so
symlink escapes are caught by the backend's canonicalization rather than by
prefix matching. Responses carry `nosniff` and a `sandbox` CSP, and workspace
HTML is served as `text/plain` — a file opened directly must never execute on
the app's origin.

### Extending

| Slot | Kind | Purpose |
| --- | --- | --- |
| `canvas.renderer` | keyed by envelope `type` | how to display a type |
| `canvas.chrome` | list | toolbar items |

To add a type: register a `canvas.renderer` under its key, and add the
extension to `tool-file-canvas/lib/filetype.js`.

## The Git review tab

Reviews the session's repository — the working directory of the session you are
in, not a global one, so two sessions in different workspaces review different
repos.

The host half serves a small JSON API under `/git`. Because these routes can
**write** to a repository, two guards apply:

- **Containment** — the directory must resolve inside a registered workspace or
  the process cwd, and be a git work tree. The client sends the directory, but
  the host re-validates it, so a wrong or forged value cannot reach outside.
- **Same-origin** — mutating routes require a custom header, which a
  cross-origin page cannot set without a preflight the server never answers.
  Without this, any site you visited could commit or push through loopback.

Git is invoked with an explicit argv array, never a shell string, so a branch
name or path can never be reinterpreted as shell syntax.

Discarding changes and pushing both require a confirming second click that
names what is about to happen. Discard is irreversible — uncommitted work is
not recoverable afterwards — and the server accepts only explicit paths, never
a "discard everything" flag.

Staging is per file. Hunk-level staging is not implemented.

## Browsing

`browser` drives a real Chromium tab through Playwright: open a page, read it as
an accessibility snapshot, click, fill, wait, manage tabs, screenshot. It is for
pages that must be *rendered* to be understood — client-side apps, a local dev
server, a visual check. The harness's own `web_search` still handles finding
things, and `web_fetch` stays disabled upstream.

Ten tools is a lot of permanent schema, so they are gated: they mount into an
agent only when it loads the `browser` skill, the same way `show_file` and the
vision tools do.

### Seeing the page

`browser_screenshot` writes a PNG and returns its path — it shows nobody
anything. The path is what makes it useful: the file lands under the **session
workspace** rather than the harness process cwd, which is what puts it inside
the artifact canvas's roots, so `show_file` can render it. Browse, screenshot,
show is the loop.

### Finding a browser

`playwright-core` downloads nothing at install time. On first use the plugin
tries its Playwright-managed Chromium, then an installed Chrome, then Edge, and
if all three are absent it says so and names the one command that fixes it
(`npx playwright install chromium`) rather than downloading software unasked.

The dependency is pinned to `~1.59.1` because that line expects the Chromium
build already present in most Playwright caches. Bumping it is safe — the worst
case is falling back to system Chrome.

### Limits

- **Loopback and private addresses stay reachable**, deliberately: testing a
  local dev server is the main reason to hand an agent a browser. The exception
  is cloud instance-metadata (`169.254.0.0/16`, `metadata.google.internal`),
  which nothing legitimate browses and which hands out credentials to anything
  that asks. That check reads the address as written — a DNS name resolving
  there still gets through, since catching that needs resolution-time
  interception this plugin does not do.
- **`userDataDir` may not be a real browser profile.** Upstream documents this;
  here it throws, because pointing automation at your Chrome profile silently
  hands it every session you are signed in to.
- **No page JavaScript evaluation.** There is no `browser_eval`, on purpose.
- **Page content is data.** The skill body says so to the model, which is a
  mitigation and not a guarantee. Anything consequential — submitting a form,
  entering personal data, downloading, granting a permission — is written as
  ask-the-user-first.

## The @ path picker

Type `@` in the composer to search the workspace and insert a path. Choosing a
result leaves the path visible in the draft and in a reference bar above it.

The point is what it does **not** do. It never reads the file. Before the agent
steps, the plugin checks the path still exists inside the workspace and adds one
line:

```xml
<workspace-reference path="docs/spec.pdf" kind="file" />
```

That is the whole payload — a path and a kind. The agent reads the file with
`read`, looks at it with `read_image`, or shows it to you with `show_file`, and
does so only if the task needs it. A 40 MB CSV costs the same as a one-line
config, and referencing ten files costs ten lines.

Pasted `@path` text stays plain text by default, so pasting a shell command
does not silently create references. **Settings -> File mentions** turns that
off, and holds the filename filters (exact or regex, global or per-workspace).

### Naming

The Typert identities are renamed to `@dsh-pro/at-file`. The registry rejects
duplicate package-face keys and duplicate invocation ids, so a fork keeping
upstream's `dsh-at-file` keys could not be installed beside the original. Both
halves build from one `src/contract.ts`, so they cannot drift apart.

One identity is deliberately left alone —
`@deepseek-ai/dsh-session/types#SessionId`. It has to equal the agent lookup
provider's wire identity, and it is not ours to rename.

### Type-checking against the running harness

The client half imports harness client packages for the module augmentations
that declare the composer slots it fills — without them, `conversation.input.dock`
is an unknown string and the file cannot check at all.

Neither usual answer works. Upstream resolves them with `link:` devDependencies
into a sibling harness monorepo, which this repository does not have. Installing
them from npm deadlocks: the published rc.7 packages peer `^0.1.0-rc.7`, npm
resolves that to rc.8, and rc.8 peers `^0.1.0-rc.8`, so the graph has no
solution. Pinning rc.8 installs, but then you are checking against a version
that is not the one running — worse than not checking.

So `typecheck` checks against the harness that IS running:

```bash
npm run typecheck --workspace=@dsh-pro/at-file
```

`scripts/link-harness.mjs` symlinks the installed harness packages into
`node_modules` first, preferring the profile's healed tree and falling back to
the npx cache. The types cannot drift from the deployment, because they are the
deployment. Symlinks rather than tsconfig `paths` keep ordinary resolution, so
each package's `exports` map still governs subpaths like
`@deepseek-ai/dsh-client-runtime/client`.

Only the packages it imports are linked. A partial scope directory does not
shadow the rest of `@deepseek-ai` — node resolves the full package path at each
level — so schemastery still comes from this repository's lockfile and the
build stays reproducible. `npm install` prunes the links, which is why
`typecheck` rebuilds them every run instead of assuming a setup step.

## Web search

`search` replaces the harness's default web search with ten free engines and
automatic fallback. The default provider needs a `DEEPSEEK_API_KEY`; these need
nothing.

### The row that makes it work

Upstream's own patch notes that `web.searchProvider` must point at its provider
id — then does not ship that override. dsh-base sets
`searchProvider: deepseek-official`, so a plain install leaves every search
still going to DeepSeek. The plugin looks installed and does nothing, which is
the worst kind of broken.

So this package's `cordis.patch.yml` carries the override itself:

```yaml
- id: web
  config:
    searchProvider: ddg
```

`ddg` there is the **provider id**, not the engine. Upstream registers one
provider under that id and routes internally to whichever engine the settings
name, so the row reads `ddg` whatever engine you pick.

Confirm it took with `dsh --profile web --dump-config`: the `web` row's
`searchProvider` should read `ddg`, not `deepseek-official`.

Note this row modifies a base row the plugin does not own — installing web
search takes over web search, which is the point. Removing the plugin
regenerates the patch without it, and the default comes back.

### English defaults

Upstream is tuned for Chinese. Four values carry that, and `scripts/build.mjs`
rewrites each as an asserted exact-string replacement, so a changed upstream
line fails the build instead of quietly shipping Chinese-first search:

| Value | Upstream | Here |
| --- | --- | --- |
| `ACCEPT_LANG` | `zh-CN,zh;q=0.9,en;q=0.8` | `en-US,en;q=0.9` |
| `lang` (settings UI) | `zh` | `en` |
| `bingMarket` | `zh-CN` | `en-US` |
| `region` (DuckDuckGo `kl`) | unset | `us-en` |

`ACCEPT_LANG` is the one that matters most: it goes out on every engine's
request through a single shared fetch helper, so it steers DuckDuckGo, Bing,
SearXNG and AnySearch alike — far more than any per-engine market setting.

The default **engine** changes for the same reason. Upstream picks Bing and
says why: "most stable, optimized for Chinese (`zh-CN`)". That reason does not
survive the switch — and Bing turns out to be the engine that gets answers
*wrong*, silently (see below).

Measured across three queries per engine, tracking availability and
correctness separately, because a returned result is not a right one:

| Engine | Available | Median | Honours `site:` | Answers a question |
| --- | --- | --- | --- | --- |
| `keenable` | 3/3 | 518ms | yes | yes |
| `anysearch` | 3/3 | 1317ms | yes | yes |
| `exa` | 3/3 | 1331ms | yes | yes |
| `tavily` | 3/3 | 1727ms | yes | yes |
| `bing` | 3/3 | 268ms | **no** | yes |
| `ddg` | 2/3 | 943ms | 403 | 403 |
| `ddg-lite` | 1/3 | 3234ms | rate-limited | rate-limited |

The default is `keenable`: fastest of the engines that are actually correct,
and keyless (`KEENABLE_API_KEY` only raises the quota). `ddg` held the spot
briefly on the strength of one good query, then spent the rest of the session
rate-limited. The fallback chain covers a bad day for any of them.

### The fallback chain

Without a time filter the chain is `[preferred, ...paid, ...free]`:

```
preferred -> exa -> tavily -> keenable -> perplexity -> deepseek-official
          -> bing -> anysearch -> ddg -> ddg-lite -> searxng
```

It stops at the first engine returning **more than zero** results — zero counts
as failure — under a 30s budget shared by the whole chain.

"Paid first" is not as odd as it reads. `exa`, `tavily`, and `keenable` all
work keyless (MCP or anonymous tier) and are always tried; a key raises their
quota rather than unlocking them. `perplexity` and `deepseek-official` are the
only two that need one, and without it they are skipped before any request, so
they cost nothing to leave in the chain.

One trap: with a `timeRange`, a preferred engine that cannot time-filter is
dropped from the chain **entirely**, not demoted. Prefer `bing` and ask for
last-week results and bing never runs.

Nothing else emits Chinese: every other Chinese string in the host half is a
comment, and the model-facing text — tool descriptions and the injected
system-prompt section — was already English. The browser half keeps both
dictionaries and switches on `lang`, so Chinese stays available and is simply
no longer the default.

### Bing ignores search operators

Bing does not honour `site:`, `filetype:` or `inurl:` for cookieless requests.
Verified with two header profiles including a full browser fingerprint: it
echoes the query back in `og:title`, then returns generic entity results. It
cannot be fixed from here.

What makes it worth a warning is that **it does not fail**. It returns a
confident, healthy-looking result set for a different query, so the automatic
fallback chain never fires and nothing downstream can tell. On
`site:linkedin.com/in Rodrigo Baron machine learning`, Bing returned ten Olivia
Rodrigo results; `tavily` and `exa` both returned the intended profile first.

Only the model can route around this, so the system-prompt section names the
limitation and the engines to use instead.

Bing results also used to carry `bing.com/ck/a?` redirect URLs rather than the
site found, because every organic result is wrapped in a redirect and the
scraper took the first href in the block. That broke `web_fetch` on a result,
broke dedup, and hid the domain. The build now decodes the destination from the
redirect's base64 `u` parameter, with `<cite>` as a fallback.

### Settings are durable — the patch only seeds a fresh install

`cordis.patch.yml` supplies the **initial** value of the settings namespace.
Once the namespace exists, the stored value wins and changing the patch does
nothing. So a default changed here reaches a new install but not an existing
one, and the engine actually in use is whatever **Settings -> Plugins -> Free
Search** says. Check there first when behaviour does not match the defaults
documented above.

### SearXNG needs your own instance

Upstream ships six public SearXNG instances and none of them work. It is not
rate limiting: SearXNG disables the JSON output format by default, and its bot
limiter rejects anonymous `format=json`. Probed 2026-08-20, all six upstream
defaults plus ten more public instances returned 429 to a **single** request,
403, HTML instead of JSON, or nothing at all. Zero served JSON.

That cost more than one dead engine, because `searxng` sits in the automatic
fallback chain — every fallback spent six pointless requests on third parties
before moving on. The default list is now empty, so it fails in milliseconds
with `no instances configured` instead, and the system prompt tells the model
the engine needs configuring rather than advertising it as free and keyless.

The engine itself is untouched and is genuinely good against a **self-hosted**
SearXNG, where JSON is on and no limiter is in the way. Point
`searxngInstances` at yours.

Engine, API keys, and cache TTL live in **Settings -> Plugins -> Free Search**,
or `/free-search-engine` in the composer. Editing the generated profile patch
is pointless — the installer rewrites it whole on every run.

## Desktop notifications

`notification` raises a browser notification when a session finishes a turn, so
you can switch tabs and still know when DSH is done. The host half only
registers the `notification` session projection — a bounded summary of each
session's last completed turn; the browser half decides what to show and calls
the Notification API. **Settings -> Notifications** holds the per-outcome
toggles and the include/exclude keyword rules, and grants browser permission.

Two notes from porting it:

- **The tsconfig mirrors upstream's rather than this repository's stricter
  default.** Turning on `noUncheckedIndexedAccess` for code never written
  against it produced ten complaints that were style, not defects; silencing
  them one at a time would have turned a port into a rewrite.

- **One real type fix.** `observedTurn` was declared `Map<string, number>`
  while `state.ids` carries a branded `SessionId`, so it did not check against
  the harness actually installed here. The same file already uses
  `Map<SessionId, ...>` for the pending runner two functions down, so this was
  its own odd case out. Runtime behaviour is identical — a brand is erased —
  but this is exactly the drift that type-checking against the *running*
  harness is meant to catch, rather than against whatever a monorepo checkout
  happened to have.

### Diagnosing a notification that never appears

Two code paths used to produce an **empty console**, and they mean opposite
things: the browser accepted the notification and the OS dropped it, versus the
code never ran at all. Both now log, so one line in DevTools identifies which:

| Console line | Meaning |
| --- | --- |
| `test skipped: browser permission is "denied"` | Permission is not actually granted, whatever the panel shows. The settings section returns before ever calling `show()`. |
| `shown: <title> (tag=...)` | The browser constructed it successfully. If nothing appeared on screen, the block is below the browser — on macOS, **System Settings -> Notifications -> [browser]**, or a Focus mode. |
| `notification creation failed: ...` | The constructor threw; the message says why. |
| `turn N <session>: ... show=false (...)` | A completion was decided against. The line prints every input — permission, `backgroundOnly`, `hidden`, and which session is in view. |
| nothing at all | The completion never reached the runner: the host projection did not advance. |

The last row is the one that would indicate a real defect here; the others are
environment or settings.

The plugin also now claims its own `<style>` tag with `data-plugin`. Upstream
leaves it unset and the harness then attributes the stylesheet to whichever
plugin happened to be loading — it showed up in the DOM as `@dsh-pro/git-review`
owning the notification rules.

## Rewinding the conversation

Two entry points, one route:

- **`rewind`** puts a button on every user message. Click it, confirm, and that
  message and everything after it leave the conversation — from the transcript
  and from what the model sees — while its text returns to the composer for
  editing.
- **`rewind-picker`** adds `/rewind`, which opens a dialog listing the user
  messages newest first so you can pick one without hunting for its button.

Both POST `/rewind`, which appends a durable `session/recall` tombstone. The
log keeps every event, so this survives a restart.

### How it works without `session.recall()`

Upstream's host calls `session.recall()`. That is core runtime support rather
than a plugin seam — its own README says so — and **no published harness has
ever shipped it**: rc.7 has no such method, and a grep of rc.8 finds no match
either. So the host here is ours, and uses public API only.

The model-visible history is a **surface** projected over the append-only log,
and a surface event may enter as a replacement: `{ op: 'replace', start, end }`
substitutes one node for a whole range. Compaction uses exactly this to swap a
stretch of history for a summary, and the type documentation states that "any
surface-replacing producer may use it". A rewind replaces
`[boundary .. last surface node]` with a single marker, so `deriveMessages()`
stops projecting the rewound turns.

Two consequences follow from the mechanism, and both are deliberate:

- **The op cannot empty a range** — a replacement always leaves exactly one
  node. That node is a marker saying the conversation was rewound and how many
  messages went with it. The model reads it on purpose: a silently shorter
  history invites it to re-derive conclusions it has no record of reaching.
- **Nothing is deleted.** Every original event stays in the log and no file is
  touched. `planRewind` is the part where an off-by-one would shadow the wrong
  range irreversibly, so it is pure and unit-tested
  (`npm run test --workspace=@dsh-pro/rewind`).

### Hiding the rewound messages

The rewind is real for the model, but the transcript is a different projection.
The harness's docs are explicit that "a human transcript must project
append-origin events rather than `session.surface`, because landed replacements
shadow history the reader already saw" — so the rewound exchange keeps
rendering, exactly as compaction leaves everything visible after summarizing.

There is no supported filter for this: the client runtime has no hook that
drops a chat node, and a slot entry can only *replace* a keyed renderer, never
filter one and fall through for the rest. So `rewind-picker` hides the rows in
the DOM, driven by the ids the host reports.

That means coupling to two framework attributes, `data-chat-flow-kind` and
`data-chat-flow-key`. **If either changes, hiding silently stops and the
rewound messages reappear** — which is the safe direction to fail in: the
model's history is still correct, the reader just sees more than intended.

It walks the flow rather than writing a stylesheet, because only *user* rows
carry a durable message id in their key. Assistant steps and tool calls are
keyed by turn and call id, so they cannot be selected directly; walking in
order with a "currently inside a rewound turn" flag identifies them by position
and stops at the next surviving user message. That last part is what keeps
messages sent *after* a rewind visible.

A `MutationObserver` re-applies it, because the flow rebuilds its rows on every
snapshot change and drops the inline styles. On mount the client asks the host
(`POST /rewind {query:true}`) which messages are rewound, so a reload does not
resurrect them. Only rewind's own markers count — compaction shadows surface
nodes too, and its summaries are meant to stay visible.

### The two bundles have to talk

The button and the picker are separate bundles that share only the route, so a
rewind from the button was invisible to the picker: its hidden set stayed stale
until a reload re-queried it, which is why the button used to need an F5 and
the command did not. The button's bundle now dispatches
`my-dsh:rewound` on the window when a rewind commits, and the picker re-reads
the state. A DOM event is the smallest thing that crosses the gap without a
shared module.

The host reports the same state two ways for two consumers: **ids**, which the
transcript hiding keys rows by, and **seqs**, which the picker uses to drop
already-rewound messages from its list — offering one again could only produce
a refusal, since it is no longer a surface node.

### Giving the composer back

A rewind puts the message back in the composer to edit. From the command that
needed two things the first pass missed.

`sessions` has to be in the client plugin's `inject` list. `restoreDraft`
resolves the composer through `ctx.sessions.scope(sessionId)`, and without the
injection that is `undefined` — so the restore returned false and did nothing,
silently, while the button path (which never had a token in the way) looked
fine.

The `/rewind` token also has to be consumed, the same way `/context` does it:
the token stays in the composer while the dialog is open, and closing
dispatches `slash/input-consume-token` with a guard recorded at open time — a
span CAS for a menu pick, bare-token equality for Enter. A stale guard fails
soft inside the shell and leaves a draft the user edited alone. Closing happens
*before* the restore, so consuming the token cannot edit the text the restore
just wrote.

### Dialog layout

The overlay slot renders inside the composer's container, so an absolutely
positioned scrim covers the input area and the dialog opens at the bottom of
the page. `position: fixed` escapes that anchor and centres it — which is
exactly what the `/context` modal does, and for the same reason. The styles
also use the harness's real `--dsw-alias-*` tokens (`bg-layer-1/2`,
`border-l1`, `label-primary/secondary`, `interactive-bg-hover`,
`brand-primary`); an invented token name falls through to its fallback colour
and the dialog quietly stops following the theme.

### The node shape trap

The conversation snapshot's nodes are **flat** — `{ kind, seq, content, time }`.
The `conversation.chat.node` slot hands its renderer a `{ node: { data } }`
wrapper instead, and assuming that wrapper applies to the snapshot too produces
a picker that finds 97 nodes and zero messages, with no error anywhere. If you
read nodes from a snapshot, read the fields off the node.

## Routines

A cron engine that fires real agent sessions. It lives in the `dsh web` host
process, so routines keep firing with the browser closed — and stop entirely
when the service does.

Each routine has a 5-field cron schedule and one of three targets: a project
directory (a fresh session there each run, loading its AGENTS.md), a pinned
session (the same conversation each run, keeping its context), or neither (a
new conversation in the default workspace).

Manage them in **Settings -> Routines**, with the model-facing `routines` tool,
over `/api/routines/*`, or by editing `~/.dsh/routines/jobs.json`. One ledger,
four doorways. Each routine also picks its own agent preset and model, or
inherits the deployment default.

### No sidebar

Upstream mounts a sidebar entry and a jobs board. This build carries neither —
the whole of its `src/client/` is dropped, and with it the CSS-module build
step the board needed. The settings section is ours, which is why the
conversation surface is untouched.

### What the port keeps

The engine, which is the reason to port rather than rewrite: at-most-once
firing (`nextRunAt` rolls forward *before* a run, so a crash mid-run cannot
double-fire), skip-while-running, atomic ledger writes that degrade safely on a
corrupt file, and cron parsing with local-time semantics.

Inherited limits worth knowing: firing needs the service alive, a slot missed
while it was down stays missed rather than backfilling, and every run costs API
quota with nobody present — so a routine prompt must be self-contained and must
never ask a question.

### Choosing project, preset, and model

The new-routine form has three selects, all fed by the host:

| Select | Source |
| --- | --- |
| Project | `GET /api/routines/workspaces` |
| Agent preset | `GET /api/routines/presets` |
| Model | `GET /api/routines/model-options` |

All three are **required**, and each opens on a disabled `Select…` placeholder
rather than a usable default. A routine runs unattended on a schedule, so where
it runs, what it can do, and what it costs should each be a decision someone
made — a pre-selected "default" is too easy to leave untouched and then wonder
where the run happened. Create stays disabled until every field is set.

The presets route is new — upstream had no per-routine preset, so every run
mounted the roster default. A routine may now name one, and `resolve(id)` falls
back to the default when a pinned preset was later deleted, so the routine
still runs rather than failing every tick. Broken compositions are filtered out
rather than offered.

Two things the raw data needed before it was usable:

- **Preset names arrive in Chinese.** The roster reports Simplified Chinese
  names for the four built-ins
  and so on regardless of interface language; the harness's own picker does not
  show those either, it carries its own labels. This select matches them, so it
  says what the rest of the GUI says. Anything not built-in keeps the name its
  author chose.
- **The catalog cannot say which models work.** Every provider route
  enumerates its models whether or not a key is stored for it, and `failures`
  stays empty because enumeration itself succeeds. A routine pointed at a
  keyless provider therefore creates cleanly and then fails at *every* fire
  with `no API key for provider route "..."`. Nothing in the payload
  distinguishes them, so the deployment default is listed first and labelled —
  it is by construction the configured route — and the help text says the rest
  need their key on the Models page.
- **The model catalog contains duplicates.** Other plugins register their own
  provider routes into it — vision-toolkit mirrors every provider as
  `vision-toolkit-<id>` with the same display name and models — so each model
  appeared twice under an identical label. Deduped by what the user actually
  sees, first wins, which keeps the primary routes.

### Editing and session naming

Every card has **Edit**, which reopens the same form pre-filled from the record
and saves with `PATCH`. The card being edited is hidden while the form is open,
so one routine is never on screen twice inviting an edit of the stale copy. A
`PATCH` carrying a cron re-arms the schedule, so an edited routine's next run is
recomputed rather than left on its old slot.

A routine's new sessions are named **⏰ <routine title>**. Without it the
auto-titler names them from the routine's own prompt, and a sidebar full of
scheduled runs reads like a sidebar full of ordinary conversations. `rename()`
*pins* the title, so the generator does not overwrite it after the first turn.
Only new sessions are named — a routine pinned to an existing conversation is a
guest there, and renaming someone's session out from under them is not this
plugin's business.

### The silent-field traps

`PATCH /api/routines/jobs` ignores fields it does not recognise and still
answers `200`. That bit twice while building the form:

- Pausing is `scheduleEnabled`, not `enabled`.
- The project is `target.workdir`, not a root `workdir` — the flat form created
  routines with no project at all, and reported success doing it.

Both look like working requests that change nothing, so check a create or patch
against the returned record rather than the status code.



`PATCH /api/routines/jobs` ignores fields it does not recognise and still
answers `200`. Pausing a routine is `scheduleEnabled`, not `enabled`; sending
the wrong key looks like a working request that changes nothing, which is
exactly how it presented.

## Deep research

`/deep-research <topic>` runs a controlled search loop as a workflow, instead
of a few searches and a summary.

### The design

A research loop is a control system, and saying so gives the model a fan-out
rule and a stopping rule it would otherwise improvise:

- **Requisite variety** — a regulator needs as much variety as the system it
  regulates, so each round fans out across *different modalities* (definitional,
  adversarial, temporal, community, comparative) rather than rephrasing one
  query five times.
- **Information gain is the control signal** — a round is judged by new claims
  and new independent sources, not by how many results came back.
- **Stop on marginal gain** — the loop ends after two consecutive rounds that
  add nothing new. A fixed round count either stops mid-question or burns quota
  on a finished one.
- **Redundancy against a noisy channel** — corroboration across sources that
  did not copy each other. Two sites quoting one press release are one source.
- **Feedback closes the loop** — a critic names what is still missing, and
  those gaps *are* the next round's queries.

Claims come back tagged **corroborated**, **single-source**, or **contested**,
and contested is reported as a finding rather than averaged into a bland
middle.

### How it is wired

The command is expanded **host-side** at `agent/pre-step`, the same shape
`at-file` uses for `@path`. Typing `/deep-research <topic>` sends an ordinary
message; the host recognizes it and appends one instruction naming the
`deep-research` skill. The transcript keeps showing what you typed, no extra
turn is spent, and the command works from a pasted message or a routine prompt
as readily as from the composer. The browser half only adds the `/` menu entry
— it deliberately does not intercept Enter.

The methodology lives in the skill, not in the injected message, so changing it
reaches every invocation.

The skill is registered **model-facing only**:

```ts
invocation: { modelInvocable: true, userInvocable: false }
```

Omitting `invocation` permits both surfaces, which put a second `deep-research`
in the `/` menu beside the command — two entries for one feature, and the skill
one only loads the instructions without a topic. The harness ships no
deep-research skill of its own; both entries came from this plugin. The model
still loads the skill by name; the human entry point is the command.

Picking the command returns `{ text: '/deep-research ' }` — a `PickOutcome`
that replaces the trigger token. Returning `undefined` reads as "not handled",
which is why the entry was visible but unselectable at first. The trailing
space is load-bearing: `/deep-researchtopic` is a different word and the host's
parser rejects it.

### Search is snippet-only

Searches run through `@dsh-pro/search`'s free engines: `web_search` (routed
there by the `web` seam), plus `advanced_search` for time filtering and
`platform_search` for GitHub and Reddit.

**There is no page fetch.** `dsh-base` sets `fetch: false` and no fetch
provider is mounted, so the loop sees titles, URLs and snippets — never a full
page. That is the biggest constraint on what a result can claim, and the skill
says so explicitly rather than letting the model write as though it had read
its sources. It also shapes the design: a low-bandwidth channel is answered
with more angles and more corroboration.

### Two layers that look alike but are not

`web.searchProvider: ddg` is the **seam provider id** — upstream registers a
single provider object under that name and routes all ten engines through it.
The **engine** is a separate setting (`keenable` by default here). Changing the
seam id to an engine name would leave `ctx.web` with no provider at all.

## Language

### The primitives default to Chinese

`CodeBlock`, the fenced blocks inside `MarkdownText`, and `HoverCard` default
their copy labels to Simplified Chinese:

```js
function CodeBlock({ code, lang, className, copyLabel = <Chinese>, copiedLabel = <Chinese> })
```

These are **parameter defaults, not localized strings** — they ignore the
interface language entirely, so any caller that omits them ships Chinese into
an English UI. That is how a Markdown artifact came to render its code fences
with a Simplified Chinese copy button.

Passing the labels is the only fix available from a plugin. `MarkdownText`
takes `codeLabels: { copyLabel, copiedLabel }`, which reaches the fences it
renders internally. This repository keeps one `CODE_LABELS` constant so a whole
file rendered as code and a fence inside a Markdown file cannot drift apart.

The harness also defaults a reconnect banner to
a Simplified Chinese string. Nothing here renders it, and no plugin can override
a component it does not call — if it appears while disconnected, that is
upstream's string.


This repository writes English only, and English is the default. It does not
**force** English. The harness keeps its own language selector, and a user who
has configured Chinese keeps Chinese — that setting is theirs to make.

Those two facts have to coexist, and here is how. Every client plugin here
registers its English dictionary under *both* locale ids:

```ts
ctx.locale.register(NS, { en: DICT_EN, zh: DICT_EN })
```

Selecting Chinese then leaves the harness's own interface in Chinese and these
plugins in English. The alternative is worse: an unregistered `zh` namespace
renders raw message keys like `git.commit.button`. Showing English is honest
about there being no translation; showing keys is just broken.

An earlier `english-only` plugin pinned the locale instead. Pinning froze the
UI, and it overrode a choice belonging to the user, so it is gone. Nothing
replaced it, because nothing needed to: what keeps the repository English is
that only English is written, not a switch that prevents anything else.

The repackaged plugins arrived with Chinese dictionaries, which a locale of
`zh` would have selected. That Chinese has been removed or translated, so
switching languages no longer resurrects it.

Chinese survives in four places, all of them deliberate:

| File | Why |
| --- | --- |
| `vision-toolkit/upstream/vendor/agent-vision-toolkit/**` | hash-verified. `UPSTREAM_MANIFEST.json` records each file's sha256 and an aggregate the plugin checks at load; editing one stops the tools mounting |
| `vision-toolkit/upstream/lib/upstream.js` | a regex matching a Simplified Chinese label in the Python worker's OUTPUT. The worker is hash-locked, so translating the matcher would stop it parsing |
| `vision-toolkit/upstream/patches/*.patch` | a patch's context lines must match the file it applies to |
| `vision-toolkit/upstream/assets/skill/references/restore-ui.md` | tracked with a sha256 in `assets/skill/UPSTREAM.json` |

The rule is: Chinese we *emit* is gone; Chinese that *matches someone else's
bytes* stays, because changing it would silently break the match.

## Thanks

This repository stands on other people's work. Nine of its plugins began as
someone else's, and the ones written from scratch were shaped by reading them.

- [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) —
  the context dashboard and the `/context` command.
- [Zephyr-vibe/dsh-archived-sessions](https://github.com/Zephyr-vibe/dsh-archived-sessions) —
  session management, disk accounting, and lineage.
- [Anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) and the
  `agent-vision-toolkit` it packages — eyes for a text-only agent.
- [omdsh-dev/dsh-at-file](https://github.com/omdsh-dev/dsh-at-file) — `@path`
  references, and the pre-step injection pattern `deep-research` borrows.
- [DDDMUC/dsh-free-search](https://github.com/DDDMUC/dsh-free-search) — ten
  search engines with no API key, and the fallback chain behind them.
- [omdsh-dev/dsh-notification](https://github.com/omdsh-dev/dsh-notification) —
  desktop notifications and their rule engine.
- [omdsh-dev/dsh-recall](https://github.com/omdsh-dev/dsh-recall) — conversation
  rewind, and the user-bubble renderer it shadows to place a button there.
- [linxin666/dsh-timer-agent](https://github.com/linxin666/dsh-timer-agent) —
  the scheduled-agent engine, and its at-most-once firing discipline.
- [Clizo1209/dsh-playwright-browser](https://github.com/Clizo1209/dsh-playwright-browser) —
  browser automation with semantic locators.

Thanks also to [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent),
whose cron design `dsh-timer-agent` follows and which therefore shapes
`routines` here, and to the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) team, whose
plugin seams made every one of these possible without a fork.

Each derived plugin keeps its upstream LICENSE and carries a NOTICE recording
exactly what changed and why.

## Licensing

Eight plugins here are derived from other people's work. Each keeps its upstream
LICENSE, and a NOTICE recording exactly what was changed:

| Plugin | Upstream | License |
| --- | --- | --- |
| `context` | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | Apache-2.0 |
| `archived-sessions` | [Zephyr-vibe/dsh-archived-sessions](https://github.com/Zephyr-vibe/dsh-archived-sessions) | MIT |
| `vision-toolkit` | [Anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | MIT |
| `at-file` | [omdsh-dev/dsh-at-file](https://github.com/omdsh-dev/dsh-at-file) | MIT |
| `search` | [DDDMUC/dsh-free-search](https://github.com/DDDMUC/dsh-free-search) | MIT |
| `notification` | [omdsh-dev/dsh-notification](https://github.com/omdsh-dev/dsh-notification) | MIT |
| `rewind` | [omdsh-dev/dsh-recall](https://github.com/omdsh-dev/dsh-recall) | MIT |
| `routines` | [linxin666/dsh-timer-agent](https://github.com/linxin666/dsh-timer-agent) | MIT |
| `browser` | [Clizo1209/dsh-playwright-browser](https://github.com/Clizo1209/dsh-playwright-browser) | MIT |

Everything else in this directory is MIT and original to this repository.
