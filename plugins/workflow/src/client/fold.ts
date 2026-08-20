/**
 * The workflow-run fold: four durable session events → one progress tree.
 *
 * `dsh-tool-workflow` writes `tool-workflow/run-start`, `/agent-start`,
 * `/agent-end`, and `/run-end`. The stock `dsh-client-ui-workflow-run` node
 * already folds these, but its view keeps only name, status, phase, and member
 * identity — its own README says "scripts, outputs, errors, logs, usage …
 * remain outside this surface". Timing in particular is absent, and a workflow
 * view without durations cannot answer the question people actually have while
 * one runs: what is slow, and how far along is it.
 *
 * So this folds the same events again and keeps `event.time`, which is where
 * every duration here comes from.
 */

/** How one member settled, or that it has not. */
export type MemberStatus = 'running' | 'ok' | 'failed' | 'interrupted'

/** How the run itself settled, or that it has not. */
export type RunStatus = 'running' | 'ok' | 'failed' | 'cancelled' | 'interrupted'

/** One workflow member (a subagent) as the transcript knows it. */
export interface Member {
  readonly seq: number
  readonly label: string
  readonly phase?: string
  readonly childId?: string
  readonly startedAt: number
  readonly endedAt?: number
  readonly status: MemberStatus
  /** The failure text, when the outcome carried one. */
  readonly error?: string
}

/** One workflow run. */
export interface RunState {
  readonly runId: string
  readonly name: string
  readonly startedAt: number
  readonly endedAt?: number
  readonly status: RunStatus
  readonly members: readonly Member[]
}

/**
 * The two event families this fold consumes.
 *
 * `tool-workflow/*` is the harness's own record, written only for TOP-LEVEL
 * workflow calls. `workflow-view/*` is this plugin's host half filling the
 * gap: a workflow launched from inside a Code Mode program has `exec.parent`
 * set, which is exactly the condition under which the harness writes nothing.
 *
 * The two never describe the same run, so folding both needs no de-duplication
 * — only a suffix match, since the payloads are deliberately identical.
 */
const FAMILIES = ['tool-workflow/', 'workflow-view/'] as const

export const RUN_START = 'run-start'
export const AGENT_START = 'agent-start'
export const AGENT_END = 'agent-end'
export const RUN_END = 'run-end'

/**
 * The lifecycle step an event describes, whichever family wrote it.
 * @param type - the session event type.
 * @returns the bare step name, or null when the event is not ours.
 */
export function stepOf(type: string): string | null {
  for (const family of FAMILIES) {
    if (!type.startsWith(family)) continue
    const step = type.slice(family.length)
    if (step === RUN_START || step === AGENT_START || step === AGENT_END || step === RUN_END) return step
  }
  return null
}

/** Minimal event shape; the harness's own type is richer than this fold needs. */
export interface FoldEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data?: Record<string, unknown>
}

/** Read a run id off any of the four events. */
export function runIdOf(event: FoldEvent): string | null {
  const id = event.data?.['runId']
  return typeof id === 'string' && id !== '' ? id : null
}

/** Whether this fold cares about the event at all. */
export function isWorkflowEvent(event: FoldEvent): boolean {
  return stepOf(event.type) !== null
}

/**
 * Seed a run from its start event.
 * @param event - the `run-start` event.
 * @returns the initial state.
 */
export function seed(event: FoldEvent): RunState {
  const name = event.data?.['name']
  return {
    runId: runIdOf(event) ?? '',
    name: typeof name === 'string' && name !== '' ? name : 'workflow',
    startedAt: event.time,
    status: 'running',
    members: [],
  }
}

