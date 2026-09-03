import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import vm from 'node:vm'
import {createDb} from '../server/db.js'

const bundle=await build({stdin:{contents:"export * as map from './sdk/mapstore'; export * as host from './sdk/host'; export * as sync from './sdk/runsync'",resolveDir:process.cwd()},bundle:true,format:'cjs',platform:'node',write:false})
function client(){
 const module={exports:{}}
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,document:{title:'test'},location:{pathname:'/'},setTimeout,clearTimeout,structuredClone})
 return module.exports
}
const configs=[['memory',''],...(process.env.TEST_DATABASE_URL?[['postgres',process.env.TEST_DATABASE_URL]]:[])]
for(const [mode,url] of configs)test(`${mode}: remeasurement, request receipts, rejection and final sign-off stay in one review cycle`,async()=>{
 process.env.DATABASE_URL=url
 const db=await createDb(),{map,host,sync}=client()
 try{
  const design={title:'R3 explicit requests',fields:[{key:'delta',type:'number',required:true},{key:'ok',type:'boolean',required:true}],steps:[
   {id:'m',type:'task',label:'Measure',fields:['delta','ok']},
   {id:'r',type:'task',label:'Request review',action:'request_review'},
   {id:'a',type:'approval',label:'Review',action:'approve_review'}]}
  const saved=await db.saveProcess({title:design.title,map:design,createdBy:'kim'})
  const run=await db.startRun({processId:saved.id,title:design.title,startedBy:'kim',steps:design.steps.map(s=>({...s,status:'pending'}))})
  const w=await db.createWorklog({date:'2026-09-03',line:'QA',task:'Original zero',progressPct:100,hours:0,createdBy:'kim',data:{runId:run.id,delta:0,ok:true}})
  host.setStateProvider(()=>({actingAs:'kim',users:[{username:'kim',role:'Contributor'}]}))
  host.setProcessStore({readRun:id=>db.getRun(id),updateRun:(id,patch)=>db.updateRun(id,patch)})
  map.loadSavedMap(design);sync.resumeRunTracking(run.id)
  map.humanToggleStepDone('m',{delta:12,ok:false});await sync.flushRun()
  const request=async()=>{
   const a=await db.createApproval({worklogId:w.id,approver:'lee',requestedBy:'kim'})
   assert.ok(a)
   map.recordActionSuccess('request_review',String(a.id));await sync.flushRun()
   return a
  }
  const first=await request()
  assert.equal(first.evidence.delta,12)
  map.humanToggleStepDone('m');await sync.flushRun()
  assert.equal((await db.getApproval(first.id)).status,'CANCELLED')
  const reopened=await db.getRun(run.id)
  assert.equal(reopened.steps[0].status,'ready');assert.equal(reopened.steps[1].status,'pending')
  assert.equal(reopened.steps[1].resultId,undefined)
  assert.equal(map.humanToggleStepDone('m',{}),false)
  map.humanToggleStepDone('m',{delta:3,ok:false});map.humanToggleStepDone('r');await sync.flushRun()
  const second=await request()
  await db.decideApproval(second.id,'REJECTED','Clarify the plan')
  const third=await request()
  const current=await db.getRun(run.id)
  assert.equal(current.steps[1].resultId,String(third.id))
  assert.equal(current.events.filter(e=>e.stepId==='r' && e.resultId===String(third.id)).length,1)
  assert.equal((await db.getApproval(first.id)).evidence.delta,12)
  assert.equal(third.evidence.delta,3)
  assert.ok(await db.decideApproval(third.id,'APPROVED','Reviewed actual values'))
  await sync.refreshRunState()
  assert.equal(sync.isRunComplete(),true)
  assert.equal(map.getMap().steps[1].resultId,String(third.id))
  assert.equal(map.getMap().steps[2].resultId,String(third.id))
 }finally{sync.stopRunTracking();await db.close()}
})

for(const [mode,url] of configs)test(`${mode}: replanning scope and decision evidence remain frozen after approval and reload`,async()=>{
 process.env.DATABASE_URL=url
 const db=await createDb()
 try{
  const design={title:'R3 plan evidence',steps:[{id:'m',type:'task',fields:['delta','ok']},
   {id:'health',type:'decision',next:[{to:'pass',criteria:{delta:{eq:0},ok:{eq:true}}},{to:'d',criteria:{ok:{eq:false}}}]},
   {id:'d',type:'decision',next:[{to:'plan',criteria:{redesign:{eq:true}}},{to:'m'}]},
   {id:'pass',type:'approval',approvalPurpose:'work'},{id:'plan',type:'approval',label:'Review proposed plan',approvalPurpose:'plan'}]}
  const saved=await db.saveProcess({title:design.title,map:design,createdBy:'kim'})
  const run=await db.startRun({processId:saved.id,title:design.title,startedBy:'kim',steps:[
   {id:'m',type:'task',status:'done',resultData:{delta:12,ok:false}},
   {id:'pass',type:'approval',status:'not_applicable'},{id:'plan',type:'approval',status:'ready'}]})
  await db.updateRun(run.id,{decisions:[{stepId:'health',to:'d',reason:'failed',ts:1},
   {stepId:'d',to:'plan',reason:'Redesign confirmed',evidence:'{"redesign":true}',ts:2}]})
  const w=await db.createWorklog({date:'2026-09-03',line:'QA',task:'Old pass',progressPct:100,hours:0,createdBy:'kim',data:{runId:run.id,delta:0,ok:true,verification:{ok:true},verifiedRoute:{label:'Pass',pass:true}}})
  const review=await db.createApproval({worklogId:w.id,approver:'lee',requestedBy:'kim'})
  assert.equal(review.evidence.reviewContext.purpose,'plan')
  assert.equal(review.evidence.reviewContext.workChecks,'failed')
  assert.equal(review.evidence.redesign,undefined,'decision-only evidence is not presented as a task measurement')
  assert.equal(review.evidence.reviewContext.decisions.at(-1).measurements.redesign,true)
  assert.equal(review.evidence.reviewContext.decisions.at(-1).measurementSources.redesign,'decision-provided')
  const frozen=JSON.stringify(review.evidence)
  await db.mergeWorklogData(w.id,{verification:{ok:true,redesign:false},verifiedRoute:{label:'Another route',pass:true}})
  assert.ok(await db.decideApproval(review.id,'APPROVED','Approve plan only'))
  assert.equal(JSON.stringify((await db.getApproval(review.id)).evidence),frozen)
  assert.equal((await db.getRun(run.id)).status,'completed')
 }finally{await db.close()}
})
