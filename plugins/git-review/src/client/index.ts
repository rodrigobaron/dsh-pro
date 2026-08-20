/**
 * @my-dsh/git-review — client half.
 *
 * Registers a "Git" tab in the conversation view ring, beside Chat,
 * Trajectory, and Context.
 *
 * The tab needs the repository directory, which is the SESSION's working
 * directory rather than anything global — two sessions can sit in different
 * workspaces. The harness carries that on the sessions snapshot, so it is read
 * per session here and handed to the view; the host still re-validates it
 * against the allowed roots, so a wrong or hostile value cannot reach outside
 * the workspace.
 */

import { GitView } from './components/GitView'
import { React, h } from './react'
import { STYLES } from './styles'

const NS = 'git-review'

// English only, registered under both locale ids so choosing Chinese leaves
// this tab in English rather than rendering raw message keys.
const DICT_EN: Record<string, string> = {
  tab: 'Git',
}

interface SlotRegistration {
  name: string
  id: string
  order: number
  locale?: string
  label?: () => string
}

interface ClientCtx {
  effect(callback: () => () => void, label?: string): unknown
  get(name: string): unknown
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: string) => string
  }
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(registration: SlotRegistration, component: (props: any) => unknown): unknown
  }
}

/** Read one session's working directory from the sessions snapshot. */
function sessionCwd(ctx: ClientCtx, sessionId: string | undefined): string | undefined {
  if (sessionId === undefined) return undefined
  try {
    const sessions = ctx.get('sessions') as
      | { list?: { getSnapshot?: () => { byId?: Record<string, { cwd?: string }> } } }
      | undefined
    const snapshot = sessions?.list?.getSnapshot?.()
    const cwd = snapshot?.byId?.[sessionId]?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    // A harness without this shape simply leaves the view to fall back to the
    // host's root list, which is why this never throws.
    return undefined
  }
}

function apply(ctx: ClientCtx): void {
  ctx.effect(() => ctx.locale.register(NS, { en: DICT_EN, zh: DICT_EN }), 'git-review: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin', NS)
    tag.textContent = STYLES
    document.head.appendChild(tag)
    return () => {
      if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
    }
  }, 'git-review: styles')

  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      // order 30 puts Git right of Chat (0), Trajectory (10), and Context (20).
      { name: 'conversation.view', id: 'git-review', order: 30, locale: NS, label: () => t('tab') },
      (props: { sessionId?: string }) =>
        h(GitView, { ...props, cwd: sessionCwd(ctx, props.sessionId) }),
    ),
  )
}

module.exports = {
  name: 'git-review',
  inject: ['slots', 'locale'],
  apply,
}
