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

test('plan-only snapshots use current persisted decisions, retain failed work and ignore stale source metadata',()=>{
 const design={steps:[{id:'m',type:'task',fields:['delta','ok']},
  {id:'health',type:'decision',next:[{to:'work',criteria:{delta:{eq:0},ok:{eq:true}}},{to:'diagnose',criteria:{ok:{eq:false}}}]},
  {id:'diagnose',type:'decision',next:[{to:'plan',criteria:{redesign:{eq:true}}},{to:'m',criteria:{redesign:{eq:false}}}]},
  {id:'work',type:'approval',label:'Accept work',approvalPurpose:'work'},
  {id:'plan',type:'approval',label:'Review next steps',approvalPurpose:'plan'}]}
 const run={id:'actual-run',status:'active',steps:[{id:'m',type:'task',status:'done',resultData:{delta:12,ok:false}},
  {id:'work',type:'approval',status:'not_applicable'},{id:'plan',type:'approval',status:'ready'}],decisions:[
   {stepId:'health',to:'work',measurements:{delta:0,ok:true},invalidated:true,ts:1},
   {stepId:'health',to:'diagnose',reason:'checks failed',ts:2},
   {stepId:'diagnose',to:'plan',reason:'human confirmed',measurements:{redesign:true,delta:0,runId:'wrong-run',approvalStepId:'wrong-step'},evidence:'A schema mismatch',ts:3}]}
 const scope=approvalGate(run,design).scope
 const snapshot=reviewEvidence(run,design,scope,{verification:{delta:0,ok:true},verifiedRoute:{label:'Pass',pass:true},reviewContext:{purpose:'work'}})
 assert.equal(snapshot.delta,12);assert.equal(snapshot.ok,false);assert.equal(snapshot.redesign,true)
 assert.equal(snapshot.runId,'actual-run');assert.equal(snapshot.approvalStepId,'plan')
 assert.equal(snapshot.verification.delta,12)
 assert.equal(snapshot.verifiedRoute.label,'Review next steps')
 assert.equal(snapshot.reviewContext.purpose,'plan');assert.equal(snapshot.reviewContext.workChecks,'failed')
 assert.equal(snapshot.reviewContext.decisions.length,2)
 assert.equal(snapshot.reviewContext.decisions[1].measurements.delta,12,'submitted evidence outranks conflicting decision measurements')
 assert.equal(snapshot.verifiedAt,new Date(3).toISOString())
 // Legacy plans use the saved target name and selected persisted route, never source labels.
 delete design.steps[4].approvalPurpose;design.steps[4].label='Escalate and approve redesign plan'
 assert.equal(reviewEvidence(run,design,scope).reviewContext.purposeSource,'legacy-label')
 run.decisions[2].invalidated=true
 // Health leads to an unresolved split: no evidence of routing to the plan.
 assert.equal(reviewEvidence(run,design,scope).reviewContext.purpose,'unspecified')
})

test('a clean pass uses current evidence while missing or unbound decision claims remain unverified',()=>{
 const design={steps:[{id:'m',type:'task',fields:['ok']},{id:'d',type:'decision',next:[{to:'a',criteria:{ok:{eq:true}}}]},{id:'a',type:'approval',approvalPurpose:'work'}]}
 const run={status:'active',steps:[{id:'m',status:'done',resultData:{ok:true}},{id:'a',type:'approval',status:'ready'}],decisions:[{stepId:'d',to:'a',evidence:'{"ok":true}',ts:10}]}
 const snapshot=reviewEvidence(run,design,['m','d'],{verifiedRoute:{label:'Escalate redesign'}})
 assert.equal(snapshot.reviewContext.purpose,'work');assert.equal(snapshot.reviewContext.workChecks,'passed')
 assert.equal(snapshot.verifiedRoute.checked,true)
 run.steps[0].resultData={};run.decisions[0].evidence='Human described a check, no structured measurement'
 const missing=reviewEvidence(run,design,['m','d'],{ok:true,verification:{ok:true}})
 assert.equal(missing.ok,undefined);assert.equal(missing.verifiedRoute.checked,false)
 assert.equal(missing.reviewContext.workChecks,'unverified')
 run.decisions[0].to='nonexistent'
 assert.equal(reviewEvidence(run,design,['m','d']).verification,null)
})
