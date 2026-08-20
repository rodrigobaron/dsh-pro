/**
 * @my-dsh/rewind-picker client half: the `/rewind` command and its dialog.
 *
 * A companion to @my-dsh/rewind rather than part of it. That package's client
 * is upstream's prebuilt bundle — it shadows the framework's user-bubble
 * renderer to put a button on every message, and cannot be extended without
 * rewriting it. This package adds the other entry point, and drives the same
 * POST /rewind route.
 *
 * The command is the plugin's own '/' trigger source, not a host command:
 * nothing is dispatched, no session log record is written, and the invocation
 * never becomes model-visible.
 */
import { applyHiding } from './hide.ts'
import { requestRewindState, type RewoundState } from './api.ts'
import { makePicker } from './Picker.tsx'
import { en, NS } from './locales.ts'
import { pickerStoreOf } from './store.ts'
import { ensureStyles } from './styles.ts'
import type { ClientCtx, InputTriggersFace } from './services.ts'
import { h } from './react.ts'

const COMMAND = 'rewind'
const LINE = '/' + COMMAND

/**
 * Mount the command and the overlay.
 * @param ctx - the client root context.
 */
function apply(ctx: ClientCtx): void {
  ensureStyles()

  // One English dictionary under both locale ids: this repository ships no
  // translation, and English reads better than raw message keys.
  ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'rewind-picker: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    // Soft dependency (ctx.get, not the inject list): a harness without the
    // input-trigger service keeps the dialog available to anything else that
    // opens the store, and only the command goes missing.
    const inputTriggers = ctx.get('inputTriggers') as InputTriggersFace | undefined
    if (inputTriggers === undefined) return () => {}
    return inputTriggers.registerSource({
      trigger: '/',
      name: COMMAND,
      order: 1,
      candidates: (_session, request) => {
        if (request.position !== 'leading') return Promise.resolve([])
        const query = request.query.trim().toLowerCase()
        if (query !== '' && !COMMAND.startsWith(query)) return Promise.resolve([])
        return Promise.resolve([{ name: COMMAND, description: t('cmd.desc') }])
      },
      onPick: (pick) => {
        pickerStoreOf(pick.session.sessionId).set(true)
        return 'handled'
      },
      matchEnter: (session, line) => {
        if (line.trim() !== LINE) return Promise.resolve(undefined)
        pickerStoreOf(session.sessionId).set(true)
        return Promise.resolve<'handled'>('handled')
      },
    })
  }, 'rewind-picker: /rewind command')

  // ── hiding rewound messages in the transcript ──────────────────────────────
  // The rewind is real for the model, but the transcript projects append-origin
  // events and keeps rendering the rewound exchange. There is no supported
  // filter for that, so hide.ts walks the chat flow. See its module comment for
  // why this is a DOM pass rather than a stylesheet.
  const rewoundBySession = new Map<string, RewoundState>()
  let hidingSession: string | undefined

  /** Re-apply hiding for the session on screen. */
  function refreshHiding(sessionId: string): void {
    applyHiding(new Set(rewoundBySession.get(sessionId)?.ids ?? []))
  }

  /** Ask the host what is rewound, then hide it. */
  async function loadHiding(sessionId: string): Promise<void> {
    rewoundBySession.set(sessionId, await requestRewindState(sessionId))
    refreshHiding(sessionId)
  }

  /** Called by the picker once a rewind commits, with the fresh state. */
  function noteRewound(sessionId: string, state: RewoundState): void {
    rewoundBySession.set(sessionId, state)
    refreshHiding(sessionId)
  }

  // The rewind BUTTON lives in the companion package's bundle and posts the
  // route directly, so nothing here would know it happened — the hidden set
  // stayed stale until a reload re-queried it. That bundle now announces a
  // committed rewind on the window, and this re-reads the state.
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    const onRewound = (event: Event): void => {
      const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId
      if (typeof sessionId === 'string' && sessionId !== '') void loadHiding(sessionId)
    }
    window.addEventListener('my-dsh:rewound', onRewound)
    return () => { window.removeEventListener('my-dsh:rewound', onRewound) }
  }, 'rewind-picker: follow rewinds from the message buttons')

  /**
   * Keep hiding applied as the flow re-renders.
   *
   * The chat flow rebuilds rows on every snapshot change, which drops the
   * inline styles, so this re-runs after each mutation. Cheap: the walk is one
   * pass over the rows and does nothing when the session has no rewinds.
   */
  ctx.effect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
    let queued = false
    const observer = new MutationObserver(() => {
      if (queued || hidingSession === undefined) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (hidingSession !== undefined) refreshHiding(hidingSession)
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, 'rewind-picker: keep rewound messages hidden')

  const Picker = makePicker(ctx, t, pickerStoreOf, {
    onSession: (sessionId) => {
      hidingSession = sessionId
      if (!rewoundBySession.has(sessionId)) void loadHiding(sessionId)
      else refreshHiding(sessionId)
    },
    onRewound: noteRewound,
    rewoundSeqs: (sessionId) => new Set(rewoundBySession.get(sessionId)?.seqs ?? []),
  })
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register(
    {
      name: 'conversation.input.overlay',
      id: 'rewind-picker',
      order: 20,
      locale: NS,
      inject: (sessionId: string) => ({ hooks: { rewindPicker: pickerStoreOf(sessionId) } }),
    },
    (props: Record<string, unknown>) => h(Picker, props),
  ))
}

module.exports = {
  name: 'rewind-picker',
  inject: ['slots', 'locale'],
  apply,
}
