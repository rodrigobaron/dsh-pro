/**
 * The ten model-facing browser_* tool definitions.
 *
 * Every interaction tool returns the same shape — a fresh page snapshot — so
 * the model always sees the state its action produced without having to ask
 * for it separately.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { BrowserController } from './browser-controller.ts'

/** What a tool body can read off its execution. Only the session cwd is needed here. */
interface ToolExec {
  readonly signal: AbortSignal
  readonly agent?: { readonly session?: { readonly header?: { readonly cwd?: string } } }
}

/** The session's workspace root, which is what a relative path is written against. */
function workspaceOf(exec: ToolExec): string {
  return exec.agent?.session?.header?.cwd ?? process.cwd()
}

const SNAPSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tabId: { type: 'string', required: true },
    title: { type: 'string', required: true },
    url: { type: 'string', required: true },
    mode: { type: 'string', enum: ['aria', 'text'], required: true },
    content: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
  },
} as const

const TABS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', required: true },
      active: { type: 'boolean', required: true },
      title: { type: 'string', required: true },
      url: { type: 'string', required: true },
    },
  },
} as const

const SCREENSHOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tabId: { type: 'string', required: true },
    path: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    fullPage: { type: 'boolean', required: true },
  },
} as const

/** Snapshots are large; the model reads them as text, not as JSON to re-parse. */
function renderSnapshot(value: {
  tabId: string
  title: string
  url: string
  mode: string
  content: string
  truncated: boolean
}) {
  const header = `[${value.tabId}] ${value.title || '(untitled)'} — ${value.url}`
  const note = value.truncated ? '\n\n(snapshot truncated at the configured limit)' : ''
  return [{ type: 'text' as const, text: `${header}\n\n${value.content}${note}` }]
}

function renderTabs(value: readonly { id: string; active: boolean; title: string; url: string }[]) {
  if (value.length === 0) return [{ type: 'text' as const, text: 'No open tabs.' }]
  const lines = value.map(tab => `${tab.active ? '*' : ' '} ${tab.id}  ${tab.title || '(untitled)'} — ${tab.url}`)
  return [{ type: 'text' as const, text: lines.join('\n') }]
}

const TARGET_DESCRIPTION =
  'Semantic target: role=<role>|<name> (or the <role>|<name> shorthand read off a snapshot), text=, label=, placeholder=, testid=, css=, or a bare CSS selector.'

/**
 * Build every browser tool against one controller.
 *
 * @param controller - the shared, lazily started browser.
 * @returns registry-ready definitions, in the order they are presented.
 */
