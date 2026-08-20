/**
 * @my-dsh/routines client half: a Routines section on the settings page.
 *
 * Upstream mounts a sidebar entry and a board; this build does neither, so the
 * conversation surface stays exactly as it was. Everything here reads and
 * edits through /api/routines/* — the host owns the ledger, computes next-run
 * times, and does the firing.
 */
import { en, NS } from './locales.ts'
import { makeSection } from './Section.tsx'
import { ensureStyles } from './styles.ts'
import { h } from './react.ts'

interface ClientCtx {
  effect(setup: () => unknown, label?: string): unknown
  slots: {
    inject(name: string, setup: () => unknown): unknown
    register(options: Record<string, unknown>, component?: unknown): () => void
  }
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(namespace: string): (key: string, params?: Record<string, string | number>) => string
  }
}

/**
 * Mount the settings section.
 * @param ctx - the client root context.
 */
function apply(ctx: ClientCtx): void {
  ensureStyles()

  // One English dictionary under both locale ids: this repository ships no
  // translation, and English reads better than raw message keys.
  ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'routines: dictionaries')
  const t = ctx.locale.bind(NS)
  const Section = makeSection(t)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'routines',
    order: 70,
    label: () => t('nav'),
    locale: NS,
  }, (props: Record<string, unknown>) => h(Section, props)))
}

module.exports = {
  name: 'routines-ui',
  inject: ['slots', 'locale'],
  apply,
}
