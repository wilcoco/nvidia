import test from 'node:test'
import assert from 'node:assert/strict'
import { versionSdkScripts } from '../scripts/sdk-url.mjs'

test('SDK script URLs follow the app build and can be restamped', () => {
  const shell = '<head><script src="/understudy.js"></script></head>'
  assert.equal(versionSdkScripts(shell, 'abc1234'), '<head><script src="/understudy.js?v=abc1234"></script></head>')
  assert.equal(
    versionSdkScripts(versionSdkScripts(shell, 'abc1234'), 'def5678'),
    '<head><script src="/understudy.js?v=def5678"></script></head>',
  )
  assert.throws(() => versionSdkScripts(shell, 'abc'), /seven-character/)
})
