/**
 * Locating the profile this harness is running.
 *
 * The installer resolves these the same way (DSH_HOME, then the `web` profile);
 * this is the JavaScript restatement of that, and the two must agree or an
 * update would install somewhere the harness does not read.
 *
 * @module @dsh-pro/updates/paths
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { InstallTarget } from './install.ts'

/** The profile a bare `dsh web` runs. */
const DEFAULT_PROFILE = 'web'

/**
 * Read `--profile <name>` out of an argv, matching how dsh itself parses it.
 * @param argv - the process argv.
 * @returns the profile name, or undefined when the default applies.
 */
export function profileFromArgv(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue
    if (arg === '--profile') {
      const value = argv[index + 1]
      if (value !== undefined && !value.startsWith('-')) return value
      continue
    }
    if (arg.startsWith('--profile=')) return arg.slice('--profile='.length)
  }
  return undefined
}

/**
 * Resolve where an update reads and writes.
 * @param env - the process environment.
 * @param argv - the process argv.
 * @returns the profile paths this plugin operates on.
 */
export function resolveTarget(env: NodeJS.ProcessEnv, argv: readonly string[]): InstallTarget {
  const dshHome = env.DSH_HOME !== undefined && env.DSH_HOME !== ''
    ? env.DSH_HOME
    : join(homedir(), '.dsh')
  const profile = profileFromArgv(argv) ?? DEFAULT_PROFILE
  return {
    profileModules: join(dshHome, 'profiles', 'node_modules'),
    patchFile: join(dshHome, 'profiles', profile, 'cordis.patch.yml'),
    workRoot: join(dshHome, 'updates'),
  }
}

/**
 * The token to authenticate release reads with.
 *
 * Environment first, deliberately. The alternative is the profile patch, which
 * is a plain-text YAML file that gets pasted into issue reports; a token there
 * is a token leaked. The config field exists for people who want it anyway.
 *
 * @param env - the process environment.
 * @param configured - a token from plugin config, if any.
 * @returns the token, or undefined when none is available.
 */
export function resolveToken(env: NodeJS.ProcessEnv, configured?: string): string | undefined {
  for (const candidate of [env.DSH_PRO_UPDATE_TOKEN, env.GITHUB_TOKEN, env.GH_TOKEN, configured]) {
    if (typeof candidate === 'string' && candidate !== '') return candidate
  }
  return undefined
}
