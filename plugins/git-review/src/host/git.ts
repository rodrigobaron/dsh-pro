/**
 * Git command surface.
 *
 * Every call goes through `execFile` with an explicit argv array — never a
 * shell string. Branch names, paths, and commit messages are all
 * attacker-influenced in principle (they arrive over HTTP), and argv form
 * means none of them can be reinterpreted as shell syntax.
 */

import { execFile } from 'node:child_process'

/** A git invocation that exited non-zero, carrying git's own stderr. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stderr: string,
    /** Whatever git managed to print before failing. `diff --no-index` puts
     *  the entire diff here and still exits 1, so this is load-bearing. */
    readonly stdout: string,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const TIMEOUT_MS = 30_000

/** Run one git command in `cwd` and resolve its stdout. */
export function git(cwd: string, args: readonly string[], timeoutMs = TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args as string[],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        // A push must never stop on an interactive credential prompt: without
        // this the request would hang until the timeout with no diagnostic.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) return resolve(stdout)
        const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null
        reject(new GitError(stderr.trim() || error.message, code, stderr, stdout))
      },
    )
  })
}

/**
 * Run git, treating exit code 1 as success and returning its stdout.
 *
 * `diff --no-index` and `diff --exit-code` signal "the inputs differ" with
 * exit 1 while printing a perfectly good diff. Those are the only calls that
 * should use this — a real failure still throws.
 */
async function gitAllowingDifference(cwd: string, args: readonly string[]): Promise<string> {
  try {
    return await git(cwd, args)
  } catch (error) {
    if (error instanceof GitError && error.code === 1) return error.stdout
    throw error
  }
}

/** One changed path in the working tree. */
export interface GitFile {
  path: string
  /** Previous path for a rename, else null. */
  from: string | null
  /** Index (staged) status letter from porcelain v2; '.' when unchanged. */
  staged: string
  /** Worktree (unstaged) status letter; '.' when unchanged. */
  unstaged: string
  untracked: boolean
  additions: number
  deletions: number
  /** True when git reports the blob as binary (numstat prints '-'). */
  binary: boolean
}

export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  /** Whether the repo has at least one commit; a fresh init has none. */
  hasCommits: boolean
  files: GitFile[]
}

/**
 * Read the working tree state.
 *
 * Uses `--porcelain=v2 -z`: v2 carries the branch header and rename
 * information the v1 format omits, and NUL termination is the only encoding
 * that survives paths containing spaces, quotes, or newlines intact.
 */
export async function status(cwd: string): Promise<GitStatus> {
  const raw = await git(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'])

  const out: GitStatus = { branch: null, upstream: null, ahead: 0, behind: 0, hasCommits: true, files: [] }
  const byPath = new Map<string, GitFile>()

  // NUL-separated records. A rename record ("2") spends an EXTRA field on its
  // original path, so the cursor advances by two there — which is why this is
  // an index loop rather than a for..of over the split.
  const fields = raw.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const line = fields[i]
    if (line === undefined || line === '') continue

    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length)
      out.branch = head === '(detached)' ? null : head
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      out.upstream = line.slice('# branch.upstream '.length)
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        out.ahead = Number(m[1])
        out.behind = Number(m[2])
      }
      continue
    }
    if (line.startsWith('# branch.oid ')) {
      out.hasCommits = !line.endsWith('(initial)')
      continue
    }
    if (line.startsWith('#')) continue

    const kind = line[0]
    if (kind === '1' || kind === '2') {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      let path: string
      let from: string | null = null
      if (kind === '2') {
        // "2 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>" and the
        // original path follows as the next NUL-separated field.
        path = parts.slice(9).join(' ')
        from = fields[++i] ?? null
      } else {
        path = parts.slice(8).join(' ')
      }
      byPath.set(path, {
        path,
        from,
        staged: xy[0] ?? '.',
        unstaged: xy[1] ?? '.',
        untracked: false,
        additions: 0,
        deletions: 0,
        binary: false,
      })
      continue
    }
    if (kind === '?') {
      const path = line.slice(2)
      byPath.set(path, {
        path,
        from: null,
        staged: '.',
        unstaged: '?',
        untracked: true,
        additions: 0,
        deletions: 0,
        binary: false,
      })
      continue
    }
    // 'u' (unmerged) records: surface the conflict rather than dropping it.
    if (kind === 'u') {
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ')
      byPath.set(path, {
        path,
        from: null,
        staged: 'U',
        unstaged: 'U',
        untracked: false,
        additions: 0,
        deletions: 0,
        binary: false,
      })
    }
  }

  await addLineCounts(cwd, byPath, out.hasCommits)
  out.files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
  return out
}

/**
 * Fill in +/- counts.
 *
 * Tracked changes come from two numstat passes (staged and unstaged); an
 * untracked file has no diff at all, so its additions are counted from the
 * file itself — otherwise every new file would display as "0 / 0".
 */
async function addLineCounts(cwd: string, byPath: Map<string, GitFile>, hasCommits: boolean): Promise<void> {
  const passes: string[][] = [['diff', '--numstat', '-z']]
  if (hasCommits) passes.push(['diff', '--numstat', '-z', '--cached'])
  else passes.push(['diff', '--numstat', '-z', '--cached', '--no-renames'])

  for (const args of passes) {
    let raw = ''
    try {
      raw = await git(cwd, args)
    } catch {
      continue // a pass that cannot run simply contributes no counts
    }
    const parts = raw.split('\0')
    for (let i = 0; i < parts.length; i++) {
      const rec = parts[i]
      if (rec === undefined || rec === '') continue
      const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(rec)
      if (!m) continue
      let path = m[3] as string
      // A rename in -z numstat leaves the path empty and puts old/new in the
      // two following fields.
      if (path === '') {
        i++
        path = parts[++i] ?? ''
      }
      const file = byPath.get(path)
      if (file === undefined) continue
      if (m[1] === '-' || m[2] === '-') {
        file.binary = true
        continue
      }
      file.additions += Number(m[1])
      file.deletions += Number(m[2])
    }
  }

  for (const file of byPath.values()) {
    if (!file.untracked) continue
    try {
      const text = await gitAllowingDifference(cwd, ['diff', '--numstat', '--no-index', '--', '/dev/null', file.path])
      const m = /^(\d+|-)\t(\d+|-)\t/.exec(text)
      if (m === null) continue
      if (m[1] === '-') file.binary = true
      else file.additions = Number(m[1])
    } catch {
      // Counting is cosmetic; an unreadable path just stays at 0.
    }
  }
}

/** Unified diff for one path, staged or unstaged. */
export async function diff(cwd: string, path: string, staged: boolean, untracked: boolean): Promise<string> {
  if (untracked) {
    // An untracked file has no index entry to diff against, so compare it to
    // /dev/null to render it as one big addition.
    return gitAllowingDifference(cwd, ['diff', '--no-color', '--no-index', '--', '/dev/null', path])
  }
  const args = ['diff', '--no-color']
  if (staged) args.push('--cached')
  args.push('--', path)
  return git(cwd, args)
}
