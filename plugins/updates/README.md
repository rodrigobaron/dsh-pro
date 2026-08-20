# Updates

Installs new versions of every plugin in this repository from GitHub Releases.
**Settings → Updates** shows what is installed and what is available; one button
downloads the release, verifies it, and swaps it into the profile.

## Why not the npm updater

`vision-toolkit` upstream ships a self-updater, and the obvious move was to
lift it out and point it at every plugin. It cannot work here, and the reason
is structural rather than fixable.

That updater is a pnpm/npm-registry updater. Its capability check requires the
plugin to be a **direct dependency of the profile**, installed from a **registry
spec**:

```js
const dependencySpec = manifest.dependencies?.[PACKAGE]
if (dependencySpec === undefined) return { supported: false, reason: 'not-direct-dependency' }
```

Neither holds. `install.sh` copies plugin directories into
`profiles/node_modules/@dsh-pro/`, and `profiles/web/package.json` carries
`"dependencies": {}`. Nothing here is published to npm, so there is no registry
spec to resolve either. Its own check refuses before it does anything — which is
why its panel is hidden in this build rather than wired up.

So the release *is* the distribution channel. CI builds the install; this plugin
unpacks it.

## The release

`.github/workflows/release.yml` fires on a `v*` tag and publishes a tarball
holding the install already assembled:

```
dsh-pro-<version>.tar.gz
├── manifest.json        { version, commit, builtAt, plugins: [...] }
├── modules/@dsh-pro/…    exactly what belongs in profiles/node_modules
└── cordis.patch.yml      the merged loader patch
```

Staging runs through `./install.sh --stage <dir>` — the same code path a local
install uses. A separate packaging script would be a second definition of what
an install *is*, and the two would drift the first time one of them learned
about a new file.

The tag must match `package.json`; the workflow fails rather than publishing a
release that installs as a version nobody can reach again.

## Applying one

1. Read the release feed (the listing endpoint, not `/releases/latest` — that
   one hides prereleases entirely, so a repo with only prereleases reports
   having none).
2. Download the tarball and **verify its sha256** against the release's
   `SHA256SUMS`. A release publishing no checksums is refused rather than
   trusted: "no checksum" and "wrong checksum" have the same consequence once
   the bytes are unpacked over a working install.
3. Unpack to `<scope>.incoming` and check it is complete — the manifest parses,
   the version agrees with the tag, the patch is there, and every plugin the
   manifest promised is on disk.
4. Swap.

The swap ordering is the safety argument, and it lives in
[`src/core/plan.ts`](src/core/plan.ts):

```
rename <scope>          -> <backup>/scope   # the live install is now safe
rename <scope>.incoming -> <scope>          # the new install is now live
```

Between those two renames there is no scope directory. That window is two
renames wide and cannot be closed without an atomic directory swap the platform
does not offer — but it is recoverable, because step one already put a complete
install somewhere known. Staging happens *beside* the live scope so both renames
stay on one filesystem; across filesystems `rename` degrades to copy-then-unlink
and stops being atomic at all.

Any failure after the live install moves restores it before rethrowing. If the
restore itself fails, the error names the exact directory to move back by hand.

Backups are kept, stamped by time, under `~/.dsh/updates/backups`.

## It does not restart the harness

Upstream's updater spawns a detached helper that relaunches the process and
health-checks it, rolling back if the new version does not come up. That is
right for a daemon and wrong here: `dsh web` is normally run in a terminal
somebody is watching, and a detached replacement takes their logs away and
leaves a process they did not start.

So the files land and the settings section says to restart. Force-refresh too —
the browser caches client bundles, and a stale bundle against a new host is
version skew you cannot see.

## A private repository needs a token

`rodrigobaron/dsh-pro` is private, and GitHub answers an anonymous caller with
`404` rather than admitting a private repo exists. The plugin reports that as
`authentication-required` rather than "no releases", because they need different
fixes.

Set a token with `contents: read` in the environment that runs `dsh web`:

```bash
export DSH_PRO_UPDATE_TOKEN=github_pat_…
```

`GITHUB_TOKEN` and `GH_TOKEN` are read too. There is also a `token` config
field, but prefer the environment: the profile patch is a plain-text file that
gets pasted into bug reports.

Downloads use the API asset URL with `Accept: application/octet-stream`, not
`browser_download_url` — the latter answers a private repo with a **200
carrying an HTML sign-in page**, which a naive downloader writes to disk and
then tries to untar.

## Routes

Loopback and same-origin only, the same fence the other write-capable plugins
here use. It matters more on this one: these routes replace the code the harness
loads at boot, so a cross-origin page reaching them would be remote code
execution rather than an annoyance.

| Route | Purpose |
| --- | --- |
| `GET /api/updates/state` | what is installed, what is available |
| `POST /api/updates/check` | re-read the release feed |
| `POST /api/updates/apply` | download, verify, and swap in a release |

## Version records

An install stamps `.release.json` into the scope directory — version, commit,
build time, and whether it came from `./install.sh` or from a release. Without
it the plugin cannot tell 0.1.0 from a build off main, and would offer every
release forever.

## Tests

```bash
npm test --workspace=@dsh-pro/updates
```

34 checks over the parts where being wrong is expensive: version precedence
(including prerelease ordering, where a mistake means never updating or updating
forever), asset and checksum selection, every refusal path in the download, and
the staging gate that runs immediately before the live install is moved.
