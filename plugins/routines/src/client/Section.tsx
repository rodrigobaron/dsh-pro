/**
 * The Routines settings section.
 *
 * Upstream put this in the sidebar as a board; here it lives on the settings
 * page, so the conversation surface is untouched. The host owns scheduling
 * entirely — this reads the ledger, edits it, and shows what the engine
 * decided.
 */
import type * as ReactNS from 'react'
import { React, h } from './react.ts'
import {
  createRoutine, listRoutines, removeRoutine, RoutineError, runRoutine, updateRoutine,
  type Routine,
} from './api.ts'
import { PRESETS } from './locales.ts'

type Translate = (key: string, params?: Record<string, string | number>) => string

export interface SectionProps {
  t?: Translate
}

/** A short absolute-ish stamp; exactness is not the point in a list. */
function when(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}

/** The most recent execution, if the host recorded one. */
function lastRun(routine: Routine): { at?: number; error?: string } | undefined {
  const executions = routine.executions ?? []
  return executions.length === 0 ? undefined : executions[executions.length - 1] as { at?: number; error?: string }
}

/**
 * Build the section component.
 * @param fallbackT - translator used when the slot does not supply one.
 * @returns the settings section.
 */
export function makeSection(fallbackT: Translate): (props: SectionProps) => ReactNS.ReactElement {
  return function RoutinesSection(props: SectionProps): ReactNS.ReactElement {
    const t = props.t ?? fallbackT
    const [routines, setRoutines] = React.useState<readonly Routine[] | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [busy, setBusy] = React.useState<string | null>(null)
    const [adding, setAdding] = React.useState(false)
    const [draft, setDraft] = React.useState({ title: '', prompt: '', cron: '', workdir: '' })

    const refresh = React.useCallback(async () => {
      try {
        setRoutines(await listRoutines())
        setError(null)
      } catch (cause) {
        setError(cause instanceof RoutineError ? cause.message : String(cause))
      }
    }, [])

    React.useEffect(() => { void refresh() }, [refresh])

    /** Run one host mutation, then re-read the ledger the host owns. */
    const act = async (id: string, run: () => Promise<void>): Promise<void> => {
      setBusy(id)
      try {
        await run()
        await refresh()
      } catch (cause) {
        setError(cause instanceof RoutineError ? cause.message : String(cause))
      } finally {
        setBusy(null)
      }
    }

    const submit = async (): Promise<void> => {
      setBusy('new')
      try {
        await createRoutine({
          title: draft.title.trim(),
          prompt: draft.prompt.trim(),
          cron: draft.cron.trim(),
          ...(draft.workdir.trim() === '' ? {} : { workdir: draft.workdir.trim() }),
        })
        setDraft({ title: '', prompt: '', cron: '', workdir: '' })
        setAdding(false)
        await refresh()
      } catch (cause) {
        setError(cause instanceof RoutineError ? cause.message : String(cause))
      } finally {
        setBusy(null)
      }
    }

    const field = (
      key: string, value: string, onChange: (next: string) => void,
      opts: { area?: boolean; mono?: boolean; help?: string } = {},
    ): ReactNS.ReactElement => h('label', { className: 'dsh_rt_field', key },
      h('span', { className: 'dsh_rt_label' }, t(key)),
      h(opts.area === true ? 'textarea' : 'input', {
        className: [opts.area === true ? 'dsh_rt_area' : 'dsh_rt_input', opts.mono === true ? 'dsh_rt_mono' : '']
          .filter(Boolean).join(' '),
        value,
        placeholder: t(`${key}.ph`),
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      }),
      opts.help === undefined ? null : h('span', { className: 'dsh_rt_help' }, t(opts.help)),
    )

    const form = h('div', { className: 'dsh_rt_form' },
      field('title', draft.title, v => setDraft(d => ({ ...d, title: v }))),
      field('prompt', draft.prompt, v => setDraft(d => ({ ...d, prompt: v })), { area: true }),
      field('cron', draft.cron, v => setDraft(d => ({ ...d, cron: v })), { mono: true, help: 'cron.help' }),
      h('div', { className: 'dsh_rt_presets' }, PRESETS.map(preset => h('button', {
        key: preset.cron,
        type: 'button',
        className: 'dsh_rt_preset',
        onClick: () => setDraft(d => ({ ...d, cron: preset.cron })),
      }, t(preset.key)))),
      field('workdir', draft.workdir, v => setDraft(d => ({ ...d, workdir: v })), { help: 'workdir.help' }),
      h('div', { className: 'dsh_rt_formActions' },
        h('button', { type: 'button', className: 'dsh_rt_btn', onClick: () => setAdding(false), disabled: busy === 'new' }, t('cancel')),
        h('button', {
          type: 'button',
          className: 'dsh_rt_btn dsh_rt_primary',
          disabled: busy === 'new' || draft.title.trim() === '' || draft.prompt.trim() === '' || draft.cron.trim() === '',
          onClick: () => { void submit() },
        }, busy === 'new' ? t('saving') : t('save')),
      ),
    )

    const card = (routine: Routine): ReactNS.ReactElement => {
      const enabled = routine.schedule?.enabled === true
      const last = lastRun(routine)
      const isBusy = busy === routine.id
      return h('div', { className: 'dsh_rt_card', key: routine.id },
        h('div', { className: 'dsh_rt_head' },
          h('span', { className: 'dsh_rt_name' }, routine.title),
          routine.schedule?.cron === undefined ? null : h('span', { className: 'dsh_rt_cron' }, routine.schedule.cron),
          h('span', { className: 'dsh_rt_when' },
            routine.status === 'running' ? t('running')
              : !enabled ? t('paused')
              : routine.schedule?.nextRunAt === undefined ? t('never')
              : t('next', { when: when(routine.schedule.nextRunAt) })),
        ),
        h('p', { className: 'dsh_rt_prompt' }, routine.prompt),
        last?.error === undefined || last.error === '' ? null
          : h('p', { className: 'dsh_rt_fail' }, t('lastFailed', { error: last.error })),
        h('div', { className: 'dsh_rt_actions' },
          h('button', {
            type: 'button', className: 'dsh_rt_btn', disabled: isBusy,
            onClick: () => { void act(routine.id, () => runRoutine(routine.id)) },
          }, t('run')),
          h('button', {
            type: 'button', className: 'dsh_rt_btn', disabled: isBusy,
            // `scheduleEnabled`, not `enabled`: the host PATCH reads that name and
            // ignores fields it does not know, returning 200 either way — so the
            // wrong key looks like a working request that changes nothing.
            onClick: () => { void act(routine.id, () => updateRoutine(routine.id, { scheduleEnabled: !enabled })) },
          }, enabled ? t('pause') : t('resume')),
          h('button', {
            type: 'button', className: 'dsh_rt_btn dsh_rt_danger', disabled: isBusy,
            // Deleting a routine cannot be undone and the ledger is the only
            // record, so this asks first.
            onClick: () => { if (window.confirm(t('confirmRemove'))) void act(routine.id, () => removeRoutine(routine.id)) },
          }, t('remove')),
        ),
      )
    }

    return h('div', null,
      h('p', { className: 'dsh_rt_intro' }, t('intro')),
      h('p', { className: 'dsh_rt_warn' }, t('unattended')),
      routines === null
        ? h('p', { className: 'dsh_rt_help' }, t('loading'))
        : routines.length === 0 && !adding
          ? h('p', { className: 'dsh_rt_help' }, t('empty'))
          : h('div', { className: 'dsh_rt_list' }, routines.map(card)),
      adding ? form : h('button', { type: 'button', className: 'dsh_rt_btn', onClick: () => setAdding(true) }, t('add')),
      error === null ? null : h('p', { className: 'dsh_rt_error' }, t('error', { message: error })),
    )
  }
}
