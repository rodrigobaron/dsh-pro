/**
 * Reading a GitHub release. The asset choice and the checksum lookup decide
 * what gets unpacked over a working install, so both are pinned here.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { assetNameFor, digestFor, pickRelease, readRelease } from '../src/core/release.ts'

const DIGEST = 'a'.repeat(64)

/** A release payload shaped like the API's. */
function release(version, extra = {}) {
  return {
    tag_name: `v${version}`,
    body: 'notes',
    published_at: '2026-08-20T10:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
      { name: assetNameFor(version), url: `https://api.github.com/assets/${version}`, size: 1024 },
      { name: 'SHA256SUMS', url: `https://api.github.com/assets/${version}-sums`, size: 100 },
    ],
    ...extra,
  }
}

test('reads a well-formed release', () => {
  const parsed = readRelease(release('0.2.0'))
  assert.equal(parsed.version, '0.2.0')
  assert.equal(parsed.tag, 'v0.2.0')
  assert.equal(parsed.asset.name, 'dsh-pro-0.2.0.tar.gz')
  assert.equal(parsed.checksums.name, 'SHA256SUMS')
})

test('uses the API asset url, not browser_download_url', () => {
  // browser_download_url answers a private repo with a sign-in page: a 200
  // carrying HTML, which a naive downloader writes to disk and then untars.
  const payload = release('0.2.0')
  payload.assets[0].browser_download_url = 'https://github.com/o/r/releases/download/v0.2.0/x.tar.gz'
  assert.equal(readRelease(payload).asset.url, 'https://api.github.com/assets/0.2.0')
})

test('refuses a release it cannot install', () => {
  assert.equal(readRelease(release('0.2.0', { draft: true })), 'draft')
  assert.equal(readRelease(release('0.2.0', { assets: [] })), 'no-tarball-asset')
  assert.equal(readRelease({ tag_name: 'nightly', assets: [] }), 'unreadable-tag')
  assert.equal(readRelease(null), 'not-a-release')
  assert.equal(readRelease({ assets: [] }), 'not-a-release')
})

test('a tarball named for a different version is not the asset', () => {
  const payload = release('0.2.0')
  payload.assets[0].name = 'dsh-pro-0.1.0.tar.gz'
  assert.equal(readRelease(payload), 'no-tarball-asset')
})

test('picks the newest by version, not by feed order', () => {
  const feed = [release('0.1.0'), release('0.3.0'), release('0.2.0')]
  assert.equal(pickRelease(feed, false).version, '0.3.0')
})

test('prereleases are excluded unless asked for', () => {
  const feed = [release('0.2.0'), release('0.3.0', { prerelease: true })]
  assert.equal(pickRelease(feed, false).version, '0.2.0')
  assert.equal(pickRelease(feed, true).version, '0.3.0')
})

test('an empty or all-unusable feed yields nothing', () => {
  assert.equal(pickRelease([], false), undefined)
  assert.equal(pickRelease([release('0.2.0', { draft: true })], false), undefined)
})

test('finds a digest in a sha256sum manifest', () => {
  const manifest = `${DIGEST}  dsh-pro-0.2.0.tar.gz\n${'b'.repeat(64)}  other.tar.gz\n`
  assert.equal(digestFor(manifest, 'dsh-pro-0.2.0.tar.gz'), DIGEST)
  assert.equal(digestFor(manifest, 'missing.tar.gz'), undefined)
})

test('tolerates binary-mode and single-space manifests, and lowercases', () => {
  assert.equal(digestFor(`${DIGEST} *file.tar.gz`, 'file.tar.gz'), DIGEST)
  assert.equal(digestFor(`${'A'.repeat(64)}  file.tar.gz`, 'file.tar.gz'), 'a'.repeat(64))
})

test('a truncated digest is not accepted as one', () => {
  assert.equal(digestFor(`${'a'.repeat(63)}  file.tar.gz`, 'file.tar.gz'), undefined)
})
