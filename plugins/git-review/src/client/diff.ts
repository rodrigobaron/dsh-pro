/**
 * Unified-diff parsing for the review pane.
 *
 * Only what the renderer needs: hunks, and per-line old/new numbers so both
 * gutters line up. Rename/mode headers are kept as file-level notes rather
 * than being dropped, because "renamed from X" is review-relevant.
 */

export type DiffLineKind = 'add' | 'del' | 'context' | 'meta'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  oldNumber: number | null
  newNumber: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface ParsedDiff {
  hunks: DiffHunk[]
  /** File-level notes: rename, mode change, "Binary files differ". */
  notes: string[]
  binary: boolean
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseDiff(text: string): ParsedDiff {
  const out: ParsedDiff = { hunks: [], notes: [], binary: false }
  if (text === '') return out

  let hunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const raw of text.split('\n')) {
    const header = HUNK_HEADER.exec(raw)
    if (header !== null) {
      hunk = { header: raw, lines: [] }
      out.hunks.push(hunk)
      oldLine = Number(header[1])
      newLine = Number(header[2])
      continue
    }

    if (hunk === null) {
      // Everything before the first hunk is file-level preamble. Most of it is
      // noise the header already shows (diff --git, index, ---/+++), so only
      // the lines carrying information are surfaced.
      if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) {
        out.binary = true
        out.notes.push(raw)
      } else if (raw.startsWith('rename from ') || raw.startsWith('rename to ')) {
        out.notes.push(raw)
      } else if (raw.startsWith('old mode ') || raw.startsWith('new mode ') || raw.startsWith('new file mode ') || raw.startsWith('deleted file mode ')) {
        out.notes.push(raw)
      }
      continue
    }

    if (raw.startsWith('\\')) {
      // "\ No newline at end of file" belongs to the previous line, not to a
      // numbered one of its own.
      hunk.lines.push({ kind: 'meta', text: raw, oldNumber: null, newNumber: null })
      continue
    }

    const marker = raw[0]
    const body = raw.slice(1)
    if (marker === '+') {
      hunk.lines.push({ kind: 'add', text: body, oldNumber: null, newNumber: newLine++ })
    } else if (marker === '-') {
      hunk.lines.push({ kind: 'del', text: body, oldNumber: oldLine++, newNumber: null })
    } else if (marker === ' ') {
      hunk.lines.push({ kind: 'context', text: body, oldNumber: oldLine++, newNumber: newLine++ })
    } else if (raw === '') {
      // A trailing empty string from the final split; ignore rather than
      // rendering a phantom context line.
      continue
    } else {
      hunk.lines.push({ kind: 'meta', text: raw, oldNumber: null, newNumber: null })
    }
  }

  return out
}

/** Totals for the pane header. */
export function countChanges(parsed: ParsedDiff): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const hunk of parsed.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') additions++
      else if (line.kind === 'del') deletions++
    }
  }
  return { additions, deletions }
}
