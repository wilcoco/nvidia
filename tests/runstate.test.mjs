import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewFingerprint, matchesReviewFingerprint, guardRunUpdate} from '../server/runstate.js'

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

test('the final storage guard freezes run identity, evidence, attribution and events',()=>{
 const run={status:'completed',steps:[{id:'a',type:'task',status:'done',completedBy:'kim',resultData:{count:12}}],decisions:[],events:[],deviations:0}
 assert.equal(guardRunUpdate(run,{steps:structuredClone(run.steps)},{steps:run.steps}),false)
 for(const patch of [{status:'active'},{steps:[{...run.steps[0],completedBy:'lee'}]},
  {steps:[{...run.steps[0],resultData:{count:0}}]},{steps:[{id:'other',type:'task',status:'done'}]},
  {events:[{id:'extra',ts:1,kind:'completed'}]}])
  assert.throws(()=>guardRunUpdate(run,patch,{steps:run.steps}),/immutable|mismatch/)
 const active={...run,status:'active',steps:[...run.steps,{id:'sign',type:'approval',status:'done',resultId:'review'},{id:'next',type:'task',status:'ready'}]}
 assert.throws(()=>guardRunUpdate(active,{steps:active.steps.map(s=>s.id==='a'?{...s,completedBy:'lee'}:s)},{steps:active.steps}),/signed_work_immutable/)
})
