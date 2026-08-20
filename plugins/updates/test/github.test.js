/**
 * The download path, against a fake fetch.
 *
 * The checksum refusal is the whole security argument of this plugin: it is
 * the only thing between "the release we published" and "whatever arrived over
 * the wire", and what arrives gets unpacked over a working install. Every way
 * it can be bypassed is pinned here.
 */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { downloadRelease, latestRelease, ReleaseCheckError } from '../src/host/github.ts'
import { assetNameFor } from '../src/core/release.ts'

const BODY = Buffer.from('pretend tarball')
const DIGEST = createHash('sha256').update(BODY).digest('hex')

/** A release object as core/release.ts produces one. */
function release(version = '0.2.0', withChecksums = true) {
  return {
    tag: `v${version}`,
    version,
    notes: '',
    publishedAt: '',
    prerelease: false,
    asset: { name: assetNameFor(version), url: 'https://api.github.com/asset', size: BODY.length },
    ...withChecksums
      ? { checksums: { name: 'SHA256SUMS', url: 'https://api.github.com/sums', size: 100 } }
      : {},
  }
}

/** A fetch stand-in that answers the two asset URLs. */
function fakeFetch(sums, tarball = BODY) {
  const seen = []
  const impl = async (url, init) => {
    seen.push({ url, headers: init?.headers ?? {} })
    const body = url.includes('sums') ? Buffer.from(sums) : tarball
    return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } })
  }
  impl.seen = seen
  return impl
}

const options = (fetchImpl, token) => ({
  repository: 'owner/repo',
  includePrereleases: false,
  fetchImpl,
  ...token === undefined ? {} : { token },
})

test('downloads and verifies a matching tarball', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-up-'))
  try {
    const target = join(dir, 'out.tar.gz')
    const digest = await downloadRelease(release(), target, options(fakeFetch(`${DIGEST}  ${assetNameFor('0.2.0')}\n`)))
    assert.equal(digest, DIGEST)
    assert.deepEqual(await readFile(target), BODY)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refuses a tarball whose hash does not match, and writes nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-up-'))
  try {
    const target = join(dir, 'out.tar.gz')
    const wrong = `${'0'.repeat(64)}  ${assetNameFor('0.2.0')}\n`
    await assert.rejects(
      () => downloadRelease(release(), target, options(fakeFetch(wrong))),
      error => error instanceof ReleaseCheckError && error.code === 'checksum-mismatch',
    )
    // Nothing on disk: a rejected tarball must not be left where a later step
    // could pick it up.
    await assert.rejects(() => readFile(target))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refuses a release that publishes no checksums at all', async () => {
  // "No checksum" and "wrong checksum" have the same consequence once the
  // bytes are unpacked, so unsigned releases are refused rather than trusted.
  await assert.rejects(
    () => downloadRelease(release('0.2.0', false), '/tmp/never', options(fakeFetch(''))),
    error => error instanceof ReleaseCheckError && error.code === 'no-checksums',
  )
})

test('refuses when the manifest does not list this tarball', async () => {
  await assert.rejects(
    () => downloadRelease(release(), '/tmp/never', options(fakeFetch(`${DIGEST}  something-else.tar.gz\n`))),
    error => error instanceof ReleaseCheckError && error.code === 'no-checksums',
  )
})

test('sends the token and asks for octet-stream on asset reads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-up-'))
  try {
    const impl = fakeFetch(`${DIGEST}  ${assetNameFor('0.2.0')}\n`)
    await downloadRelease(release(), join(dir, 'out.tar.gz'), options(impl, 'secret-token'))
    for (const call of impl.seen) {
      assert.equal(call.headers.authorization, 'Bearer secret-token')
      // browser_download_url would answer a private repo with an HTML sign-in
      // page; the API url plus this Accept is what returns actual bytes.
      assert.equal(call.headers.accept, 'application/octet-stream')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a 404 without a token reads as authentication, not absence', async () => {
  // A private repository denies its own existence to an anonymous caller.
  const impl = async () => new Response('{}', { status: 404 })
  await assert.rejects(
    () => latestRelease(options(impl)),
    error => error instanceof ReleaseCheckError && error.code === 'authentication-required',
  )
})

test('a 404 with a token reads as no releases', async () => {
  const impl = async () => new Response('{}', { status: 404 })
  await assert.rejects(
    () => latestRelease(options(impl, 'tok')),
    error => error instanceof ReleaseCheckError && error.code === 'no-releases',
  )
})

test('a 403 is reported as an authentication problem', async () => {
  const impl = async () => new Response('{}', { status: 403 })
  await assert.rejects(
    () => latestRelease(options(impl, 'tok')),
    error => error instanceof ReleaseCheckError && error.code === 'authentication-required',
  )
})

test('a transport failure is reported as unreachable, not as a crash', async () => {
  const impl = async () => { throw new Error('ECONNREFUSED') }
  await assert.rejects(
    () => latestRelease(options(impl)),
    error => error instanceof ReleaseCheckError && error.code === 'repository-unreachable',
  )
})
