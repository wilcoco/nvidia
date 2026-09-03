import test from 'node:test'
import assert from 'node:assert/strict'
import {buildRefMatchesCommit} from '../scripts/release-build-ref.mjs'

const release = 'c9716f910e0b0b0e4f349b9322d9f77c5d321dad'

test('the current exact seven- or forty-character SHA matches the release', () => {
  assert.equal(buildRefMatchesCommit(release, 'c9716f9', 'RUN_BUILD'), true)
  assert.equal(buildRefMatchesCommit(release, release, 'RUN_BUILD'), true)
})

test('an older valid build SHA does not match the current release', () => {
  assert.equal(buildRefMatchesCommit(release, '5d925a8', 'RUN_BUILD'), false)
})

test('a one-character build prefix is rejected', () => {
  assert.throws(() => buildRefMatchesCommit(release, 'c', 'RUN_BUILD'), /exactly 7 or 40/)
})

test('a non-hex build reference is rejected', () => {
  assert.throws(() => buildRefMatchesCommit(release, 'release', 'RUN_BUILD'), /lowercase hexadecimal/)
})
