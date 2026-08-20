# my-dsh plugins

DeepSeek Harness plugins developed in this workspace. One installer builds and
installs all of them.

```bash
./plugins/install.sh
```

Then restart the harness.

## Plugins

| Directory | What it adds |
| --- | --- |
| `tool-file-canvas` | the `show_file` tool (behind the `file-artifacts` skill) and the contained `GET /canvas/file` reader |
| `client-ui-file-canvas` | the artifact panel and its renderers |
| `client-ui-layout-wide` | a wide, resizable details column |
| `context` | a context dashboard tab and the `/context` command |
| `english-only` | pins the interface to English and removes the language selector |
| `git-review` | a Git tab: review the diff, stage, discard, commit, and push |
| `archived-sessions` | a session manager in Settings: browse, archive, and delete conversations |
| `vision-toolkit` | vision skills for the agent: image Q&A, OCR, grounding, pixel diff |

## Adding a plugin

Add a directory. The installer discovers it — there is no list to update.

Most plugins here are built from `src/`. Two (`archived-sessions`,
`vision-toolkit`) are repackaged from upstream releases rather than compiled:
their published output is committed and the build script adapts it. Either
shape is just "a directory with a build script" as far as the installer is
concerned.

Repackaging exists because upstream plugins are installed by `dsh plugin add`,
which npm-installs their runtime dependencies into the profile. This installer
only copies files, so a plugin's unresolvable dependencies are inlined at build
time instead — otherwise it dies at load with `ERR_MODULE_NOT_FOUND`.

A plugin directory holds a `package.json` and may contribute:

| File | Purpose |
| --- | --- |
| `package.json` | required. `name` decides the install path; a `scripts.build` entry is run first |
| `cordis.patch.yml` | loader rows merged into the profile patch |
| `agent.preset.yml` | rows appended to the `artifacts` agent preset |

`agent.preset.yml` is the conventional way to add a model-facing tool, and it
is what every shipped tool plugin uses — but it confines the tool to presets
that list it.

There is a second route, and it is usually the better one: a **profile** plugin
can inject `agents`, watch `agent/created`, and register into that agent's own
`agent.ctx.tools`. The tool then exists under every preset. `tool-file-canvas`
and `vision-toolkit` both do this; nothing here uses `agent.preset.yml` any
more, though the installer still supports it.

The plugin inventory shows the difference plainly: a preset-mounted tool such
as `dsh-tool-bash` sits at fiber phase `null` until an agent instantiates it,
while a profile-mounted one is `active` from boot.

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

## Language

English is the only interface language. `english-only` pins the locale and
shadows the language selector, taking the `language` seat in the
`settings.general.item` slot at a lower priority — the framework's documented
way to replace a row it already owns.

Pinning is what actually guarantees English: the repackaged plugins arrived
with Chinese dictionaries, and a locale of `zh` would select them. Their
Chinese has since been removed or translated, so both the pin and the source
agree.

Four files still contain Chinese, deliberately:

| File | Why |
| --- | --- |
| `vision-toolkit/.../vendor/agent-vision-toolkit/**` | hash-verified. `UPSTREAM_MANIFEST.json` records each file's sha256 and an aggregate the plugin checks at load; editing one stops the tools mounting |
| `vision-toolkit/upstream/lib/upstream.js` | a regex matching `bbox (原图像素)` in the Python worker's OUTPUT. The worker is hash-locked, so translating the matcher would stop it parsing |
| `vision-toolkit/upstream/patches/*.patch` | a patch's context lines must match the file it applies to |
| `vision-toolkit/.../assets/skill/references/restore-ui.md` | tracked with a sha256 in `assets/skill/UPSTREAM.json` |

The rule is: Chinese we *emit* is gone; Chinese that *matches someone else's
bytes* stays, because changing it would silently break the match.

## Licensing

Two plugins here are derived from other people's work. Each keeps its upstream
LICENSE, and a NOTICE recording exactly what was changed:

| Plugin | Upstream | License |
| --- | --- | --- |
| `context` | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | Apache-2.0 |
| `archived-sessions` | [Zephyr-vibe/dsh-archived-sessions](https://github.com/Zephyr-vibe/dsh-archived-sessions) | MIT |
| `vision-toolkit` | [Anionex/dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit) | MIT |

Everything else in this directory is MIT and original to this repository.
