/**
 * @my-dsh/workflow host half: durable records for Code Mode workflow runs.
 *
 * `dsh-tool-workflow` records a run only when it is a top-level tool call:
 *
 *     const recordsRun = exec.parent === void 0
 *     if (recordsRun) recorder.start(parent.session, run)
 *
 * A workflow launched from inside a Code Mode program has a parent, so nothing
 * is written and the transcript shows only the raw tool card — no progress
 * tree, from this plugin or the stock one. This fills exactly that gap: it
 * records the runs the harness deliberately skips, under its own event names,
 * so the two never collide and a top-level run is never recorded twice.
 *
 * The engine already emits everything needed on the context
 * (`workflow/start`, `/agent-start`, `/agent-end`, `/end`). The one thing it
 * does not carry is WHICH session to write to — `WorkflowRunInfo` is `{id,
 * meta}` — so the session is picked up from the `workflow` tool call that is
 * executing when the run starts.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only, for their declaration merges: dsh-workflow contributes the
// `workflow/*` events, dsh-tools the `tools/execute` waterfall, and
// dsh-session the SessionEventMap this file extends below. Without importing
// them TypeScript never loads the augmentations and every event name reads as
// unknown.
import type {} from '@deepseek-ai/dsh-workflow'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session/types'
import type { Session } from '@deepseek-ai/dsh-session'

/** Our own event family, mirroring the shape of the harness's own records. */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'workflow-view/run-start': { runId: string, name: string }
    'workflow-view/agent-start': { runId: string, seq: number, label: string, phase?: string, childId?: string }
    'workflow-view/agent-end': { runId: string, seq: number, outcome: unknown }
    'workflow-view/run-end': { runId: string, stopReason: unknown }
  }
}

/** Cordis plugin name. */
export const name = 'workflow-view'

/**
 * Nothing is injected on purpose.
 *
 * This half only registers context listeners, and `ctx.on` needs no service to
 * exist first — a listener for an event nobody emits simply never fires.
 * Injecting `workflowEngine` looked tidier and was wrong: the engine is not
 * provided as a root service, so the row sat pending and took the whole boot
 * down with it.
 */
export const inject: string[] = []

/**
 * Mount the nested-run recorder.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  /** Sessions of workflow tool calls currently in flight, by nesting. */
  let inFlight: Session[] = []
  /** Sessions to write each recorded run to, by run id. */
  const runs = new Map<string, Session>()

  /**
   * Append one record, disabling this run rather than letting a bad write
   * surface as a tool failure. Recording is a nicety; the workflow is not.
   */
  const append = (runId: string, write: () => unknown): void => {
    try {
      write()
    } catch (error) {
      ctx.logger.warn(`workflow-view: stopped recording run ${runId}: ${String(error)}`)
      runs.delete(runId)
    }
  }

  ctx.on('tools/execute', async (exec, next) => {
    // Top-level calls are already recorded by dsh-tool-workflow. Recording
    // them again would put two runs in the transcript for one execution.
    if (exec.name !== 'workflow' || exec.parent === undefined) return next()
    const session = exec.agent?.session
    if (session === undefined) return next()
    inFlight = [...inFlight, session]
    try {
      return await next()
    } finally {
      const at = inFlight.lastIndexOf(session)
      if (at !== -1) inFlight = [...inFlight.slice(0, at), ...inFlight.slice(at + 1)]
    }
  })

  ctx.on('workflow/start', (info) => {
    // The engine does not say which session launched the run, so it is taken
    // from the workflow tool call in flight. With two nested calls running at
    // once there is no way to tell which is which, and attributing a run to
    // the wrong conversation is worse than not drawing it — so it is skipped
    // and said out loud.
    if (inFlight.length === 0) return
    if (inFlight.length > 1) {
      ctx.logger.warn(`workflow-view: ${inFlight.length} nested workflow calls in flight; not recording run ${info.id}`)
      return
    }
    const session = inFlight[0] as Session
    runs.set(info.id, session)
    append(info.id, () => session.append('workflow-view/run-start', { runId: info.id, name: info.meta.name }))
  })

  ctx.on('workflow/agent-start', (info, agent) => {
    const session = runs.get(info.id)
    if (session === undefined) return
    append(info.id, () => session.append('workflow-view/agent-start', {
      runId: info.id,
      seq: agent.seq,
      label: agent.label,
      ...(agent.phase === undefined ? {} : { phase: agent.phase }),
      ...(agent.childId === undefined ? {} : { childId: agent.childId }),
    }))
  })

  ctx.on('workflow/agent-end', (info, agent) => {
    const session = runs.get(info.id)
    if (session === undefined) return
    append(info.id, () => session.append('workflow-view/agent-end', { runId: info.id, seq: agent.seq, outcome: agent.outcome }))
  })

  ctx.on('workflow/end', (info, result) => {
    const session = runs.get(info.id)
    runs.delete(info.id)
    if (session === undefined) return
    append(info.id, () => session.append('workflow-view/run-end', { runId: info.id, stopReason: result.stopReason }))
  })
}
