/**
 * The persistent browser, its context, and its tabs.
 *
 * One controller is owned by one Cordis plugin fiber and shared by every agent
 * that loads the browser skill. It starts lazily: nothing launches until the
 * first browser_* call, so a session that never browses never pays for a
 * browser process.
 */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Locator,
  type Page,
} from 'playwright-core'
import { resolveTarget } from './target.ts'

/** Fully resolved runtime configuration. */
export interface BrowserControllerConfig {
  browser: 'chromium' | 'firefox' | 'webkit'
  headless: boolean
  channel?: string
  executablePath?: string
  userDataDir?: string
  viewportWidth: number
  viewportHeight: number
  actionTimeoutMs: number
  navigationTimeoutMs: number
  maxSnapshotChars: number
  screenshotDir: string
  allowMetadataEndpoints: boolean
}

/** Compact tab information, safe to return as tool JSON. */
export interface BrowserTabInfo {
  id: string
  active: boolean
  title: string
  url: string
}

/** Bounded current-page state, returned after navigation and interactions. */
export interface BrowserSnapshot {
  tabId: string
  title: string
  url: string
  mode: 'aria' | 'text'
  content: string
  truncated: boolean
}

/** Screenshot metadata returned to the agent. */
export interface BrowserScreenshot {
  tabId: string
  path: string
  bytes: number
  fullPage: boolean
}

function browserType(name: BrowserControllerConfig['browser']): BrowserType {
  switch (name) {
    case 'chromium': return chromium
    case 'firefox': return firefox
    case 'webkit': return webkit
  }
}

/** IPv4 literals in 169.254.0.0/16 — link-local, and where every cloud puts its instance-metadata service. */
const LINK_LOCAL_V4 = /^169\.254\.\d{1,3}\.\d{1,3}$/
/** Hostnames the major clouds resolve to that same service. */
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'metadata'])
/** AWS's IPv6 instance-metadata address, in the bracketed form a URL carries. */
const METADATA_V6 = new Set(['[fd00:ec2::254]', '[fd00:ec2:0:0:0:0:0:254]'])

/**
 * Reject a URL that points at a cloud instance-metadata service.
 *
 * Private and loopback addresses stay reachable on purpose — testing a local
 * dev server is the single most common reason to hand an agent a browser. The
 * metadata endpoints are the narrow exception: nothing legitimate browses them,
 * and they hand out credentials to anything that asks.
 *
 * This matches the address as written. A DNS name that resolves to 169.254.169.254
 * still gets through; catching that needs resolution-time interception, which
 * this plugin does not do.
 */
function assertNotMetadataEndpoint(url: URL): void {
  const host = url.hostname.toLowerCase()
  if (LINK_LOCAL_V4.test(host) || METADATA_HOSTS.has(host) || METADATA_V6.has(host)) {
    throw new Error(
      `refusing to navigate to ${url.hostname}: cloud instance-metadata addresses are blocked. `
      + 'Set allowMetadataEndpoints: true on the browser profile row if this host is genuinely something else.',
    )
  }
}

function validateUrl(raw: string, allowMetadataEndpoints: boolean): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`invalid URL: ${raw}`)
  }
  if (!['http:', 'https:', 'about:'].includes(url.protocol)) {
    throw new Error(`unsupported URL protocol "${url.protocol}"; browser navigation accepts http, https, and about URLs`)
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('URLs containing embedded credentials are not allowed')
  }
  if (!allowMetadataEndpoints) assertNotMetadataEndpoint(url)
  return url.toString()
}

/**
 * Directories that hold a real browser profile — cookies, saved passwords, and
 * every logged-in session the person has.
 */
function personalProfileRoots(): string[] {
  const home = homedir()
  const localAppData = process.env['LOCALAPPDATA']
  return [
    join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
    join(home, 'Library', 'Application Support', 'Microsoft Edge'),
    join(home, 'Library', 'Application Support', 'Chromium'),
    join(home, 'Library', 'Application Support', 'Firefox'),
    join(home, 'Library', 'Safari'),
    join(home, '.config', 'google-chrome'),
    join(home, '.config', 'chromium'),
    join(home, '.config', 'microsoft-edge'),
    join(home, '.mozilla'),
    ...(localAppData === undefined ? [] : [
      join(localAppData, 'Google', 'Chrome', 'User Data'),
      join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      join(localAppData, 'Chromium', 'User Data'),
    ]),
  ]
}

/**
 * Refuse a `userDataDir` that is, or sits inside, a real browser profile.
 *
 * Handing the agent a personal profile hands it every session the person is
 * signed in to. Upstream documents this as advice; here it is a hard stop,
 * because the failure is silent and total.
 */
