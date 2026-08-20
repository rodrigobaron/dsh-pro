/**
 * `routines` locale namespace. English only, registered under both locale ids:
 * this repository ships no translation, and English reads better than the raw
 * message keys an unregistered namespace would render.
 */
export const NS = 'routines'

export const en = {
  'nav': 'Routines',
  'intro': 'Run a prompt on a schedule. Routines fire inside the dsh web service, so they keep running with this page closed — and stop entirely when the service does.',
  'unattended': 'Nobody is watching a scheduled run. Write prompts that finish on their own and never ask a question.',
  'empty': 'No routines yet.',
  'add': 'New routine',
  'title': 'Name',
  'title.ph': 'Morning triage',
  'prompt': 'Prompt',
  'prompt.ph': 'What should the agent do? Say it in full — nobody will be there to clarify.',
  'cron': 'Schedule',
  'cron.ph': '0 9 * * *',
  'cron.help': 'Five fields: minute hour day month weekday.',
  'workdir': 'Project directory',
  'workdir.ph': 'Leave blank to run in the default workspace',
  'workdir.help': 'A directory starts each run in a fresh session there, loading its AGENTS.md.',
  'save': 'Create routine',
  'saving': 'Creating…',
  'cancel': 'Cancel',
  'next': 'Next run {when}',
  'paused': 'Paused',
  'running': 'Running now',
  'never': 'Not scheduled',
  'run': 'Run now',
  'pause': 'Pause',
  'resume': 'Resume',
  'remove': 'Delete',
  'confirmRemove': 'Delete this routine?',
  'lastRun': 'Last run {when}',
  'lastFailed': 'Last run failed: {error}',
  'loading': 'Loading…',
  'error': 'Routines: {message}',
  'preset.hourly': 'Every hour',
  'preset.daily': 'Every day at 09:00',
  'preset.weekdays': 'Weekdays at 09:00',
  'preset.weekly': 'Mondays at 09:00',
} satisfies Record<string, string>

/** Cron presets offered beside the field, so the common cases need no syntax. */
export const PRESETS: readonly { key: string; cron: string }[] = [
  { key: 'preset.hourly', cron: '0 * * * *' },
  { key: 'preset.daily', cron: '0 9 * * *' },
  { key: 'preset.weekdays', cron: '0 9 * * 1-5' },
  { key: 'preset.weekly', cron: '0 9 * * 1' },
]
