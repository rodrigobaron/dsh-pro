/**
 * The Git review tab.
 *
 * Owns all state for one session's repository: status, the selected file's
 * diff, and the outcome of the last action. Every mutation re-reads status
 * from the host reply rather than patching local state, so the pane can never
 * drift from what git actually thinks.
 *
 * Two actions here are not undoable — discarding changes and pushing — and
 * both require an explicit second click that names what is about to happen.
 */

import { React, h } from '../react'
import * as api from '../api'
import { ApiError } from '../api'
import type { ParsedDiff } from '../diff'
import { parseDiff } from '../diff'
import type { GitFile, GitStatus } from '../types'
import { isStaged, isUnstaged } from '../types'
import { DiffView } from './DiffView'
import type { FileSelection } from './FileList'
import { FileList } from './FileList'

interface Props {
  sessionId?: string
  cwd?: string
}

/** A destructive action awaiting its confirming second click. */
interface Pending {
  kind: 'discard' | 'push'
  label: string
  run: () => Promise<void>
}

export function GitView(props: Props) {
  const { useCallback, useEffect, useRef, useState } = React

  const [dir, setDir] = useState<string | null>(props.cwd ?? null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [selection, setSelection] = useState<FileSelection | null>(null)
  const [parsed, setParsed] = useState<ParsedDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  // Guards a late reply from overwriting newer state after the selection or
  // session changed while a request was in flight.
  const requestSeq = useRef(0)

  const report = useCallback((err: unknown) => {
    if (err instanceof ApiError) setError(err.message)
    else setError(err instanceof Error ? err.message : String(err))
  }, [])

  // ---- resolve the repository directory -----------------------------------
  useEffect(() => {
    if (props.cwd !== undefined && props.cwd !== '') {
      setDir(props.cwd)
      return
    }
    // No session cwd on the props: fall back to the host's allowed roots so
    // the tab still works rather than rendering an empty shell.
    let live = true
    api
      .fetchRoots()
      .then(roots => {
        if (!live) return
        if (roots.length === 0) setFatal('No workspace directory available')
        else setDir(roots[0] as string)
      })
      .catch(err => {
        if (live) report(err)
      })
    return () => {
      live = false
    }
  }, [props.cwd, report])

  // ---- status -------------------------------------------------------------
  const refresh = useCallback(
    async (showBusy: boolean) => {
      if (dir === null) return
      if (showBusy) setBusy(true)
      try {
        const next = await api.fetchStatus(dir)
        setStatus(next)
        setFatal(null)
      } catch (err) {
        if (err instanceof ApiError && (err.httpStatus === 400 || err.httpStatus === 403 || err.httpStatus === 404)) {
          // Not a repository, or outside the workspace: a standing condition
          // rather than a transient failure, so it replaces the pane instead
          // of stacking up as an error banner.
          setFatal(err.message)
          setStatus(null)
        } else {
          report(err)
        }
      } finally {
        if (showBusy) setBusy(false)
      }
    },
    [dir, report],
  )

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  // ---- diff for the selected file -----------------------------------------
  useEffect(() => {
    if (dir === null || selection === null || status === null) {
      setParsed(null)
      return
    }
    const file = status.files.find(f => f.path === selection.path)
    if (file === undefined) {
      setParsed(null)
      return
    }
    const seq = ++requestSeq.current
    setDiffLoading(true)
    api
      .fetchDiff(dir, selection.path, selection.staged, file.untracked && !selection.staged)
      .then(result => {
        if (seq !== requestSeq.current) return
        setParsed(parseDiff(result.diff))
        setTruncated(result.truncated)
      })
      .catch(err => {
        if (seq !== requestSeq.current) return
        setParsed(null)
        report(err)
      })
      .finally(() => {
        if (seq === requestSeq.current) setDiffLoading(false)
      })
  }, [dir, selection, status, report])

  // ---- mutations ----------------------------------------------------------
  const run = useCallback(
    async (action: () => Promise<GitStatus>, successNotice?: string) => {
      if (dir === null) return
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        setStatus(await action())
        if (successNotice !== undefined) setNotice(successNotice)
      } catch (err) {
        report(err)
      } finally {
        setBusy(false)
      }
    },
    [dir, report],
  )

  const onStage = useCallback((paths: string[]) => void run(() => api.stage(dir as string, paths)), [dir, run])
  const onUnstage = useCallback((paths: string[]) => void run(() => api.unstage(dir as string, paths)), [dir, run])

  const onDiscard = useCallback(
    (files: GitFile[]) => {
      const tracked = files.filter(f => !f.untracked).map(f => f.path)
      const untracked = files.filter(f => f.untracked).map(f => f.path)
      const what = files.length === 1 ? (files[0] as GitFile).path : `${files.length} files`
      // Say which of the two it is, because they are not the same act: a
      // tracked file goes back to its committed state, an untracked one is
      // deleted outright.
      const label =
        tracked.length > 0 && untracked.length > 0
          ? `Discard changes in ${tracked.length} file${tracked.length === 1 ? '' : 's'} and DELETE ${untracked.length} untracked file${untracked.length === 1 ? '' : 's'}?`
          : untracked.length > 0
            ? `Delete ${what}? This file is untracked — it is not in git, so it cannot be recovered.`
            : `Discard changes in ${what}? This cannot be undone.`
      setPending({
        kind: 'discard',
        label,
        run: async () => {
          await run(async () => {
            const next = await api.discardMixed(dir as string, tracked, untracked)
            return next ?? (await api.fetchStatus(dir as string))
          })
          setSelection(null)
        },
      })
    },
    [dir, run],
  )

  const onCommit = useCallback(async () => {
    if (dir === null || message.trim() === '') return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.commit(dir, message, amend)
      setStatus(result.status)
      setMessage('')
      setAmend(false)
      setSelection(null)
      setNotice(result.output.trim() || 'Committed')
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }, [dir, message, amend, report])

  const onPush = useCallback(() => {
    if (dir === null || status === null) return
    const setUpstream = status.upstream === null
    const target = setUpstream ? `origin/${status.branch ?? 'HEAD'} (new upstream)` : status.upstream
    setPending({
      kind: 'push',
      label: `Push ${status.ahead > 0 ? `${status.ahead} commit${status.ahead === 1 ? '' : 's'}` : 'this branch'} to ${target}?`,
      run: async () => {
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const result = await api.push(dir, setUpstream)
          setStatus(result.status)
          setNotice(result.output.trim() || 'Pushed')
        } catch (err) {
          report(err)
        } finally {
          setBusy(false)
        }
      },
    })
  }, [dir, status, report])

  // ---- render -------------------------------------------------------------
  if (fatal !== null) {
    return h(
      'div',
      { className: 'gr-root' },
      h('div', { className: 'gr-empty' }, fatal),
      h(
        'div',
        { className: 'gr-head' },
        h('button', { className: 'gr-btn', onClick: () => void refresh(true) }, 'Retry'),
      ),
    )
  }

  const files = status?.files ?? []
  const staged = files.filter(isStaged)
  const unstaged = files.filter(isUnstaged)
  const canCommit = staged.length > 0 && message.trim() !== '' && !busy

  return h(
    'div',
    { className: 'gr-root' },

    // ---- header ----
    h(
      'div',
      { className: 'gr-head' },
      h(
        'span',
        { className: 'gr-branch' },
        h('span', null, 'Branch'),
        h('span', { className: 'gr-branch-name' }, status?.branch ?? '(detached)'),
      ),
      status?.upstream != null ? h('span', { className: 'gr-chip' }, status.upstream) : h('span', { className: 'gr-chip gr-chip-warn' }, 'no upstream'),
      status != null && status.ahead > 0 ? h('span', { className: 'gr-chip' }, `↑ ${status.ahead}`) : null,
      status != null && status.behind > 0 ? h('span', { className: 'gr-chip gr-chip-warn' }, `↓ ${status.behind}`) : null,
      h('span', { className: 'gr-spacer' }),
      h('button', { className: 'gr-btn', disabled: busy, onClick: () => void refresh(true) }, 'Refresh'),
      h(
        'button',
        {
          className: 'gr-btn',
          disabled: busy || status === null || (status.ahead === 0 && status.upstream !== null),
          title: status?.upstream === null ? 'Publish this branch to origin' : 'Push commits to the upstream branch',
          onClick: onPush,
        },
        'Push',
      ),
    ),

    pending !== null
      ? h(
          'div',
          { className: 'gr-error' },
          h(
            'div',
            { className: 'gr-commit-row' },
            h('span', { style: { flex: 1 } }, pending.label),
            h(
              'button',
              {
                className: 'gr-btn gr-btn-danger',
                onClick: () => {
                  const action = pending.run
                  setPending(null)
                  void action()
                },
              },
              pending.kind === 'discard' ? 'Discard' : 'Push',
            ),
            h('button', { className: 'gr-btn', onClick: () => setPending(null) }, 'Cancel'),
          ),
        )
      : null,

    error !== null ? h('div', { className: 'gr-error' }, error) : null,
    notice !== null ? h('div', { className: 'gr-error gr-ok' }, notice) : null,

    // ---- commit ----
    // Above the split, not below it: the conversation composer floats over
    // the bottom of the view, so a commit bar pinned there would be covered.
    h(
      'div',
      { className: 'gr-commit' },
      h('textarea', {
        className: 'gr-msg',
        placeholder: staged.length === 0 ? 'Stage a file to commit…' : 'Commit message',
        value: message,
        disabled: busy,
        onChange: (event: any) => setMessage(event.target.value),
        onKeyDown: (event: any) => {
          // Cmd/Ctrl+Enter commits, the convention every git GUI uses.
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) {
            event.preventDefault()
            void onCommit()
          }
        },
      }),
      h(
        'div',
        { className: 'gr-commit-row' },
        h(
          'label',
          { className: 'gr-check' },
          h('input', {
            type: 'checkbox',
            checked: amend,
            disabled: busy || status?.hasCommits !== true,
            onChange: (event: any) => setAmend(event.target.checked),
          }),
          'Amend last commit',
        ),
        h('span', { className: 'gr-spacer' }),
        h(
          'span',
          { className: 'gr-chip' },
          `${staged.length} staged · ${unstaged.length} changed`,
        ),
        h(
          'button',
          { className: 'gr-btn gr-btn-primary', disabled: !canCommit, onClick: () => void onCommit() },
          amend ? 'Amend' : 'Commit',
        ),
      ),
    ),

    // ---- body ----
    h(
      'div',
      { className: 'gr-body' },
      h(FileList, {
        staged,
        unstaged,
        selection,
        busy,
        onSelect: setSelection,
        onStage,
        onUnstage,
        onDiscard,
      }),
      h(DiffView, {
        path: selection?.path ?? null,
        staged: selection?.staged ?? false,
        parsed,
        loading: diffLoading,
        truncated,
      }),
    ),
  )
}
