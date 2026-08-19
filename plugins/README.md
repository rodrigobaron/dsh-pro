# my-dsh file canvas

Opens **any workspace file** in the DeepSeek Harness details side panel — source
code, Markdown, HTML, images, PDFs, and data files.

Standalone: it depends only on the harness itself. `vendor/dsh-artifacts` is kept
in the repo as reference and is no longer installed.

## Install

```bash
./plugins/install.sh
```

Then restart the harness. The installer removes the vendored artifact canvas from
`$DSH_HOME` (not from `vendor/`), installs these packages, regenerates the profile
patch, and creates a `file-canvas` agent preset.

## Layout

| Package | Context | Role |
| --- | --- | --- |
| `tool-file-canvas` | agent | the `show_file` tool the model calls |
| `tool-file-canvas/route` | web | `GET /canvas/file`, the contained reader |
| `client-ui-file-canvas` | browser | the canvas panel and its renderers |

The tool and the route are separate loader entries because `tools` and
`webServer` live in different Cordis contexts; they share `lib/shared.js`, so
containment and classification cannot drift between them.

## How a file reaches the canvas

Both triggers produce the *same* envelope, so there is one render path:

- **the model calls `show_file`** — the envelope rides the tool result's
  `presentationMeta`, so reopening a session rebuilds the canvas from the
  session log alone, and the file body never passes through the model;
- **you click a file path in the transcript** — resolved through
  `GET /canvas/file?path=…&meta=1`.

Images and PDFs carry a `url` instead of `content`: the browser streams the bytes
from the route rather than dragging base64 through the session log.

### Clicking paths

There is no harness seam for decorating message prose, so rather than
re-implementing message rendering the client listens for clicks in the capture
phase and only claims one once the host confirms the text resolves to a readable
file. Inline code that is not a file (`npm install`, a symbol name) is untouched.

## Containment

A path is readable only if it resolves inside a registered workspace root or the
process cwd. Resolution goes through `ctx.fs`, so symlink escapes are caught by
the backend's own canonicalization rather than by prefix matching. Responses
carry `nosniff` and a `sandbox` CSP, and workspace HTML is served as `text/plain`
— a file navigated to directly must never execute on the app's origin.

## Extending

The canvas declares child slots, so another plugin can teach it a file type
without touching this one:

| Slot | Kind | Purpose |
| --- | --- | --- |
| `canvas.renderer` | keyed by envelope `type` | how to display a type |
| `canvas.chrome` | list | toolbar items |

To add a type: register a `canvas.renderer` under its key, and add the extension
to `tool-file-canvas/lib/filetype.js`.

## No build tooling

The harness serves a client package's `./client` export verbatim, so the browser
half must already be in module-loader factory form. `client-ui-file-canvas/build.mjs`
wraps `src/client.js` into that shape using plain node — no dependencies, no
bundler. `install.sh` runs it for you; run it directly after editing the client:

```bash
node plugins/client-ui-file-canvas/build.mjs
```