/** Map one member outcome to a status and its failure text. */
function readOutcome(outcome: unknown): { status: MemberStatus; error?: string } {
  if (typeof outcome === 'string') {
    return outcome === 'ok' || outcome === 'success'
      ? { status: 'ok' }
      : { status: 'failed', error: outcome }
  }
  if (outcome !== null && typeof outcome === 'object') {
    const record = outcome as Record<string, unknown>
    const kind = record['kind'] ?? record['status'] ?? record['type']
    const message = record['error'] ?? record['message'] ?? record['reason']
    const ok = kind === 'ok' || kind === 'success' || record['ok'] === true
    return ok
      ? { status: 'ok' }
      : { status: 'failed', ...(typeof message === 'string' && message !== '' ? { error: message } : {}) }
  }
  // An outcome shape this build does not recognize is reported as settled
  // rather than invented as a failure.
  return { status: 'ok' }
}

/** Map a run stop reason to a run status. */
function readStopReason(reason: unknown): RunStatus {
  const text = typeof reason === 'string' ? reason
    : reason !== null && typeof reason === 'object'
      ? String((reason as Record<string, unknown>)['kind'] ?? '')
      : ''
  if (text === 'completed' || text === 'ok' || text === 'success') return 'ok'
  if (text === 'cancelled' || text === 'canceled' || text === 'aborted') return 'cancelled'
  if (text === '') return 'ok'
  return 'failed'
}

/**
 * Apply one post-start event.
 *
 * Unknown or duplicate events return the same reference, so a re-render is not
 * provoked by an event this fold has nothing to say about.
 *
 * @param state - the run so far.
 * @param event - the next event for this run.
 * @returns the next state.
 */
export function apply(state: RunState, event: FoldEvent): RunState {
  const step = stepOf(event.type)
  if (step === AGENT_START) {
    const seq = event.data?.['seq']
    const label = event.data?.['label']
    if (typeof seq !== 'number') return state
    if (state.members.some(member => member.seq === seq)) return state
    const phase = event.data?.['phase']
    const childId = event.data?.['childId']
    return {
      ...state,
      members: [...state.members, {
        seq,
        label: typeof label === 'string' && label !== '' ? label : `#${seq}`,
        ...(typeof phase === 'string' && phase !== '' ? { phase } : {}),
        ...(typeof childId === 'string' && childId !== '' ? { childId } : {}),
        startedAt: event.time,
        status: 'running',
      }],
    }
  }
  if (step === AGENT_END) {
    const seq = event.data?.['seq']
    if (typeof seq !== 'number') return state
    const outcome = readOutcome(event.data?.['outcome'])
    let touched = false
    const members = state.members.map(member => {
      if (member.seq !== seq || member.status !== 'running') return member
      touched = true
      return { ...member, endedAt: event.time, status: outcome.status, ...(outcome.error === undefined ? {} : { error: outcome.error }) }
    })
    return touched ? { ...state, members } : state
  }
  if (step === RUN_END) {
    // A run that ends with members still open was interrupted mid-flight; the
    // members are reported that way rather than left spinning forever.
    const members = state.members.map(member =>
      member.status === 'running' ? { ...member, endedAt: event.time, status: 'interrupted' as const } : member)
    return { ...state, endedAt: event.time, status: readStopReason(event.data?.['stopReason']), members }
  }
  return state
}

/** Members grouped by phase, in first-seen order, with unphased members last. */
export function byPhase(state: RunState): readonly { phase: string | undefined; members: readonly Member[] }[] {
  const groups = new Map<string, Member[]>()
  const unphased: Member[] = []
  for (const member of state.members) {
    if (member.phase === undefined) { unphased.push(member); continue }
    const bucket = groups.get(member.phase)
    if (bucket === undefined) groups.set(member.phase, [member])
    else bucket.push(member)
  }
  const out: { phase: string | undefined; members: readonly Member[] }[] =
    [...groups].map(([phase, members]) => ({ phase, members }))
  if (unphased.length > 0) out.push({ phase: undefined, members: unphased })
  return out
}

/** How many members have settled, and how many there are. */
export function progress(state: RunState): { done: number; total: number; failed: number } {
  let done = 0
  let failed = 0
  for (const member of state.members) {
    if (member.status !== 'running') done += 1
    if (member.status === 'failed') failed += 1
  }
  return { done, total: state.members.length, failed }
}
