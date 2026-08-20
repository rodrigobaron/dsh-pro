/** Wire shapes shared with the host half (src/host/git.ts). */

export interface GitFile {
  path: string
  from: string | null
  staged: string
  unstaged: string
  untracked: boolean
  additions: number
  deletions: number
  binary: boolean
}

export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  hasCommits: boolean
  files: GitFile[]
}

/** True when the index holds a change for this path. */
export function isStaged(file: GitFile): boolean {
  return file.staged !== '.' && file.staged !== '?'
}

/** True when the working tree differs from the index. */
export function isUnstaged(file: GitFile): boolean {
  return file.untracked || (file.unstaged !== '.' && file.unstaged !== '?')
}

/** True when git reported the path as unmerged. */
export function isConflicted(file: GitFile): boolean {
  return file.staged === 'U' || file.unstaged === 'U'
}

/** Single-letter badge for a file's state, in review terms. */
export function statusLetter(file: GitFile): string {
  if (isConflicted(file)) return 'U'
  if (file.untracked) return 'A'
  if (file.from !== null) return 'R'
  const letter = isStaged(file) ? file.staged : file.unstaged
  return letter === '.' ? 'M' : letter
}

export function statusLabel(letter: string): string {
  switch (letter) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'U': return 'conflicted'
    default: return 'changed'
  }
}
