/**
 * The Updates settings section.
 *
 * Two cards — what is installed, what is available — a check button, an install
 * button, and the restart notice that follows a successful install. The host
 * decides everything; this renders it.
 */
import type { UpdateState } from '../contract.ts'
import { applyUpdate, checkNow, readState, UpdateRequestError } from './api.ts'
import { React, h } from './react.ts'

type Translate = (key: string, params?: Record<string, string | number>) => string

/** Human-readable byte size. */
function formatSize(bytes: number): string {
  if (bytes <= 0) return '—'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Local-time rendering of an ISO stamp, tolerant of an empty one. */
function formatTime(iso: string | null): string | null {
  if (iso === null || iso === '') return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

/**
 * Build the section component bound to a translator.
 * @param t - the locale binding.
 * @returns the React component the slot renders.
 */
export function makeSection(t: Translate): React.FunctionComponent {
  return function UpdatesSection(): React.ReactElement {
    const [state, setState] = React.useState<UpdateState | null>(null)
    const [busy, setBusy] = React.useState<'idle' | 'checking' | 'installing'>('idle')
    const [error, setError] = React.useState<string | null>(null)
    const [backup, setBackup] = React.useState<string | null>(null)

    const load = React.useCallback(async (fresh: boolean) => {
      setBusy(fresh ? 'checking' : 'idle')
      setError(null)
      try {
        setState(fresh ? await checkNow() : await readState())
      } catch (failure) {
        setError(failure instanceof UpdateRequestError ? failure.message : String(failure))
      } finally {
        setBusy('idle')
      }
    }, [])

    React.useEffect(() => { void load(false) }, [load])

    const install = React.useCallback(async () => {
      setBusy('installing')
      setError(null)
      try {
        const result = await applyUpdate()
        setBackup(result.backupPath)
        // Re-read rather than patching local state: the marker on disk is the
        // authority on what is installed now, and it just changed.
        setState(await readState())
      } catch (failure) {
        setError(failure instanceof UpdateRequestError ? failure.message : String(failure))
      } finally {
        setBusy('idle')
      }
    }, [])

    const installed = state?.installed ?? null
    const latest = state?.latest ?? null
    const pending = state?.pendingRestart ?? null
    const checked = formatTime(state?.checkedAt ?? null)

    const children: React.ReactNode[] = [
      h('p', { key: 'intro', className: 'dsh_up_intro' }, t('intro')),
    ]

    if (pending !== null) {
      children.push(h('div', { key: 'restart', className: 'dsh_up_note' }, [
        h('strong', { key: 'title' }, t('restart.title')),
        h('span', { key: 'body' }, t('restart.body', { version: pending.toVersion })),
        h('br', { key: 'br' }),
        h('code', { key: 'cmd' }, t('restart.command')),
      ]))
    }

    if (backup !== null) {
      children.push(h('p', { key: 'backup', className: 'dsh_up_stamp' }, t('backup', { path: backup })))
    }

    if (error !== null) {
      children.push(h('div', { key: 'error', className: 'dsh_up_error' }, `${t('error')}: ${error}`))
    } else if (state?.reason !== undefined) {
      children.push(h('div', { key: 'reason', className: 'dsh_up_note' }, t(`reason.${state.reason}`)))
    }

    children.push(h('div', { key: 'grid', className: 'dsh_up_grid' }, [
      h('div', { key: 'installed', className: 'dsh_up_card' }, [
        h('p', { key: 'l', className: 'dsh_up_label' }, t('installed')),
        h('p', { key: 'v', className: 'dsh_up_version' }, installed?.version ?? t('installed.none')),
        h('p', { key: 'm', className: 'dsh_up_meta' }, installed === null
          ? t('installed.hint')
          : `${installed.source === 'release' ? t('installed.release') : t('installed.local')} · ${installed.plugins.length} plugins`),
      ]),
      h('div', { key: 'available', className: 'dsh_up_card' }, [
        h('p', { key: 'l', className: 'dsh_up_label' }, t('available')),
        h('p', { key: 'v', className: 'dsh_up_version' }, [
          latest?.version ?? t('available.none'),
          latest?.prerelease === true
            ? h('span', { key: 'pre', className: 'dsh_up_tag' }, t('prerelease'))
            : null,
        ]),
        h('p', { key: 'm', className: 'dsh_up_meta' }, latest === null
          ? t('repository') + ': ' + (state?.repository ?? '—')
          : `${t('size', { size: formatSize(latest.sizeBytes) })}${state?.updateAvailable === true ? '' : ' · ' + t('uptodate')}`),
      ]),
    ]))

    // Deliberately not gated on `busy`: the button has to stay mounted while
    // the install runs, or it unmounts the moment it is pressed and never
    // shows its own progress label. `disabled` handles the press.
    const canInstall = state?.updateAvailable === true && state.supported
    children.push(h('div', { key: 'actions', className: 'dsh_up_row' }, [
      h('button', {
        key: 'check',
        type: 'button',
        className: 'dsh_up_btn',
        disabled: busy !== 'idle',
        onClick: () => { void load(true) },
      }, busy === 'checking' ? t('checking') : t('check')),
      canInstall
        ? h('button', {
          key: 'install',
          type: 'button',
          className: 'dsh_up_btn dsh_up_primary',
          disabled: busy !== 'idle',
          onClick: () => { void install() },
        }, busy === 'installing' ? t('installing') : t('install', { version: latest?.version ?? '' }))
        : null,
      h('span', { key: 'stamp', className: 'dsh_up_stamp' },
        checked === null ? t('neverChecked') : t('checkedAt', { time: checked })),
    ]))

    if (state !== null && !state.authenticated) {
      children.push(h('p', { key: 'token', className: 'dsh_up_stamp' }, t('token.missing')))
    }

    if (latest !== null && latest.notes !== '') {
      children.push(h('details', { key: 'notes', className: 'dsh_up_notes' }, [
        h('summary', { key: 's' }, t('notes')),
        h('pre', { key: 'p' }, latest.notes),
      ]))
    }

    return h('div', { className: 'dsh_up_section' }, children)
  }
}