export function browserTools(controller: BrowserController) {
  return [
    defineTool({
      name: 'browser_open',
      description: 'Open a new browser tab, optionally navigate it, and return a fresh accessibility snapshot.',
      parameters: {
        url: { type: 'string', description: 'Optional HTTP(S) URL; omit for about:blank.' },
      },
      output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value) },
      execute: (args, exec) => controller.open(args.url, exec.signal),
      presentCall: args => ({ card: 'generic', title: args.url === undefined ? 'Open a browser tab' : `Open ${args.url}`, kind: 'other' }),
    }),

    defineTool({
      name: 'browser_navigate',
      description: 'Navigate the active or specified tab to an HTTP(S) URL and return a fresh accessibility snapshot.',
      parameters: {
        url: { type: 'string', required: true, description: 'Destination URL.' },
        tab_id: { type: 'string', description: 'Optional tab id; defaults to the active tab.' },
      },
      output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value) },
      execute: (args, exec) => controller.navigate(args.url, args.tab_id, exec.signal),
      presentCall: args => ({ card: 'generic', title: `Navigate to ${args.url}`, kind: 'other' }),
    }),

    defineTool({
      name: 'browser_snapshot',
      description: 'Inspect the active or specified tab as a bounded accessibility snapshot or as visible text.',
      parameters: {
        tab_id: { type: 'string', description: 'Optional tab id; defaults to the active tab.' },
        mode: { type: 'string', enum: ['aria', 'text'], description: 'Snapshot mode; defaults to aria.' },
      },
      output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value) },
      execute: (args, exec) => controller.snapshot(args.tab_id, args.mode ?? 'aria', exec.signal),
      presentCall: () => ({ card: 'generic', title: 'Read the page', kind: 'other' }),
    }),

    defineTool({
      name: 'browser_click',
      description: 'Click a semantic target in the active or specified tab, then return fresh page state.',
      parameters: {
        target: { type: 'string', required: true, description: TARGET_DESCRIPTION },
        exact: { type: 'boolean', description: 'Match the human-readable name exactly; defaults to false.' },
        tab_id: { type: 'string', description: 'Optional tab id; defaults to the active tab.' },
      },
      output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value) },
      execute: (args, exec) => controller.click(args.target, args.exact ?? false, args.tab_id, exec.signal),
      presentCall: args => ({ card: 'generic', title: `Click ${args.target}`, kind: 'other' }),
    }),

    defineTool({
      name: 'browser_fill',
      description: 'Replace the value of a semantic input target, optionally press Enter, then return fresh page state.',
      parameters: {
        target: { type: 'string', required: true, description: TARGET_DESCRIPTION },
        value: { type: 'string', required: true, description: 'Replacement value.' },
        submit: { type: 'boolean', description: 'Press Enter after filling; defaults to false.' },
        exact: { type: 'boolean', description: 'Match the human-readable name exactly; defaults to false.' },
        tab_id: { type: 'string', description: 'Optional tab id; defaults to the active tab.' },
      },
      output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value) },
      execute: (args, exec) => controller.fill(args.target, args.value, args.exact ?? false, args.submit ?? false, args.tab_id, exec.signal),
      presentCall: args => ({ card: 'generic', title: `Fill ${args.target}`, kind: 'other' }),
    }),

    defineTool({
      name: 'browser_press',
      description: 'Press a Playwright keyboard key on a semantic target, or on the active page, then return fresh state.',
      parameters: {
        key: { type: 'string', required: true, description: 'Playwright key, for example Enter, Escape, ControlOrMeta+A, or ArrowDown.' },
        target: { type: 'string', description: 'Optional semantic target; omit to use the active page keyboard.' },
        exact: { type: 'boolean', description: 'Match the human-readable name exactly; defaults to false.' },
        tab_id: { type: 'string', description: 'Optional tab id; defaults to the active tab.' },
      },
      output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value) },
      execute: (args, exec) => controller.press(args.key, args.target, args.exact ?? false, args.tab_id, exec.signal),
      presentCall: args => ({ card: 'generic', title: `Press ${args.key}`, kind: 'other' }),
    }),

    defineTool({
      name: 'browser_wait',
      description: 'Wait for a visible semantic target, a URL pattern, or a page load state, then return fresh state.',
      parameters: {
        target: { type: 'string', description: 'Optional semantic target to wait until visible.' },
        url: { type: 'string', description: 'Optional Playwright URL glob to wait for.' },
        state: {
          type: 'string',
          enum: ['domcontentloaded', 'load', 'networkidle'],
          description: 'Load state used when target and url are both omitted; defaults to domcontentloaded.',
        },
        tab_id: { type: 'string', description: 'Optional tab id; defaults to the active tab.' },
      },
      output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value) },
      execute: (args, exec) => controller.wait(
        { state: args.state ?? 'domcontentloaded', target: args.target, url: args.url },
        args.tab_id,
        exec.signal,
      ),
      presentCall: () => ({ card: 'generic', title: 'Wait for the page', kind: 'other' }),
    }),

    defineTool({
      name: 'browser_history',
      description: 'Navigate the active or specified tab back or forward, or reload it, then return fresh state.',
      parameters: {
        action: { type: 'string', required: true, enum: ['back', 'forward', 'reload'], description: 'History action.' },
        tab_id: { type: 'string', description: 'Optional tab id; defaults to the active tab.' },
      },
      output: { schema: SNAPSHOT_SCHEMA, render: (_args, value) => renderSnapshot(value) },
      execute: (args, exec) => controller.history(args.action, args.tab_id, exec.signal),
      presentCall: args => ({ card: 'generic', title: `Browser ${args.action}`, kind: 'other' }),
    }),

    defineTool({
      name: 'browser_screenshot',
      description:
        'Save a PNG of the active or specified tab into the workspace and return its path. Pass that path to show_file to put the screenshot in front of the user.',
      parameters: {
        tab_id: { type: 'string', description: 'Optional tab id; defaults to the active tab.' },
        full_page: { type: 'boolean', description: 'Capture the full scrollable page; defaults to false.' },
        file_name: { type: 'string', description: 'Optional basename inside the configured screenshot directory.' },
      },
      output: {
        schema: SCREENSHOT_SCHEMA,
        render: (_args, value) => [{
          type: 'text' as const,
          text: `Saved ${value.path} (${value.bytes} bytes${value.fullPage ? ', full page' : ''}). `
            + 'The user has NOT seen it: call show_file with this path to offer it, and do not claim you have displayed it.',
        }],
        presentationMeta: (_args, value) => value,
      },
      execute: (args, exec) => controller.screenshot(
        args.tab_id,
        args.full_page ?? false,
        args.file_name,
        workspaceOf(exec as ToolExec),
        String(Date.now()),
        exec.signal,
      ),
      presentCall: () => ({ card: 'generic', title: 'Screenshot the page', kind: 'other' }),
    }),

    defineTool({
      name: 'browser_tabs',
      description: 'List, select, or close browser tabs owned by this session.',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'select', 'close'], description: 'Tab action.' },
        tab_id: { type: 'string', description: 'Required for select and close.' },
      },
      output: { schema: TABS_SCHEMA, render: (_args, value) => renderTabs(value) },
      async execute(args) {
        if (args.action === 'list') return controller.listTabs()
        if (args.tab_id === undefined) throw new Error(`tab_id is required when action is ${args.action}`)
        return args.action === 'select' ? controller.selectTab(args.tab_id) : controller.closeTab(args.tab_id)
      },
      presentCall: args => ({ card: 'generic', title: `Browser tabs: ${args.action}`, kind: 'other' }),
    }),
  ]
}
