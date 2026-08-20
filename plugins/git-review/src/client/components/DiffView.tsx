/**
 * The diff pane: hunks with paired old/new gutters.
 *
 * Rendering is deliberately plain — no syntax highlighting. A diff is read for
 * WHAT CHANGED, and tinting whole lines by add/delete while also colouring
 * tokens by language competes for the same signal. The gutters carry the line
 * numbers so a finding can be quoted back to the agent by position.
 */

import { h } from '../react'
import type { ParsedDiff } from '../diff'
import { countChanges } from '../diff'

interface Props {
  path: string | null
  staged: boolean
  parsed: ParsedDiff | null
  loading: boolean
  truncated: boolean
}

export function DiffView(props: Props) {
  const { path, parsed, loading, truncated } = props

  if (path === null) {
    return h(
      'div',
      { className: 'gr-diff' },
      h('div', { className: 'gr-empty' }, 'Select a file to see its diff'),
    )
  }

  const totals = parsed === null ? { additions: 0, deletions: 0 } : countChanges(parsed)

  return h(
    'div',
    { className: 'gr-diff' },
    h(
      'div',
      { className: 'gr-diff-head' },
      h('span', { className: 'gr-diff-path', title: path }, path),
      h('span', { className: 'gr-chip' }, props.staged ? 'staged' : 'working tree'),
      h('span', { className: 'gr-spacer' }),
      totals.additions > 0 ? h('span', { className: 'gr-counts gr-add' }, `+${totals.additions}`) : null,
      totals.deletions > 0 ? h('span', { className: 'gr-counts gr-del' }, `−${totals.deletions}`) : null,
    ),
    h(
      'div',
      { className: 'gr-diff-body' },
      loading
        ? h('div', { className: 'gr-empty' }, 'Loading diff…')
        : parsed === null
          ? h('div', { className: 'gr-empty' }, 'No diff')
          : parsed.binary
            ? h('div', { className: 'gr-empty' }, 'Binary file — no textual diff')
            : parsed.hunks.length === 0
              ? h(
                  'div',
                  { className: 'gr-empty' },
                  parsed.notes.length > 0 ? parsed.notes.join('\n') : 'No textual changes',
                )
              : h(
                  'div',
                  null,
                  parsed.notes.length > 0
                    ? h('div', { className: 'gr-hunk-head' }, parsed.notes.join('\n'))
                    : null,
                  ...parsed.hunks.map((hunk, hi) =>
                    h(
                      'div',
                      { className: 'gr-hunk', key: `h${hi}` },
                      h('div', { className: 'gr-hunk-head' }, hunk.header),
                      ...hunk.lines.map((line, li) =>
                        h(
                          'div',
                          { className: 'gr-row', 'data-k': line.kind, key: `l${hi}:${li}` },
                          h('span', { className: 'gr-num' }, line.oldNumber === null ? '' : String(line.oldNumber)),
                          h('span', { className: 'gr-num' }, line.newNumber === null ? '' : String(line.newNumber)),
                          h(
                            'span',
                            { className: 'gr-sign' },
                            line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ',
                          ),
                          // A zero-width space keeps an empty changed line from
                          // collapsing to zero height and breaking the gutter
                          // alignment against the numbers beside it.
                          h('span', { className: 'gr-text' }, line.text === '' ? '​' : line.text),
                        ),
                      ),
                    ),
                  ),
                  truncated
                    ? h('div', { className: 'gr-hunk-head' }, '… diff truncated (file too large to show in full)')
                    : null,
                ),
    ),
  )
}
