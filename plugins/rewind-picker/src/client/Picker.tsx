/**
 * The rewind picker dialog.
 *
 * Rendered from `conversation.input.overlay`, opened per session through the
 * store the `/rewind` command flips. Lists the user messages in the current
 * window newest first — the way you actually think about rewinding — and posts
 * the chosen one's seq as the boundary.
 */
import type * as ReactNS from 'react'
import { React, h } from './react.ts'
import { requestRewind, restoreDraft, rewindPoints } from './api.ts'
import type { ClientCtx, SessionStandardProps } from './services.ts'

type Translate = (key: string, params?: Record<string, string | number>) => string

export interface PickerProps extends SessionStandardProps {
  /** Bound selector hook over this session's open flag (hooks compartment). */
  useRewindPicker?: (select: (open: boolean) => boolean) => boolean
}

/** A coarse "how long ago" label; exactness is not the point when picking. */
function relativeTime(time: number, t: Translate): string {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return t('time.now')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('time.minutes', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.hours', { n: hours })
  return t('time.days', { n: Math.round(hours / 24) })
}

/** Map a host error code to a dictionary key, falling back to the generic one. */
function errorKey(code: string | undefined): string {
  const known = ['session-not-found', 'subagent-owned', 'agent-busy', 'message-not-found', 'rewind-rejected', 'transport']
  return known.includes(code ?? '') ? `error.${code}` : 'error.unknown'
}

/**
 * Build the picker component bound to one client context.
 * @param ctx - the client root context, for the draft restore.
 * @param t - the bound translator.
 * @param storeOf - resolves a session's open store.
 * @returns the overlay component.
 */
export function makePicker(
  ctx: ClientCtx,
  t: Translate,
  storeOf: (sessionId: string) => { set(open: boolean): void },
): (props: PickerProps) => ReactNS.ReactElement | null {
  return function RewindPicker(props: PickerProps): ReactNS.ReactElement | null {
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
    const open = typeof props.useRewindPicker === 'function' ? props.useRewindPicker(o => o) : false
    const nodes = typeof props.useSession === 'function' ? props.useSession(s => s.nodes) : undefined
    const running = typeof props.useSession === 'function' ? props.useSession(s => s.running === true) : false

    const [selected, setSelected] = React.useState<number | null>(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    // Newest first: rewinding is almost always "undo the last thing", so the
    // most likely target should not be at the bottom of a long scroll.
    const points = React.useMemo(() => rewindPoints(nodes).reverse(), [nodes])
    const total = points.length

    const close = React.useCallback(() => {
      storeOf(sessionId).set(false)
      setSelected(null)
      setError(null)
    }, [sessionId, storeOf])

    // Escape closes, matching every other dialog in the app.
    React.useEffect(() => {
      if (!open) return undefined
      const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
      window.addEventListener('keydown', onKey)
      return () => { window.removeEventListener('keydown', onKey) }
    }, [open, close])

    // TEMPORARY diagnostic
    if (!open || sessionId === '') return null

    const confirm = async (): Promise<void> => {
      if (selected === null || busy) return
      const point = points.find(p => p.seq === selected)
      if (point === undefined) return
      setBusy(true)
      setError(null)
      const result = await requestRewind(sessionId, point.seq)
      setBusy(false)
      if (result.ok !== true) {
        const code = result.ok === false ? result.error?.code : undefined
        const message = result.ok === false ? result.error?.message ?? '' : ''
        setError(t(errorKey(code), { message }))
        return
      }
      // The other half of a rewind: the message comes back for editing.
      restoreDraft(ctx, sessionId, point.text)
      close()
    }

    const body = total === 0
      ? h('p', { className: 'dsh_rewind_empty' }, t('empty'))
      : h('ul', { className: 'dsh_rewind_list' }, points.map((point, index) => {
          const ordinal = total - index
          return h('li', { key: point.seq },
            h('button', {
              type: 'button',
              className: 'dsh_rewind_row',
              'aria-pressed': selected === point.seq,
              disabled: busy,
              onClick: () => { setSelected(point.seq); setError(null) },
            },
              h('span', { className: 'dsh_rewind_n' }, String(ordinal)),
              h('span', { className: 'dsh_rewind_body' },
                h('span', { className: 'dsh_rewind_meta' },
                  h('span', null, t('position', { n: ordinal, total })),
                  point.time !== undefined ? h('span', null, relativeTime(point.time, t)) : null,
                  index === 0 ? h('span', { className: 'dsh_rewind_pill' }, t('latest')) : null,
                ),
                h('span', { className: point.text === '' ? 'dsh_rewind_text dsh_rewind_muted' : 'dsh_rewind_text' },
                  point.text === '' ? t('untitled') : point.text),
              ),
            ),
          )
        }))

    return h('div', {
      className: 'dsh_rewind_backdrop',
      role: 'presentation',
      onClick: (event: ReactNS.MouseEvent) => { if (event.target === event.currentTarget) close() },
    },
      h('div', { className: 'dsh_rewind_card', role: 'dialog', 'aria-modal': true, 'aria-label': t('title') },
        h('div', { className: 'dsh_rewind_head' },
          h('div', { className: 'dsh_rewind_headrow' },
            h('span', { className: 'dsh_rewind_title' }, t('title')),
            h('button', { type: 'button', className: 'dsh_rewind_close', onClick: close, 'aria-label': t('close') }, '\u00d7'),
          ),
          h('p', { className: 'dsh_rewind_sub' }, t('subtitle')),
          // Stated up front, not in a tooltip: this is the one expectation a
          // rewind feature reliably breaks.
          h('p', { className: 'dsh_rewind_note' }, h('b', null, t('filesLead')), ' ', t('files')),
        ),
        running ? h('p', { className: 'dsh_rewind_alert' }, t('busy')) : null,
        body,
        error !== null ? h('p', { className: 'dsh_rewind_alert' }, error) : null,
        h('div', { className: 'dsh_rewind_foot' },
          h('button', { type: 'button', className: 'dsh_rewind_btn', onClick: close, disabled: busy }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'dsh_rewind_btn dsh_rewind_primary',
            disabled: busy || running || selected === null,
            onClick: () => { void confirm() },
          }, busy ? t('working') : t('confirm')),
        ),
      ),
    )
  }
}
