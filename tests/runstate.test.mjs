import test from 'node:test'
import assert from 'node:assert/strict'
import {reviewFingerprint, matchesReviewFingerprint, guardRunUpdate, approvalGate, reviewEvidence} from '../server/runstate.js'

test('requesting a review exempts only its own administrative step',()=>{
 const design={steps:[{id:'measure',type:'task'},{id:'request',type:'task',action:'request_review'},{id:'sign',type:'approval'}]}
 const run={status:'active',steps:design.steps.map((s,i)=>({...s,status:i===0?'done':i===1?'ready':'pending'}))}
 assert.deepEqual(approvalGate(run,design,undefined,true).open,[])
 assert.deepEqual(approvalGate(run,design).open,['request'],'sign-off still requires a completed request')
 assert.deepEqual(approvalGate({...run,steps:run.steps.map(s=>s.id==='measure'?{...s,status:'ready'}:s)},design,undefined,true).open,['measure'])
 assert.ok(approvalGate(run,design,'other',true).open.length)
 const inputRequest={fields:[{key:'note',type:'string',required:true}],steps:design.steps.map(s=>s.id==='request'?{...s,fields:['note']}:s)}
 assert.deepEqual(approvalGate(run,inputRequest,undefined,true).open,['request'])
 const terminal={steps:design.steps.slice(0,2)}
 assert.deepEqual(approvalGate({...run,steps:run.steps.slice(0,2)},terminal,undefined,true).open,[])
})

test('review snapshots remove unmeasured form defaults and exclude later work',()=>{
 const design={steps:[{id:'measure',type:'task',fields:['count','passed']},{id:'sign',type:'approval'},{id:'later',type:'task',fields:['future']}]}
 const run={steps:[{id:'measure',status:'done',resultData:{count:12}},{id:'later',status:'done',resultData:{count:0,future:99}}]}
 const evidence=reviewEvidence(run,design,['measure'],{count:0,passed:true,verification:{passed:true}})
 assert.equal(evidence.count,12)
 assert.equal(evidence.passed,undefined)
 assert.equal(evidence.future,undefined)
 assert.equal(evidence.verification,null)
})

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
