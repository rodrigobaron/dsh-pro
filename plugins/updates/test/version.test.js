/**
 * Version comparison. This is the only thing standing between "an update is
 * available" and either never offering one or offering the same one forever,
 * so the ordering rules are pinned rather than assumed.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { compareVersions, isNewer, parseVersion } from '../src/core/version.ts'

test('parses a plain and a v-prefixed version', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.deepEqual(parseVersion(' v0.1.0 '), { major: 0, minor: 1, patch: 0, prerelease: [] })
})

test('parses a prerelease tail and ignores build metadata', () => {
  assert.deepEqual(parseVersion('1.0.0-rc.2'), { major: 1, minor: 0, patch: 0, prerelease: ['rc', '2'] })
  assert.deepEqual(parseVersion('1.0.0+build.5')?.prerelease, [])
})

test('rejects what is not a version', () => {
  for (const bad of ['', 'latest', '1.2', 'v1.2.3.4', 'nightly-2026', '1.2.x']) {
    assert.equal(parseVersion(bad), undefined, bad)
  }
})

test('orders by major, then minor, then patch', () => {
  const order = ['0.1.0', '0.1.9', '0.2.0', '1.0.0', '1.0.1', '2.0.0']
  for (let i = 0; i < order.length - 1; i += 1) {
    const a = parseVersion(order[i])
    const b = parseVersion(order[i + 1])
    assert.ok(compareVersions(a, b) < 0, `${order[i]} < ${order[i + 1]}`)
    assert.ok(compareVersions(b, a) > 0, `${order[i + 1]} > ${order[i]}`)
  }
})

test('a release outranks its own prereleases', () => {
  assert.ok(compareVersions(parseVersion('1.0.0'), parseVersion('1.0.0-rc.1')) > 0)
  assert.ok(compareVersions(parseVersion('1.0.0-rc.1'), parseVersion('1.0.0-rc.2')) < 0)
  assert.ok(compareVersions(parseVersion('1.0.0-rc.9'), parseVersion('1.0.0-rc.10')) < 0)
  // Numeric identifiers rank below alphanumeric ones.
  assert.ok(compareVersions(parseVersion('1.0.0-1'), parseVersion('1.0.0-alpha')) < 0)
  // A shorter identifier run is lower precedence when the prefix matches.
  assert.ok(compareVersions(parseVersion('1.0.0-rc'), parseVersion('1.0.0-rc.1')) < 0)
})

test('isNewer moves forward only', () => {
  assert.equal(isNewer('0.1.0', '0.1.1'), true)
  assert.equal(isNewer('0.1.1', '0.1.0'), false)
  assert.equal(isNewer('0.1.0', '0.1.0'), false, 'the same version is not an update')
})

test('an unknown installed version accepts anything; an unreadable tag is never newer', () => {
  // A profile with no marker predates the updater; the honest offer is the
  // newest release rather than nothing.
  assert.equal(isNewer(undefined, '0.1.0'), true)
  assert.equal(isNewer('not-a-version', '0.1.0'), true)
  // A tag we cannot parse is a tag we must not act on.
  assert.equal(isNewer('0.1.0', 'nightly'), false)
  assert.equal(isNewer(undefined, 'latest'), false)
})
