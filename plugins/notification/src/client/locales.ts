/**
 * `notification` locale namespace: the settings-section copy and the desktop
 * notification titles/bodies.
 *
 * English only. Upstream carried a Simplified Chinese dictionary as the
 * key-set source of truth with English mirroring it; this repository writes
 * English only, so the English dictionary is now the source of truth and
 * index.ts registers it under both locale ids. Selecting Chinese leaves the
 * harness in Chinese and this section in English, which beats an unregistered
 * namespace rendering raw message keys.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export type NotificationKey = keyof typeof en

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav': 'Notifications',
  'settings.title': 'Task completion notifications',
  'settings.subtitle': 'Get a browser notification when DSH finishes an operation, with keyword rules to control exactly which messages notify.',
  'settings.enabled': 'Enable notifications',
  'settings.enabledDesc': 'Turning this off stops every notification; rules and preferences are kept.',
  'settings.permission.title': 'Browser permission',
  'settings.permission.desc': 'Notifications need browser permission. Grant it below, then send a test notification to confirm it works.',
  'settings.permission.granted': 'Granted',
  'settings.permission.denied': 'Denied (re-enable in the browser\'s site settings)',
  'settings.permission.default': 'Not granted',
  'settings.permission.defaultHint': 'Notification permission is not granted yet: click Request permission and allow it in the browser prompt.',
  'settings.permission.deniedHint': 'Notification permission was denied: re-enable notifications for this site in the browser\'s site settings, then try again.',
  'settings.permission.request': 'Request permission',
  'settings.permission.test': 'Send test notification',
  'settings.permission.testSent': 'The test notification was requested. If it is not visible, check the browser site permission, system notification settings, and Focus or Do Not Disturb mode.',
  'settings.permission.testFailed': 'The browser could not create the test notification: {message}',
  'settings.when.title': 'When to notify',
  'settings.when.subtitle': 'Choose which end states trigger a notification.',
  'settings.when.completed': 'Completed',
  'settings.when.error': 'Failed',
  'settings.when.aborted': 'Aborted',
  'settings.when.blocked': 'Blocked',
  'settings.when.maxTokens': 'Hit token limit',
  'settings.pending.title': 'Awaiting confirmation',
  'settings.pending.subtitle': 'Get notified when DSH waits for your approval, answer, or plan review.',
  'settings.pending.approval': 'Awaiting approval',
  'settings.pending.question': 'Awaiting an answer',
  'settings.pending.planReview': 'Awaiting plan review',
  'settings.rules.title': 'Keyword rules',
  'settings.rules.subtitle': 'Rules match the turn\'s reply text and called tool names. Include rules: notify only if one matches. Exclude rules: suppress on match.',
  'settings.rules.empty': 'No rules yet — every enabled end state notifies.',
  'settings.rules.add': 'Add rule',
  'settings.rules.save': 'Save rules',
  'settings.rules.mode.include': 'Include',
  'settings.rules.mode.exclude': 'Exclude',
  'settings.rules.patternPlaceholder': 'Keyword or regular expression',
  'settings.rules.regex': 'Regex',
  'settings.rules.case': 'Case sensitive',
  'settings.rules.remove': 'Remove rule',
  'settings.rules.invalid': 'Rule pattern must not be empty',
  'settings.rules.invalidRegex': 'Invalid regular expression',
  'settings.rules.unsaved': 'Rules have unsaved changes',
  'settings.rules.saveHint': 'Fill in the rule pattern first, then save',
  'settings.advanced.title': 'Advanced',
  'settings.advanced.requireInteraction': 'Require manual dismiss',
  'settings.advanced.requireInteractionDesc': 'The notification stays until you dismiss it (for important tasks).',
  'settings.advanced.backgroundOnly': 'Only notify when the task is out of view',
  'settings.advanced.backgroundOnlyDesc': 'Suppress notifications only for the session currently in view; still notify in the background or while viewing another session or workspace.',
  'notify.titleCompleted': 'DSH finished',
  'notify.titleError': 'DSH failed',
  'notify.titleAborted': 'DSH aborted',
  'notify.titleBlocked': 'DSH needs attention',
  'notify.titleMaxTokens': 'DSH hit the token limit',
  'notify.titleApproval': 'DSH needs your approval',
  'notify.titleQuestion': 'DSH needs your answer',
  'notify.titlePlanReview': 'DSH needs your plan review',
  'notify.pendingBody': 'There is a pending action',
  'notify.emptyBody': 'The task is done',
  'notify.testTitle': 'DSH notification test',
  'notify.testBody': 'If you can see this notification, notifications are configured correctly.',
} satisfies Record<string, string>

/** Locale namespace id registered under ctx.locale. */
export const NS = 'notification'

/**
 * Fill one dictionary template's `{name}`-style placeholders.
 * @param template - dictionary text.
 * @param params - placeholder values; absent params replace nothing.
 * @returns the filled text.
 */
export function fmt(template: string, params?: Record<string, string>): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => params[key] ?? whole)
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The notification settings copy and titles. */
    [NS]: NotificationKey
  }
}
