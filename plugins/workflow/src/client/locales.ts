/**
 * `workflow-view` locale namespace. English only, registered under both locale
 * ids: this repository ships no translation, and English reads better than the
 * raw message keys an unregistered namespace would render.
 */
export const NS = 'workflow-view'

export const en = {
  'count': '{done}/{total}',
  'countFailed': '{done}/{total} \u00b7 {failed} failed',
  'empty': 'No members started.',
} satisfies Record<string, string>
