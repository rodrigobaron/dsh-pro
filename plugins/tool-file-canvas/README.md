# The file artifact panel

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

## Progressive exposure

`show_file` is registered into every agent and then immediately restricted with
`agent.ctx.tools.restrict({ deny: ['show_file'] })`, so it costs nothing in the
tool schema until it is wanted. Calling `skill('file-artifacts')` lifts the
restriction for that agent alone — `restrict` returns the disposer that lifts
it, so holding that disposer is what makes the reveal possible.

The skill body carries the guidance that would otherwise sit in the system
prompt, including the distinction that actually matters: `read` pulls a file
into the model's context, `show_file` puts it in front of the user and never
enters context. Neither implies the other.

## Containment

A path is readable only if it resolves inside the session's workspace, a
registered workspace, or the process cwd. Resolution goes through `ctx.fs`, so
symlink escapes are caught by the backend's canonicalization rather than by
prefix matching. Responses carry `nosniff` and a `sandbox` CSP, and workspace
HTML is served as `text/plain` — a file opened directly must never execute on
the app's origin.

## Extending

| Slot | Kind | Purpose |
| --- | --- | --- |
| `canvas.renderer` | keyed by envelope `type` | how to display a type |
| `canvas.chrome` | list | toolbar items |

To add a type: register a `canvas.renderer` under its key, and add the
extension to `tool-file-canvas/lib/filetype.js`.
