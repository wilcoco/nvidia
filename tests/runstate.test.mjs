import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewFingerprint, matchesReviewFingerprint} from '../server/runstate.js'

test('JSONB key ordering does not change the signed evidence fingerprint', () => {
  const browser={steps:[{id:'work',type:'task',status:'done',resultData:{z:2,a:{y:3,x:4}}}],decisions:[{stepId:'check',to:'approve',reason:'verified',ts:1}]}
  const stored={steps:[{type:'task',id:'work',resultData:{a:{x:4,y:3},z:2},status:'done'}],decisions:[{to:'approve',ts:1,reason:'verified',stepId:'check'}]}
  assert.equal(reviewFingerprint(browser),reviewFingerprint(stored))
  const legacy=JSON.stringify({steps:[{id:'work',status:'done',resultData:{z:2,a:{y:3,x:4}}}],decisions:browser.decisions})
  assert.equal(matchesReviewFingerprint(legacy,stored),true)
  stored.steps[0].resultData.a.x=5
  assert.notEqual(reviewFingerprint(browser),reviewFingerprint(stored))
  assert.equal(matchesReviewFingerprint(legacy,stored),false)
})
