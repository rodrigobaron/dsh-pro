# Routines

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

## No sidebar

Upstream mounts a sidebar entry and a jobs board. This build carries neither —
the whole of its `src/client/` is dropped, and with it the CSS-module build
step the board needed. The settings section is ours, which is why the
conversation surface is untouched.

## What the port keeps

The engine, which is the reason to port rather than rewrite: at-most-once
firing (`nextRunAt` rolls forward *before* a run, so a crash mid-run cannot
double-fire), skip-while-running, atomic ledger writes that degrade safely on a
corrupt file, and cron parsing with local-time semantics.

Inherited limits worth knowing: firing needs the service alive, a slot missed
while it was down stays missed rather than backfilling, and every run costs API
quota with nobody present — so a routine prompt must be self-contained and must
never ask a question.

## Choosing project, preset, and model

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

## Editing and session naming

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

## The silent-field traps

`PATCH /api/routines/jobs` ignores fields it does not recognise and still
answers `200`. That bit twice while building the form:

- Pausing is `scheduleEnabled`, not `enabled`.
- The project is `target.workdir`, not a root `workdir` — the flat form created
  routines with no project at all, and reported success doing it.

Both look like working requests that change nothing, so check a create or patch
against the returned record rather than the status code.
