/**
 * `at-file` locale namespace: referenced-path dock and settings copy.
 *
 * English only. Upstream carried a Simplified Chinese dictionary as the
 * key-set source of truth with English mirroring it; this repository writes
 * English only, so the English dictionary is now the source of truth and
 * index.ts registers it under both locale ids. Selecting Chinese leaves the
 * harness in Chinese and these panels in English, which beats an unregistered
 * namespace rendering raw message keys.
 */

/** The `at-file` namespace key union. */
export type AtFileKey = keyof typeof en

/** The dictionary. Its key set defines `AtFileKey`. */
export const en = {
  'dock.aria': 'Referenced workspace paths',
  'dock.remove': 'Remove {name}',
  'nav': 'File mentions',
  'settings.title': 'Workspace file mentions',
  'settings.subtitle': 'Type @ to search and reference a workspace path; the plugin passes the path without reading file content.',
  'settings.enabled': 'Enable @ file mentions',
  'settings.enabledDesc': 'Turning this off hides the @ path picker and reference dock, and stops marking selected paths for the model.',
  'settings.ignorePastedMentions': 'Ignore @ mentions in pasted text',
  'settings.ignorePastedMentionsDesc': 'When enabled, @ tokens pasted into the composer stay plain text and are not treated as workspace references.',
  'settings.ignoreFiles': 'File filters',
  'settings.ignoreFilesDesc': 'Rules match basenames only, never directory paths. Use exact names or regular expressions with independent case settings.',
  'settings.scope': 'Filter scope',
  'settings.global': 'Global',
  'settings.workspace': 'Workspace',
  'settings.globalTitle': 'Global rules',
  'settings.globalDesc': 'Applied to every workspace.',
  'settings.workspaceTitle': 'Workspace rules',
  'settings.workspaceDesc': 'Applied only to the selected workspace, alongside the global rules.',
  'settings.workspaceSelect': 'Workspace',
  'settings.noWorkspace': 'No workspace is available',
  'settings.restoreDefaults': 'Restore defaults',
  'settings.clearWorkspace': 'Clear this workspace',
  'settings.emptyGlobal': 'There are no global file filters.',
  'settings.emptyWorkspace': 'This workspace has no additional file filters.',
  'settings.namePlaceholder': 'For example, desktop.ini',
  'settings.regexPlaceholder': 'For example, \\.map$ or ^test-',
  'settings.nameHint': 'Enter a complete file name without a path.',
  'settings.regexHint': 'The regular expression runs against the complete basename, without its directory path.',
  'settings.invalidName': 'A file name cannot contain path separators.',
  'settings.invalidRegex': 'The regular expression is invalid.',
  'settings.duplicateName': 'This file name is already in the current list.',
  'settings.inheritedName': 'This file name is already filtered globally.',
  'settings.add': 'Add',
  'settings.saving': 'Saving',
  'settings.remove': 'Remove {name}',
  'settings.inherited': 'Global rules also applied',
  'settings.ruleType': 'Rule type',
  'settings.kind.exact': 'Exact',
  'settings.kind.regex': 'Regex',
  'settings.caseSensitive': 'Case-sensitive',
  'settings.caseInsensitive': 'Case-insensitive',
  'settings.caseSensitiveOption': 'Case-sensitive',
} satisfies Record<string, string>

/** Locale namespace id registered under ctx.locale. */
export const NS = 'at-file'

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
    /** The @file reference and settings copy. */
    [NS]: AtFileKey
  }
}
