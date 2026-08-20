/**
 * @my-dsh/workflow host half — a stub, deliberately, after an attempt that had
 * to be withdrawn.
 *
 * The goal was Code Mode workflow runs. `dsh-tool-workflow` records a run only
 * when `exec.parent === undefined`, so a workflow launched inside a Code Mode
 * program produces no records and therefore no progress tree. The obvious fix
 * was to record those runs here, from the `workflow/*` context events, under
 * this plugin's own event names.
 *
 * That is not possible on this build, and the failure mode is severe rather
 * than cosmetic:
 *
 *   - `KNOWN_SESSION_EVENT_TYPES` is generated from the harness's own
 *     repository. Its documentation states that downstream plugin events are
 *     outside that set "by construction", with a registration surface
 *     "deferred until such a consumer exists".
 *   - The persistence READ path refuses to interpret a log containing a type
 *     outside that set unless the event carries the `ignorable` envelope
 *     marker, because an unrecognized required event may change how the rest
 *     of the log is read.
 *   - `Session.append(type, data)` has no parameter for that marker. It exists
 *     for logs written by a NEWER harness, not for plugins.
 *
 * So a plugin-written event type does not degrade to a missing drawing: it
 * makes the whole session unreadable, which is exactly what happened — the
 * transcript hung on "loading history" after a reload.
 *
 * Code Mode runs therefore need a route that does not touch the session log at
 * all: the host holding live run state and the browser reading it over HTTP.
 * That is a different design and is not built here.
 */

/** Cordis plugin name. */
export const name = 'workflow-view'

/** Nothing is injected: this half does nothing at all. */
export const inject: string[] = []

/** No host behaviour. The progress tree is built entirely in the browser. */
export function apply(): void {}
