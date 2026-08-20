/**
 * Host loader entry for @dsh-pro/updates.
 *
 * Keeps every plugin in this repository up to date from GitHub Releases: read
 * the release feed, download the tarball CI built, verify its checksum, and
 * swap it into the profile with the previous install kept as a backup.
 *
 * Two things this deliberately does not do:
 *
 * - **It does not restart the harness.** Upstream's vision-toolkit updater
 *   spawns a detached helper that relaunches the process and health-checks it.
 *   That is right for a service someone installed as a daemon and wrong here:
 *   `dsh web` is normally run in a terminal the user is watching, and a
 *   detached replacement would take their logs away and leave a process they
 *   did not start. The update lands on disk; the person restarts.
 * - **It does not update itself in place while running.** It writes the new
 *   files and says so. The running process keeps the code it booted with until
 *   it is restarted, which is the only way that is safe to reason about.
 *
 * @module @dsh-pro/updates
 */
import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import type {} from './host/contracts.ts'
import { makeRoutes } from './host/routes.ts'
import { resolveTarget, resolveToken } from './host/paths.ts'
import type { GitHubOptions } from './host/github.ts'

export const inject = ['webServer']

/** The repository releases are read from. */
const DEFAULT_REPOSITORY = 'rodrigobaron/dsh-pro'

/** Plugin config. */
export interface Config {
  /** `owner/repo` to read releases from. */
  repository?: string
  /** Offer prereleases as well as full releases. */
  includePrereleases?: boolean
  /**
   * A GitHub token, if you will not use the environment.
   *
   * Prefer `DSH_PRO_UPDATE_TOKEN` or `GITHUB_TOKEN`: this field lands in the
   * profile patch, which is a plain-text file people paste into bug reports.
   */
  token?: string
}

export const Config: z<Config> = z.object({
  repository: z.string().default(DEFAULT_REPOSITORY),
  includePrereleases: z.boolean().default(false),
  token: z.string().default(''),
})

/**
 * Compose the update surface.
 * @param ctx - the plugin context.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const target = resolveTarget(process.env, process.argv)
  const github = (): GitHubOptions => {
    const token = resolveToken(process.env, config.token)
    return {
      repository: config.repository ?? DEFAULT_REPOSITORY,
      includePrereleases: config.includePrereleases ?? false,
      ...token === undefined ? {} : { token },
    }
  }

  ctx.effect(() => {
    const disposers = makeRoutes({ target, github }).map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'updates: routes')

  console.info(`[updates] watching ${github().repository} for releases; profile at ${target.profileModules}`)
}
