/**
 * Host loader entry for the @my-dsh/routines plugin — the host-authoritative
 * engine (hermes-agent cron shape): a 60s in-process ticker that fires due
 * jobs through the real agent registry (GUI open or not), a file-backed
 * ledger at ~/.dsh/routines/jobs.json, the `routines` model tool so
 * any conversation can create/manage jobs, and /api/@my-dsh/routines routes
 * the web UI reads and writes through.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { HostPluginContext } from './host/contracts.ts'
import { HostJobStore } from './host/store.ts'
import { RoutineRunner } from './host/runner.ts'
import { registerTimerTool } from './host/tools.ts'
import { makeRoutes } from './host/routes.ts'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 201

export const inject = ['webServer', 'tools', 'systemPrompt', 'agents']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const ROUTINES_GUIDANCE = [
  'This machine has the @my-dsh/routines plugin installed: a scheduled-agent engine that lives in the dsh web host process.',
  'A 60-second ticker runs as long as `dsh web` is up, so routines fire with the GUI closed. The ledger is ~/.dsh/routines/jobs.json.',
  '',
  'Each routine has a 5-field cron schedule (for example `0 9 * * *`) and one of three targets:',
  '- a project workdir: every run starts a fresh session in that directory and loads its AGENTS.md',
  '- a pinned session: every run continues that conversation, so it keeps its context',
  '- neither: every run starts a new conversation in the default workspace',
  '',
  'Use the `routines` tool to create, list, update, pause, resume, remove, and run them. The Routines section of the settings page manages the same ledger.',
  '',
  'Scheduled runs cost API quota and happen with nobody watching, so a routine prompt must be self-contained and must never ask a question.',
  'When the user says "routine", "scheduled task", "timer", or "cron", they mean this plugin.',
].join('\n')

/** Settings namespace of the plugin's capability. */
export const ROUTINES_SETTINGS_NAMESPACE = settingsNamespace('routines')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
  /** Master switch for the plugin (ticker + tool + routes). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

/** Schema default, re-read for hand-built test contexts. */
const DEFAULT_ANNOUNCE = true

/**
 * Mount the engine: ticker + runner, tool, routes, announcement.
 * @param ctx - host plugin context (webServer/tools/systemPrompt/agents).
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config?: Config): void {
  const host = ctx as unknown as HostPluginContext
  let current: () => Config = () => config ?? {}
  let disposeEngine: (() => void) | undefined
  let disposeTool: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  const sync = (): void => {
    for (const dispose of [disposeEngine, disposeTool, disposeSection]) dispose?.()
    disposeEngine = undefined
    disposeTool = undefined
    disposeSection = undefined
    if ((current().enabled ?? true) === false) return

    const store = new HostJobStore()
    const runner = new RoutineRunner({ ctx: host, store })
    runner.start()

    disposeTool = ctx.effect(() => registerTimerTool(ctx.tools!, {
      store,
      runner,
      now: () => Date.now(),
    }), '@my-dsh/routines: tool')

    const routes = makeRoutes({ store, runner, ctx: host, now: () => Date.now() })
    disposeEngine = () => {
      void runner.dispose()
      for (const route of routes) void route
    }
    const disposeRoutes = ctx.effect(() => {
      const disposers = routes.map(route => ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, '@my-dsh/routines: routes')
    // Routes unregister with the engine (single teardown path).
    const engineTeardown = disposeEngine
    disposeEngine = () => {
      engineTeardown()
      disposeRoutes()
    }

    if ((current().announceToAgent ?? DEFAULT_ANNOUNCE) === true) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:routines',
        order: SECTION_ORDER,
        text: ROUTINES_GUIDANCE,
      })
    }
  }

  installSettingsSection(ctx, ROUTINES_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => { current = source },
    onChange: sync,
  })

  sync()
}
