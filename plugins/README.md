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
| `tool-file-canvas` | the `show_file` tool and the contained `GET /canvas/file` reader |
| `client-ui-file-canvas` | the artifact panel and its renderers |
| `client-ui-layout-wide` | a wide, resizable details column |
| `context` | a context dashboard tab and the `/context` command |

## Adding a plugin

Add a directory. The installer discovers it — there is no list to update.

A plugin directory holds a `package.json` and may contribute:

| File | Purpose |
| --- | --- |
| `package.json` | required. `name` decides the install path; a `scripts.build` entry is run first |
| `cordis.patch.yml` | loader rows merged into the profile patch |
| `agent.preset.yml` | rows appended to the `artifacts` agent preset |

The two row files exist because a plugin's halves live in **different Cordis
contexts**. Profile rows see services like `webServer`; only an agent preset
sees `tools`. A plugin registering a model-facing tool therefore needs an
`agent.preset.yml`, and cannot get there through the profile patch.

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

- **the model calls `show_file`** — the envelope rides the tool result's
  `presentationMeta`, so the panel rebuilds from the session log alone and the
  file body never passes through the model;
- **you click a file path in the transcript** — resolved through
  `GET /canvas/file?path=…&meta=1`.

Images and PDFs carry a `url` rather than `content`, so the browser streams the
bytes instead of dragging base64 through the session log.

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

## Licensing

`context/` is a fork of [dsh-context](https://github.com/bowenliang123/dsh-context)
by bowenliang123, used under the Apache License 2.0 — see `context/LICENSE` and
`context/NOTICE`. Everything else is MIT.
