# my-dsh plugins

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

## Adding a plugin

Add a directory. The installer discovers it — there is no list to update.

Most plugins here are built from `src/`. Three (`archived-sessions`,
`vision-toolkit`, `search`) are repackaged from upstream releases rather than
compiled: their published output is committed and the build script adapts it. Either
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

The Typert identities are renamed to `@my-dsh/at-file`. The registry rejects
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
npm run typecheck --workspace=@my-dsh/at-file
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
survive the switch. Measured on "what is the capital of Portugal", DuckDuckGo
returned `en.wikipedia.org/wiki/Lisbon` first; Bing returned Capital One and a
UK radio station behind `bing.com/ck/a` redirect wrappers. DuckDuckGo
rate-limits more often, which the fallback chain already handles by moving on.

Nothing else emits Chinese: every other Chinese string in the host half is a
comment, and the model-facing text — tool descriptions and the injected
system-prompt section — was already English. The browser half keeps both
dictionaries and switches on `lang`, so Chinese stays available and is simply
no longer the default.

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

## Language

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
| `vision-toolkit/upstream/lib/upstream.js` | a regex matching `bbox (原图像素)` in the Python worker's OUTPUT. The worker is hash-locked, so translating the matcher would stop it parsing |
| `vision-toolkit/upstream/patches/*.patch` | a patch's context lines must match the file it applies to |
| `vision-toolkit/upstream/assets/skill/references/restore-ui.md` | tracked with a sha256 in `assets/skill/UPSTREAM.json` |

The rule is: Chinese we *emit* is gone; Chinese that *matches someone else's
bytes* stays, because changing it would silently break the match.

## Licensing

Six plugins here are derived from other people's work. Each keeps its upstream
LICENSE, and a NOTICE recording exactly what was changed:

| Plugin | Upstream | License |
| --- | --- | --- |
| `context` | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | Apache-2.0 |
| `archived-sessions` | [Zephyr-vibe/dsh-archived-sessions](https://github.com/Zephyr-vibe/dsh-archived-sessions) | MIT |
| `vision-toolkit` | [Anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | MIT |
| `at-file` | [omdsh-dev/dsh-at-file](https://github.com/omdsh-dev/dsh-at-file) | MIT |
| `search` | [DDDMUC/dsh-free-search](https://github.com/DDDMUC/dsh-free-search) | MIT |
| `browser` | [Clizo1209/dsh-playwright-browser](https://github.com/Clizo1209/dsh-playwright-browser) | MIT |

Everything else in this directory is MIT and original to this repository.