function assertDedicatedProfile(userDataDir: string): string {
  const target = resolve(userDataDir)
  for (const root of personalProfileRoots()) {
    if (target === root || target.startsWith(root + sep)) {
      throw new Error(
        `userDataDir must not point at a real browser profile (${root}). `
        + 'Use a directory dedicated to the agent, so automation never touches your signed-in sessions.',
      )
    }
  }
  return target
}

function abortError(): Error {
  const error = new Error('browser operation was cancelled; its tab was closed to stop in-flight Playwright work')
  error.name = 'AbortError'
  return error
}

function failureDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isMissingBrowserExecutable(cause: unknown): boolean {
  return /executable (?:doesn't|does not) exist|executable.*not found|browser.*not found/i.test(failureDetail(cause))
}

type OperationResult<T> = { kind: 'operation'; value: T } | { kind: 'abort' }

/**
 * Run a page operation under cooperative cancellation.
 *
 * Playwright locator calls take no AbortSignal, so cancelling means closing the
 * page, waiting for the interrupted call to settle, and only then reporting the
 * cancellation — the tool must not resolve while Playwright work is still running.
 */
async function runPageOperation<T>(page: Page, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw abortError()
  let resolveAbort: (() => void) | undefined
  const aborted = new Promise<OperationResult<T>>((resolvePromise) => {
    resolveAbort = () => resolvePromise({ kind: 'abort' })
  })
  const onAbort = () => resolveAbort?.()
  signal.addEventListener('abort', onAbort, { once: true })
  const pending = operation()
  const result = await Promise.race<OperationResult<T>>([
    pending.then(value => ({ kind: 'operation' as const, value })),
    aborted,
  ])
  signal.removeEventListener('abort', onAbort)
  if (result.kind === 'operation') return result.value
  await page.close({ runBeforeUnload: false }).catch(() => undefined)
  await pending.catch(() => undefined)
  throw abortError()
}

/** Persistent browser/context/tab controller owned by one Cordis plugin fiber. */
export class BrowserController {
  private browserInstance: Browser | undefined
  private context: BrowserContext | undefined
  private starting: Promise<BrowserContext> | undefined
  private readonly pages = new Map<string, Page>()
  private readonly pageIds = new WeakMap<Page, string>()
  private activeTabId: string | undefined
  private nextTabNumber = 1

  /** @param config - resolved launch, timeout, snapshot, and output settings. */
  constructor(readonly config: BrowserControllerConfig) {}

  /** Start the configured browser lazily and return its reusable context. */
  async start(): Promise<BrowserContext> {
    if (this.context !== undefined) return this.context
    if (this.starting !== undefined) return this.starting
    this.starting = this.launch()
    try {
      return await this.starting
    } finally {
      this.starting = undefined
    }
  }

  private async launch(): Promise<BrowserContext> {
    const type = browserType(this.config.browser)
    if (this.config.browser !== 'chromium' && this.config.channel !== undefined) {
      throw new Error('channel is only supported when browser is chromium')
    }

    const baseOptions = {
      headless: this.config.headless,
      ...(this.config.channel === undefined ? {} : { channel: this.config.channel }),
      ...(this.config.executablePath === undefined ? {} : { executablePath: this.config.executablePath }),
    }
    // Falling back to an installed Chrome or Edge is only meaningful when the
    // deployment has not already named a specific binary.
    const mayFallBack = this.config.browser === 'chromium'
      && this.config.channel === undefined
      && this.config.executablePath === undefined
    const candidates = [
      { label: 'Playwright-managed chromium', options: baseOptions },
      ...(mayFallBack
        ? [
            { label: 'system Chrome', options: { ...baseOptions, channel: 'chrome' } },
            { label: 'system Edge', options: { ...baseOptions, channel: 'msedge' } },
          ]
        : []),
    ]

    const viewport = { width: this.config.viewportWidth, height: this.config.viewportHeight }
    const userDataDir = this.config.userDataDir === undefined ? undefined : assertDedicatedProfile(this.config.userDataDir)
    const failures: string[] = []

    for (const [index, candidate] of candidates.entries()) {
      try {
        if (userDataDir !== undefined) {
          this.context = await type.launchPersistentContext(userDataDir, { ...candidate.options, viewport })
        } else {
          this.browserInstance = await type.launch(candidate.options)
          this.context = await this.browserInstance.newContext({ viewport })
        }
        break
      } catch (cause) {
        await this.browserInstance?.close().catch(() => undefined)
        this.browserInstance = undefined
        failures.push(`${candidate.label}: ${failureDetail(cause)}`)
        // Only a missing executable is worth trying the next candidate for. A
        // launch that failed for any other reason will fail the same way again.
        if (index === 0 && !(mayFallBack && isMissingBrowserExecutable(cause))) break
      }
    }

    if (this.context === undefined) {
      const setup = this.config.browser === 'chromium'
        ? 'Install one with "npx playwright install chromium", install Chrome or Edge, or set channel/executablePath on the browser profile row.'
        : `Install it with "npx playwright install ${this.config.browser}", or set executablePath.`
      throw new Error(`failed to launch ${this.config.browser}; attempted ${failures.join(' | ')}. ${setup}`)
    }

    this.context.setDefaultTimeout(this.config.actionTimeoutMs)
    this.context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs)
    this.context.on('page', page => this.registerPage(page, true))
    for (const page of this.context.pages()) this.registerPage(page, false)
    return this.context
  }

  private registerPage(page: Page, makeActive: boolean): string {
    const known = this.pageIds.get(page)
    if (known !== undefined) {
      if (makeActive) this.activeTabId = known
      return known
    }
    const id = `tab-${this.nextTabNumber++}`
    this.pageIds.set(page, id)
    this.pages.set(id, page)
    if (makeActive || this.activeTabId === undefined) this.activeTabId = id
    page.once('close', () => {
      this.pages.delete(id)
      if (this.activeTabId === id) this.activeTabId = this.pages.keys().next().value as string | undefined
    })
    return id
  }

  private async page(tabId?: string): Promise<{ id: string; page: Page }> {
    await this.start()
    const selected = tabId ?? this.activeTabId
    if (selected !== undefined) {
      const page = this.pages.get(selected)
      if (page !== undefined && !page.isClosed()) return { id: selected, page }
      if (tabId !== undefined) throw new Error(`unknown or closed tab_id: ${tabId}`)
    }
    const context = this.context
    if (context === undefined) throw new Error('browser context did not start')
    const page = await context.newPage()
    return { id: this.registerPage(page, true), page }
  }

  private locator(page: Page, target: string, exact: boolean): Locator {
    return resolveTarget(page, target, exact)
  }

  private url(raw: string): string {
    return validateUrl(raw, this.config.allowMetadataEndpoints)
  }

  /** Open a new active tab and optionally navigate it. */
  async open(url: string | undefined, signal: AbortSignal): Promise<BrowserSnapshot> {
    // Validated before the tab exists, so a rejected URL does not leave a blank
    // tab behind for the model to trip over on its next snapshot.
    const destination = url === undefined ? undefined : this.url(url)
    const context = await this.start()
    const page = await context.newPage()
    const id = this.registerPage(page, true)
    if (destination !== undefined) {
      await runPageOperation(page, signal, () => page.goto(destination, { waitUntil: 'domcontentloaded' }))
    }
    return this.snapshot(id, 'aria', signal)
  }

  /** Navigate one tab and return fresh visible state. */
  async navigate(url: string, tabId: string | undefined, signal: AbortSignal): Promise<BrowserSnapshot> {
    const destination = this.url(url)
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    await runPageOperation(selected.page, signal, () => selected.page.goto(destination, { waitUntil: 'domcontentloaded' }))
    return this.snapshot(selected.id, 'aria', signal)
  }

  /** Return a bounded accessibility or visible-text snapshot. */
  async snapshot(tabId: string | undefined, mode: 'aria' | 'text', signal: AbortSignal): Promise<BrowserSnapshot> {
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    const content = await runPageOperation(selected.page, signal, async () => {
      if (mode === 'text') return selected.page.locator('body').innerText()
      try {
        const aria = await selected.page.locator('body').ariaSnapshot()
        if (aria.trim().length > 0) return aria
      } catch {
        // Some page states expose no accessibility root; visible text still is useful.
      }
      return selected.page.locator('body').innerText()
    })
    return {
      tabId: selected.id,
      title: await selected.page.title(),
      url: selected.page.url(),
      mode,
      content: content.slice(0, this.config.maxSnapshotChars),
      truncated: content.length > this.config.maxSnapshotChars,
    }
  }

  /** Click a semantic target and return fresh state. */
  async click(target: string, exact: boolean, tabId: string | undefined, signal: AbortSignal): Promise<BrowserSnapshot> {
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    await runPageOperation(selected.page, signal, () => this.locator(selected.page, target, exact).click())
    return this.snapshot(this.activeTabId ?? selected.id, 'aria', signal)
  }

  /** Replace the value of a semantic form target and return fresh state. */
  async fill(target: string, value: string, exact: boolean, submit: boolean, tabId: string | undefined, signal: AbortSignal): Promise<BrowserSnapshot> {
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    const locator = this.locator(selected.page, target, exact)
    await runPageOperation(selected.page, signal, async () => {
      await locator.fill(value)
      if (submit) await locator.press('Enter')
    })
    return this.snapshot(this.activeTabId ?? selected.id, 'aria', signal)
  }

  /** Press a keyboard key on a target, or on the active page. */
  async press(key: string, target: string | undefined, exact: boolean, tabId: string | undefined, signal: AbortSignal): Promise<BrowserSnapshot> {
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    await runPageOperation(selected.page, signal, () => target === undefined
      ? selected.page.keyboard.press(key)
      : this.locator(selected.page, target, exact).press(key))
    return this.snapshot(this.activeTabId ?? selected.id, 'aria', signal)
  }

  /** Move through, or reload, one tab's navigation history. */
  async history(action: 'back' | 'forward' | 'reload', tabId: string | undefined, signal: AbortSignal): Promise<BrowserSnapshot> {
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    await runPageOperation(selected.page, signal, async () => {
      if (action === 'back') await selected.page.goBack({ waitUntil: 'domcontentloaded' })
      else if (action === 'forward') await selected.page.goForward({ waitUntil: 'domcontentloaded' })
      else await selected.page.reload({ waitUntil: 'domcontentloaded' })
    })
    return this.snapshot(selected.id, 'aria', signal)
  }

  /** Wait for a target, a URL, or a load state, then return fresh state. */
  async wait(
    options: { state: 'domcontentloaded' | 'load' | 'networkidle'; target?: string; url?: string },
    tabId: string | undefined,
    signal: AbortSignal,
  ): Promise<BrowserSnapshot> {
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    await runPageOperation(selected.page, signal, async () => {
      if (options.target !== undefined) await this.locator(selected.page, options.target, false).waitFor({ state: 'visible' })
      else if (options.url !== undefined) await selected.page.waitForURL(options.url)
      else await selected.page.waitForLoadState(options.state)
    })
    return this.snapshot(selected.id, 'aria', signal)
  }

  /**
   * Capture a PNG and return its absolute path.
   *
   * `workspace` is the session's cwd. Resolving the output directory against it
   * — rather than against the harness process cwd, which is wherever dsh
   * happened to be launched from — is what puts the file inside the artifact
   * canvas's roots, so `show_file` can render it for the user.
   */
  async screenshot(
    tabId: string | undefined,
    fullPage: boolean,
    fileName: string | undefined,
    workspace: string,
    stamp: string,
    signal: AbortSignal,
  ): Promise<BrowserScreenshot> {
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    const directory = isAbsolute(this.config.screenshotDir)
      ? this.config.screenshotDir
      : resolve(workspace, this.config.screenshotDir)
    await mkdir(directory, { recursive: true })
    // basename() keeps a model-supplied name from escaping the directory.
    const safeName = fileName === undefined ? `browser-${stamp}.png` : basename(fileName)
    const pngName = safeName.toLowerCase().endsWith('.png') ? safeName : `${safeName}.png`
    const path = join(directory, pngName)
    const bytes = await runPageOperation(selected.page, signal, () => selected.page.screenshot({ path, type: 'png', fullPage }))
    return { tabId: selected.id, path, bytes: bytes.byteLength, fullPage }
  }

  /** List all controller-owned tabs. */
  async listTabs(): Promise<BrowserTabInfo[]> {
    await this.start()
    return Promise.all([...this.pages].map(async ([id, page]) => ({
      id,
      active: id === this.activeTabId,
      title: await page.title(),
      url: page.url(),
    })))
  }

  /** Select one existing tab. */
  async selectTab(tabId: string): Promise<BrowserTabInfo[]> {
    const selected = await this.page(tabId)
    this.activeTabId = selected.id
    await selected.page.bringToFront()
    return this.listTabs()
  }

  /** Close one tab. */
  async closeTab(tabId: string): Promise<BrowserTabInfo[]> {
    const selected = await this.page(tabId)
    await selected.page.close({ runBeforeUnload: false })
    return this.listTabs()
  }

  /** Close every owned browser resource. */
  async close(): Promise<void> {
    const starting = this.starting
    if (starting !== undefined) await starting.catch(() => undefined)
    const context = this.context
    const browser = this.browserInstance
    this.context = undefined
    this.browserInstance = undefined
    this.activeTabId = undefined
    this.pages.clear()
    if (context !== undefined) await context.close().catch(() => undefined)
    if (browser !== undefined) await browser.close().catch(() => undefined)
  }
}
