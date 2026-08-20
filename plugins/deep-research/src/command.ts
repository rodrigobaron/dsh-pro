/**
 * The `/deep-research <topic>` command, expanded host-side.
 *
 * The command is not a client-side UI action: it is ordinary text the user
 * sends, which the host recognizes on the way into the model and augments with
 * one instruction message. That keeps the transcript showing what the user
 * actually typed, costs no extra turn, and means the command works from a
 * pasted message or a routine prompt as readily as from the composer — the
 * same shape at-file uses for its `@path` markers.
 */
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** The literal the user types. */
export const COMMAND = '/deep-research'

/** The source tag the injected instruction carries. */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'deep-research': { kind: 'deep-research'; topic: string }
  }
}

/** Only text the user actually sent is scanned; external text cannot forge it. */
const USER_SOURCE_KIND = 'user'

/**
 * The research topic in one message, if it opens with the command.
 *
 * Anchored to the start: a message that merely mentions `/deep-research` while
 * discussing it is not a request to run one.
 *
 * @param messages - the user messages entering this step.
 * @returns the topic, or null when no message invokes the command.
 */
export function topicOf(messages: readonly UserMessage[]): string | null {
  for (const message of messages) {
    if (message.source.kind !== USER_SOURCE_KIND) continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      const text = block.text.trimStart()
      if (!text.startsWith(COMMAND)) continue
      const rest = text.slice(COMMAND.length)
      // `/deep-researchfoo` is a different word, not this command.
      if (rest !== '' && !/^[\s]/.test(rest)) continue
      const topic = rest.trim()
      if (topic !== '') return topic
    }
  }
  return null
}

/**
 * The instruction appended when the command is used.
 *
 * It names the skill rather than restating the method, so the methodology
 * lives in exactly one place and a change to it reaches every invocation.
 *
 * @param topic - the research topic, verbatim from the user.
 * @returns one injected user message.
 */
export function instruction(topic: string): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        `The user invoked ${COMMAND}. Research this topic:`,
        '',
        topic,
        '',
        'Load the `deep-research` skill and follow it. Run the search rounds as',
        'a `workflow` call so the modalities fan out in parallel, and keep',
        'looping until two consecutive rounds add nothing new.',
        '',
        'Search is snippet-only in this deployment: there is no page fetch, so',
        'do not write as though you have read the sources.',
      ].join('\n'),
    }],
    source: { kind: 'deep-research', topic },
  })
}
