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

  const Picker = makePicker(ctx, t, pickerStoreOf)
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
