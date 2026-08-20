/**
 * The swap plan and the staging gate.
 *
 * validateStaged is the last check before the live install is moved aside, so
 * every way a tarball can arrive incomplete is pinned here. A gap in this file
 * is a way to delete somebody's install and have nothing to put back.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { planSwap, validateStaged } from '../src/core/plan.ts'

const PLAN = planSwap({
  profileModules: '/home/u/.dsh/profiles/node_modules',
  patchFile: '/home/u/.dsh/profiles/web/cordis.patch.yml',
  backupRoot: '/home/u/.dsh/updates/backups',
  stamp: '2026-08-20T10-00-00-000Z',
})

test('stages beside the live scope so the rename stays on one filesystem', () => {
  assert.equal(PLAN.scopeDir, '/home/u/.dsh/profiles/node_modules/@dsh-pro')
  // A rename across filesystems is not atomic — it degrades to copy+unlink,
  // which is exactly the non-atomic swap the plan exists to avoid.
  assert.equal(PLAN.incomingDir, `${PLAN.scopeDir}.incoming`)
  assert.equal(PLAN.incomingDir.slice(0, PLAN.scopeDir.lastIndexOf('/')), PLAN.scopeDir.slice(0, PLAN.scopeDir.lastIndexOf('/')))
})

test('the backup is stamped, so two updates cannot overwrite each other', () => {
  const other = planSwap({
    profileModules: '/home/u/.dsh/profiles/node_modules',
    patchFile: '/home/u/.dsh/profiles/web/cordis.patch.yml',
    backupRoot: '/home/u/.dsh/updates/backups',
    stamp: '2026-08-21T10-00-00-000Z',
  })
  assert.notEqual(PLAN.backupDir, other.backupDir)
  assert.ok(PLAN.patchBackup.startsWith(PLAN.backupDir))
})

const MANIFEST = { version: '0.2.0', plugins: ['@dsh-pro/rewind', '@dsh-pro/search'] }
const FOUND = ['@dsh-pro/rewind', '@dsh-pro/search']

test('accepts a complete release', () => {
  assert.deepEqual(validateStaged(MANIFEST, '0.2.0', FOUND, true), {
    version: '0.2.0',
    plugins: ['@dsh-pro/rewind', '@dsh-pro/search'],
  })
})

test('refuses a release missing a plugin the manifest promised', () => {
  assert.equal(validateStaged(MANIFEST, '0.2.0', ['@dsh-pro/rewind'], true), 'missing-plugin')
})

test('refuses a version the tag and manifest disagree on', () => {
  // The tag, the asset name, and the manifest state the version independently.
  // Disagreement means something upstream is wrong; install nothing.
  assert.equal(validateStaged(MANIFEST, '0.3.0', FOUND, true), 'version-mismatch')
})

test('refuses a release with no patch, no manifest, or no plugins', () => {
  assert.equal(validateStaged(MANIFEST, '0.2.0', FOUND, false), 'no-patch')
  assert.equal(validateStaged(undefined, '0.2.0', FOUND, true), 'no-manifest')
  assert.equal(validateStaged(null, '0.2.0', FOUND, true), 'no-manifest')
  assert.equal(validateStaged({ plugins: [] }, '0.2.0', FOUND, true), 'no-manifest')
  assert.equal(validateStaged({ version: '0.2.0', plugins: [] }, '0.2.0', FOUND, true), 'no-plugins')
})

test('refuses a manifest whose plugin list is not all strings', () => {
  const bad = { version: '0.2.0', plugins: ['@dsh-pro/rewind', 42] }
  assert.equal(validateStaged(bad, '0.2.0', FOUND, true), 'no-plugins')
})

test('extra plugins on disk are fine — the manifest is the contract', () => {
  const extra = [...FOUND, '@dsh-pro/leftover']
  assert.equal(validateStaged(MANIFEST, '0.2.0', extra, true).version, '0.2.0')
})
