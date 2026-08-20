/**
 * `rewind-picker` locale namespace.
 *
 * English only, registered under both locale ids by index.ts: this repository
 * ships no translation, and English reads better than the raw message keys an
 * unregistered namespace would render.
 */
export const NS = 'rewind-picker'

export const en = {
  'cmd.desc': 'Rewind the conversation to an earlier message',
  'title': 'Rewind conversation',
  'subtitle': 'Pick the message to rewind to. It and everything after it leave the conversation, and its text returns to the composer.',
  'filesLead': 'Files are not reverted.',
  'files': 'Code the agent wrote during a rewound turn stays exactly as it is \u2014 only the conversation is rewound.',
  'time.now': 'just now',
  'time.minutes': '{n}m ago',
  'time.hours': '{n}h ago',
  'time.days': '{n}d ago',
  'empty': 'No messages to rewind to yet.',
  'busy': 'The agent is running. Stop the current turn before rewinding.',
  'cancel': 'Cancel',
  'close': 'Close',
  'confirm': 'Rewind to this message',
  'working': 'Rewinding…',
  'position': 'Message {n} of {total}',
  'latest': 'Latest',
  'untitled': '(no text)',
  'error.session-not-found': 'That session is not attached any more.',
  'error.subagent-owned': 'A subagent owns this session, so it cannot be rewound here.',
  'error.agent-busy': 'The agent is running. Stop the current turn, then rewind.',
  'error.message-not-found': 'That message is no longer in the conversation.',
  'error.rewind-rejected': 'That rewind point was refused: {message}',
  'error.transport': 'The rewind request did not reach the server: {message}',
  'error.unknown': 'The rewind failed: {message}',
} satisfies Record<string, string>

export type RewindKey = keyof typeof en
