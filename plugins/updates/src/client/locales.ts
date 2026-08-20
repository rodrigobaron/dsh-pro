/**
 * `updates` locale namespace. English only, registered under both locale ids:
 * this repository ships no translation, and English reads better than the raw
 * message keys an unregistered namespace would render.
 */
export const NS = 'updates'

export const en = {
  'nav': 'Updates',
  'intro': 'Install new versions of the dsh-pro plugins from GitHub Releases. The download is checksum-verified and the previous install is kept, so an update can be undone.',

  'installed': 'Installed',
  'installed.none': 'No version recorded',
  'installed.hint': 'This profile was set up before the updater existed. Installing the newest release will start recording a version.',
  'installed.local': 'built locally',
  'installed.release': 'from a release',
  'available': 'Available',
  'available.none': 'Nothing published yet',
  'uptodate': 'Up to date.',
  'newVersion': '{version} is available.',
  'prerelease': 'prerelease',
  'published': 'Published {date}',
  'size': '{size} download',
  'notes': 'Release notes',
  'checkedAt': 'Checked {time}',
  'neverChecked': 'Not checked yet',

  'check': 'Check for updates',
  'checking': 'Checking…',
  'install': 'Install {version}',
  'installing': 'Installing…',

  'restart.title': 'Restart to finish',
  'restart.body': 'Version {version} is installed. Restart dsh web and force-refresh this page — the running process still holds the previous build, and the browser has the previous client bundles cached.',
  'restart.command': 'npx @deepseek-ai/dsh web',

  'repository': 'Repository',
  'token.missing': 'No GitHub token configured. A private repository needs one — set DSH_PRO_UPDATE_TOKEN in the environment that runs dsh web.',
  'token.present': 'Authenticated with a configured token.',

  'reason.profile-not-found': 'The harness profile could not be located, so there is nothing to update.',
  'reason.profile-read-only': 'The profile directory is not writable by this process.',
  'reason.no-release-marker': 'This install records no version.',
  'reason.repository-unreachable': 'GitHub could not be reached.',
  'reason.authentication-required': 'GitHub needs a token to read this repository’s releases.',
  'reason.no-releases': 'The repository has published no releases yet.',

  'error': 'Update failed',
  'backup': 'The previous install was kept at {path}.',
} satisfies Record<string, string>
