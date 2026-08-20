/**
 * @my-dsh/browser — Playwright browser automation as a PROFILE row.
 *
 * A profile row, not an agent-preset row, so browsing is available under every
 * preset instead of only one. This repository owns no preset, and a plugin
 * that wants to hand the model tools does it the way tool-file-canvas and the
 * vision toolkit do: publish a Skill, then mount the tools into an agent's own
 * `agent.ctx.tools` once that agent loads the skill.
 *
 * That gating is not just tidiness. Ten always-visible browser tools would sit
 * in the schema of every agent in every session, including the overwhelming
 * majority that never open a page.
 */
import Schema from '@deepseek-ai/schemastery'
import { BrowserController, type BrowserControllerConfig } from './browser-controller.ts'
import { SKILL_BODY, SKILL_NAME } from './skill.ts'
import { browserTools } from './tools.ts'

export { BrowserController } from './browser-controller.ts'
export type { BrowserControllerConfig, BrowserScreenshot, BrowserSnapshot, BrowserTabInfo } from './browser-controller.ts'
export { parseTarget, resolveTarget } from './target.ts'
export type { ParsedTarget, TargetKind } from './target.ts'

export const name = 'browser'
export const inject = ['skills']

/** User-configurable browser runtime settings, stated on the profile row. */
export interface Config {
  browser?: 'chromium' | 'firefox' | 'webkit'
  headless?: boolean
  channel?: string
  executablePath?: string
  userDataDir?: string
  viewportWidth?: number
  viewportHeight?: number
  actionTimeoutMs?: number
  navigationTimeoutMs?: number
  maxSnapshotChars?: number
  screenshotDir?: string
  allowMetadataEndpoints?: boolean
}

export const Config: Schema<Config> = Schema.object({
  browser: Schema.union(['chromium', 'firefox', 'webkit'] as const).default('chromium'),
  headless: Schema.boolean().default(true),
  channel: Schema.string(),
  executablePath: Schema.string(),
  userDataDir: Schema.string(),
  viewportWidth: Schema.number().default(1280),
  viewportHeight: Schema.number().default(800),
  actionTimeoutMs: Schema.number().default(15_000),
  navigationTimeoutMs: Schema.number().default(30_000),
  maxSnapshotChars: Schema.number().default(40_000),
  screenshotDir: Schema.string().default('.dsh-browser/screenshots'),
  allowMetadataEndpoints: Schema.boolean().default(false),
}) as Schema<Config>

function positiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`browser: ${field} must be a positive integer`)
}

function resolveConfig(config: Config): BrowserControllerConfig {
  const resolved = config as Required<Omit<Config, 'channel' | 'executablePath' | 'userDataDir'>>
    & Pick<Config, 'channel' | 'executablePath' | 'userDataDir'>
  positiveInteger('viewportWidth', resolved.viewportWidth)
  positiveInteger('viewportHeight', resolved.viewportHeight)
  positiveInteger('actionTimeoutMs', resolved.actionTimeoutMs)
  positiveInteger('navigationTimeoutMs', resolved.navigationTimeoutMs)
  positiveInteger('maxSnapshotChars', resolved.maxSnapshotChars)
  if (resolved.screenshotDir.trim().length === 0) throw new Error('browser: screenshotDir must not be empty')
  return resolved
}

/** The pieces of the harness surface this plugin touches, named rather than imported. */
interface Agent {
  readonly ctx?: { readonly tools?: { register(definition: unknown): () => void } }
}
interface PluginContext {
  skills: { register(registration: Record<string, unknown>): () => void }
  effect(setup: () => unknown, label?: string): unknown
  on(event: string, listener: (...args: never[]) => unknown): () => void
}

/**
 * Register the browser skill and gate the tools behind it.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - the profile row's config, already defaulted by `Config`.
 */
export function apply(ctx: unknown, config: Config): void {
  const plugin = ctx as PluginContext
  const controller = new BrowserController(resolveConfig(config))
  const definitions = browserTools(controller)

  // The browser process belongs to this fiber: when the plugin is disposed or
  // reloaded, the browser goes with it rather than outliving the harness.
  plugin.effect(() => async () => controller.close(), 'browser: owned browser lifecycle')

  plugin.effect(
    () => plugin.skills.register({
      name: SKILL_NAME,
      // Required by SkillRegistration, and easy to miss because the type omits
      // it: without it the skill registers but fails on load with
      // "source must be a string".
      source: 'runtime',
      description:
        'Drive a real Chromium tab: open pages, read them as accessibility snapshots, click, fill, wait, manage tabs, and screenshot. For pages that must be rendered to be understood, and for testing local web apps.',
      whenToUse:
        'Use when a page has to be rendered or interacted with — a client-side app, a local dev server, a form, a visual check. Use web_search to find things; use this to actually open one.',
      content: SKILL_BODY,
    }),
    'browser: skill',
  )

  /** agent -> disposers for the tools mounted into it. */
  const mounted = new Map<object, (() => void)[]>()

  function revealFor(agent: Agent | undefined): void {
    if (agent === undefined || agent === null || mounted.has(agent as object)) return
    const tools = agent.ctx?.tools
    if (tools === undefined) return
    mounted.set(agent as object, definitions.map(definition => tools.register(definition)))
  }

  function detach(agent: Agent | undefined): void {
    if (agent === undefined || agent === null) return
    const disposers = mounted.get(agent as object)
    if (disposers === undefined) return
    mounted.delete(agent as object)
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // An agent the framework has already torn down needs nothing from us.
      }
    }
  }

  plugin.effect(() => {
    const offs = [
      plugin.on('agent/disposed', (({ agent }: { agent: Agent }) => detach(agent)) as never),
      // A successful `skill("browser")` call is the signal. `tools/result`
      // carries the agent that made it, and its `agent.ctx.tools` is the
      // registration surface a profile-level plugin does not otherwise have.
      plugin.on('tools/result', ((exec: { name?: string; agent?: Agent; arguments?: unknown }, result: { isError?: boolean }) => {
        if (result?.isError !== false) return
        if (exec?.name !== 'skill' || exec.agent === undefined) return
        const args = exec.arguments
        if (args === null || typeof args !== 'object') return
        if ((args as { name?: unknown }).name !== SKILL_NAME) return
        try {
          revealFor(exec.agent)
        } catch {
          // A failed mount must not turn into a failed skill call; the agent
          // simply does not get the tools and says so.
        }
      }) as never),
    ]
    return () => {
      for (const off of offs) off()
      for (const agent of [...mounted.keys()]) detach(agent as Agent)
    }
  }, 'browser: skill-gated tools')
}
