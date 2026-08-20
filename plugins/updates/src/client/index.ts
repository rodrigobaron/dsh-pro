/**
 * @dsh-pro/updates client half: an Updates section on the settings page.
 *
 * Everything here reads through /api/updates/* — the host owns the release
 * feed, the checksum verification, and the swap.
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
  ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'updates: dictionaries')
  const t = ctx.locale.bind(NS)
  const Section = makeSection(t)

  // Last of this repository's sections: an update is the thing you reach for
  // least often, and it should not sit above the settings you actually adjust.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'updates',
    order: 95,
    label: () => t('nav'),
    locale: NS,
  }, (props: Record<string, unknown>) => h(Section, props)))
}

module.exports = {
  name: 'updates-ui',
  inject: ['slots', 'locale'],
  apply,
}
