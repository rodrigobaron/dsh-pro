/**
 * @my-dsh/deep-research host half.
 *
 * Two things: the `deep-research` skill (the methodology) and the
 * `/deep-research <topic>` expansion (the way to invoke it).
 *
 * Nothing here writes to the session log. That is deliberate — plugin-authored
 * event types are outside KNOWN_SESSION_EVENT_TYPES and cannot be marked
 * ignorable, so writing one makes the session unreadable rather than merely
 * undrawn. The injected instruction rides `agent/pre-step`, which the harness
 * records as an ordinary message.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only, for its declaration merge: dsh-skill contributes `ctx.skills`.
import type {} from '@deepseek-ai/dsh-skill'
// dsh-agent contributes the `agent/pre-step` waterfall.
import type {} from '@deepseek-ai/dsh-agent'
import { instruction, topicOf } from './command.ts'
import { SKILL_BODY } from './skill.ts'

/** Cordis plugin name. */
export const name = 'deep-research'

/** The skill registry is required; the pre-step hook is a plain listener. */
export const inject = ['skills']

/**
 * Mount the skill and the command expansion.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.skills.register({
    name: 'deep-research',
    // Required by SkillRegistration, and easy to miss: without it the registry
    // accepts the skill and then fails when the model loads it.
    source: 'runtime',
    description:
      'Answer a research question by running a controlled multi-modality search loop as a workflow, '
      + 'with corroboration levels and an explicit stopping rule.',
    whenToUse:
      'Use for a question that needs more than one or two searches — where the answer depends on '
      + 'several angles, on what changed recently, or on whether sources actually agree.',
    content: SKILL_BODY,
  }), 'deep-research: skill')

  // The payload is one object, not positional arguments — `messages` is the
  // user's incoming messages for this step.
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    // Read the topic from what the USER sent, not from the decision: an
    // earlier listener may have rewritten the outgoing messages, and the
    // command belongs to the person who typed it.
    const topic = topicOf(payload.messages)
    if (topic === null) return decision
    return { kind: 'enter', messages: [...decision.messages, instruction(topic)] }
  })
}
