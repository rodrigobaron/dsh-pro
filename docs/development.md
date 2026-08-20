# Development

How a plugin in this repository is structured, built, and type-checked.

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

Type-checking resolves harness types by symlinking the harness that is actually
installed, rather than a published version that may not match — see
[at-file](../plugins/at-file/README.md#type-checking-against-the-running-harness)
for why the usual answers do not work here.
