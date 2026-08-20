/**
 * @my-dsh/workflow client half: a workflow progress tree in the transcript.
 *
 * The harness already reconstructs workflow runs as chat nodes
 * (dsh-client-ui-workflow-run), so this is not about moving them out of a
 * sidebar — they are inline already. It is about what the node says. The stock
 * one carries name, phase, member identity and status; its own README notes
 * that outputs, errors and the rest "remain outside this surface". A run in
 * flight is asked how far along it is and what is slow, and neither is
 * answerable without timing.
 *
 * So this folds the same four `tool-workflow/*` events again, keeping
 * `event.time`, and suppresses the stock node so one run does not render
 * twice.
 */
import { apply, isWorkflowEvent, runIdOf, seed, stepOf, RUN_START, type FoldEvent, type RunState } from './fold.ts'
import { en, NS } from './locales.ts'
import { makeWorkflowNode } from './WorkflowNode.tsx'
import { ensureStyles } from './styles.ts'
import { h } from './react.ts'

/** Our node kind, distinct from the stock `workflow-run`. */
const KIND = 'workflow'

interface Match { readonly event: FoldEvent }

interface ClientCtx {
  effect(setup: () => unknown, label?: string): unknown
  get(key: string): unknown
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
 * The node definition: one context per workflow run, folded from its events.
 *
 * `match` returns the run id as the business identity, so the four event types
 * of one run collapse into a single context regardless of what else is
 * interleaved between them in the log.
 */
export const workflowDefinition = {
  kind: KIND,
  target: 'chat',
  match: (event: FoldEvent) => {
    if (!isWorkflowEvent(event)) return null
    const runId = runIdOf(event)
    if (runId === null) return null
    return { id: runId, role: stepOf(event.type) === RUN_START ? 'start' as const : 'update' as const }
  },
  start: (_context: unknown, match: Match): RunState => seed(match.event),
  update: (context: { state: RunState }, match: Match): RunState => apply(context.state, match.event),
  buildViewNode: (context: { state?: RunState }) =>
    context.state === undefined ? null : { kind: KIND, data: context.state },
}

/**
 * Mount the definition, the renderer, and the stock-node suppression.
 * @param ctx - the client root context.
 */
function apply_(ctx: ClientCtx): void {
  ensureStyles()
  ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'workflow-view: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    const conversationEvents = ctx.get('conversationEvents') as
      { register(definition: unknown): () => void } | undefined
    // Soft dependency: without the seam the transcript keeps the stock node
    // and only this richer one goes missing, which is the safe way to fail.
    if (conversationEvents === undefined) return () => {}
    return conversationEvents.register(workflowDefinition)
  }, 'workflow-view: run definition')

  const WorkflowNode = makeWorkflowNode(t)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: KIND, locale: NS },
    (props: Record<string, unknown>) => h(WorkflowNode, props),
  ))

  // Suppress the stock node. Shadowing its keyed renderer at a lower priority
  // is the only way to take a node off the flow — a slot entry can replace a
  // keyed renderer but never filter one — and rendering null is what makes the
  // replacement empty. Its context still exists; nothing else depends on it.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'workflow-run', priority: -1 },
    () => null,
  ))
}

module.exports = {
  name: 'workflow-view',
  inject: ['slots', 'locale'],
  apply: apply_,
}
