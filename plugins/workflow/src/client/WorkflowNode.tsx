/**
 * The workflow progress tree, rendered inline in the transcript.
 *
 * Phases group their members; each member carries a status glyph, its label,
 * and how long it took - or how long it has been going, ticking while the run
 * is live. That last part is the reason this node exists: a workflow view that
 * cannot say what is slow only tells you to wait.
 */
import type * as ReactNS from 'react'
import { React, h } from './react.ts'
import { byPhase, progress, type Member, type RunState } from './fold.ts'

type Translate = (key: string, params?: Record<string, string | number>) => string

export interface WorkflowNodeProps {
  node?: { data?: RunState }
  t?: Translate
}

const GLYPH: Record<string, string> = {
  running: '\u25cf',
  ok: '\u2713',
  failed: '\u2717',
  interrupted: '\u25cb',
}

/**
 * A compact duration: sub-minute in seconds, longer in minutes and seconds.
 * @param ms - elapsed milliseconds.
 * @returns e.g. `4.2s` or `2m 07s`.
 */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`
}

/** The style suffix for a run status. */
function runTone(status: RunState['status']): string {
  if (status === 'ok') return 'ok'
  if (status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  return 'interrupted'
}

/**
 * Build the node component.
 * @param fallbackT - translator used when the slot supplies none.
 * @returns the chat-node renderer.
 */
export function makeWorkflowNode(fallbackT: Translate): (props: WorkflowNodeProps) => ReactNS.ReactElement | null {
  return function WorkflowNode(props: WorkflowNodeProps): ReactNS.ReactElement | null {
    const t = props.t ?? fallbackT
    const run = props.node?.data
    // A live run needs a clock of its own: nothing else re-renders the node
    // between events, so elapsed time would sit frozen at whatever it was when
    // the last member started.
    const live = run !== undefined && run.endedAt === undefined
    const [now, setNow] = React.useState(() => Date.now())
    React.useEffect(() => {
      if (!live) return undefined
      const timer = setInterval(() => setNow(Date.now()), 1000)
      return () => { clearInterval(timer) }
    }, [live])

    if (run === undefined) return null
    const { done, total, failed } = progress(run)
    const runEnd = run.endedAt ?? now
    const percent = total === 0 ? 0 : Math.round((done / total) * 100)

    const memberRow = (member: Member): ReactNS.ReactElement => {
      const end = member.endedAt ?? now
      return h('div', { key: member.seq },
        h('div', { className: `dsh_wf_member dsh_wf_${member.status}` },
          h('span', { className: 'dsh_wf_glyph' },
            member.status === 'running'
              ? h('span', { className: 'dsh_wf_spin' }, GLYPH['running'])
              : GLYPH[member.status] ?? '\u00b7'),
          h('span', { className: 'dsh_wf_label' }, member.label),
          h('span', { className: 'dsh_wf_dur' }, duration(end - member.startedAt)),
        ),
        member.error === undefined ? null : h('div', { className: 'dsh_wf_err' }, member.error),
      )
    }

    return h('div', { className: 'dsh_wf' },
      h('div', { className: 'dsh_wf_head' },
        h('span', { className: `dsh_wf_glyph dsh_wf_${runTone(run.status)}` },
          run.status === 'running'
            ? h('span', { className: 'dsh_wf_spin' }, GLYPH['running'])
            : GLYPH[run.status] ?? GLYPH['ok']),
        h('span', { className: 'dsh_wf_name' }, run.name),
        h('span', { className: 'dsh_wf_count' },
          failed > 0 ? t('countFailed', { done, total, failed }) : t('count', { done, total })),
        h('span', { className: 'dsh_wf_elapsed' }, duration(runEnd - run.startedAt)),
      ),
      total === 0
        ? h('p', { className: 'dsh_wf_empty' }, t('empty'))
        : h('div', null,
            h('div', { className: 'dsh_wf_bar' },
              h('div', {
                className: `dsh_wf_fill${failed > 0 ? ' dsh_wf_fill_failed' : ''}`,
                style: { width: `${percent}%` },
              })),
            ...byPhase(run).map(group => h('div', { className: 'dsh_wf_phase', key: group.phase ?? ' unphased' },
              group.phase === undefined ? null : h('div', { className: 'dsh_wf_phaseName' }, group.phase),
              ...group.members.map(memberRow),
            )),
          ),
    )
  }
}
