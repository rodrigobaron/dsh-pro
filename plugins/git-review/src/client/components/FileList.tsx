/**
 * The changed-file list, grouped by what git will do with each path.
 *
 * Staged and unstaged are separate groups rather than one list with a badge,
 * because "what goes into the next commit" is the question this pane exists to
 * answer, and a file can appear in BOTH groups when it has staged and
 * unstaged changes — collapsing them would hide that.
 */

import { h } from '../react'
import type { GitFile } from '../types'
import { statusLabel, statusLetter } from '../types'

export interface FileSelection {
  path: string
  staged: boolean
}

interface Props {
  staged: GitFile[]
  unstaged: GitFile[]
  selection: FileSelection | null
  busy: boolean
  onSelect: (selection: FileSelection) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (files: GitFile[]) => void
}

function Row(props: {
  file: GitFile
  staged: boolean
  selected: boolean
  busy: boolean
  onSelect: () => void
  actions: { label: string; title: string; danger?: boolean; run: () => void }[]
}) {
  const letter = statusLetter(props.file)
  const name = props.file.from === null ? props.file.path : `${props.file.path} ← ${props.file.from}`
  return h(
    'div',
    {
      className: 'gr-file',
      'data-selected': props.selected ? 'true' : 'false',
      onClick: props.onSelect,
      role: 'button',
      tabIndex: 0,
      onKeyDown: (event: any) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onSelect()
        }
      },
      title: `${name} — ${statusLabel(letter)}`,
    },
    h('span', { className: 'gr-letter', 'data-k': letter }, letter),
    // `direction: rtl` in CSS keeps the FILENAME visible when a long path is
    // clipped; the bidi isolate stops that flipping punctuation in the text.
    h('span', { className: 'gr-file-name' }, `⁦${name}⁩`),
    props.file.binary
      ? h('span', { className: 'gr-counts' }, 'bin')
      : h(
          'span',
          { className: 'gr-counts' },
          props.file.additions > 0 ? h('span', { className: 'gr-add' }, `+${props.file.additions}`) : null,
          props.file.additions > 0 && props.file.deletions > 0 ? ' ' : null,
          props.file.deletions > 0 ? h('span', { className: 'gr-del' }, `−${props.file.deletions}`) : null,
        ),
    h(
      'span',
      { className: 'gr-file-actions' },
      ...props.actions.map(action =>
        h(
          'button',
          {
            key: action.label,
            className: `gr-btn gr-btn-sm${action.danger === true ? ' gr-btn-danger' : ''}`,
            disabled: props.busy,
            title: action.title,
            onClick: (event: any) => {
              event.stopPropagation()
              action.run()
            },
          },
          action.label,
        ),
      ),
    ),
  )
}

export function FileList(props: Props) {
  const { staged, unstaged, selection, busy } = props
  const isSelected = (file: GitFile, isStagedRow: boolean) =>
    selection !== null && selection.path === file.path && selection.staged === isStagedRow

  if (staged.length === 0 && unstaged.length === 0) {
    return h('div', { className: 'gr-files' }, h('div', { className: 'gr-empty' }, 'Working tree clean'))
  }

  return h(
    'div',
    { className: 'gr-files' },
    h(
      'div',
      { className: 'gr-scroll' },
      staged.length > 0
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'gr-group' },
              h('span', null, `Staged (${staged.length})`),
              h('span', { className: 'gr-spacer' }),
              h(
                'button',
                {
                  className: 'gr-btn gr-btn-sm',
                  disabled: busy,
                  title: 'Unstage every staged file',
                  onClick: () => props.onUnstage(staged.map(f => f.path)),
                },
                'Unstage all',
              ),
            ),
            ...staged.map(file =>
              h(Row, {
                key: `s:${file.path}`,
                file,
                staged: true,
                selected: isSelected(file, true),
                busy,
                onSelect: () => props.onSelect({ path: file.path, staged: true }),
                actions: [{ label: 'Unstage', title: 'Remove from the next commit', run: () => props.onUnstage([file.path]) }],
              }),
            ),
          )
        : null,
      unstaged.length > 0
        ? h(
            'div',
            null,
            h(
              'div',
              { className: 'gr-group' },
              h('span', null, `Changed (${unstaged.length})`),
              h('span', { className: 'gr-spacer' }),
              h(
                'button',
                {
                  className: 'gr-btn gr-btn-sm',
                  disabled: busy,
                  title: 'Stage every change',
                  onClick: () => props.onStage(unstaged.map(f => f.path)),
                },
                'Stage all',
              ),
              h(
                'button',
                {
                  className: 'gr-btn gr-btn-sm gr-btn-danger',
                  disabled: busy,
                  title: 'Throw away every change below — reverts tracked files and deletes untracked ones',
                  onClick: () => props.onDiscard(unstaged),
                },
                'Discard all',
              ),
            ),
            ...unstaged.map(file =>
              h(Row, {
                key: `u:${file.path}`,
                file,
                staged: false,
                selected: isSelected(file, false),
                busy,
                onSelect: () => props.onSelect({ path: file.path, staged: false }),
                actions: [
                  { label: 'Stage', title: 'Include in the next commit', run: () => props.onStage([file.path]) },
                  { label: 'Discard', title: 'Throw these changes away — cannot be undone', danger: true, run: () => props.onDiscard([file]) },
                ],
              }),
            ),
          )
        : null,
    ),
  )
}
