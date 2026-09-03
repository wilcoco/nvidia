import test from 'node:test'
import assert from 'node:assert/strict'
import {createDb} from '../server/db.js'
const configs=[['memory',''],...(process.env.TEST_DATABASE_URL?[['postgres',process.env.TEST_DATABASE_URL]]:[])]
for(const [name,url] of configs) test(`${name}: each review keeps the measured evidence instead of the original log`,async()=>{
 process.env.DATABASE_URL=url
 const db=await createDb()
 try {
  const design={fields:[{key:'delta',type:'number'},{key:'passed',type:'boolean'}],steps:[
   {id:'measure',type:'task',fields:['delta','passed']},{id:'approve',type:'approval'}]}
  const p=await db.saveProcess({title:'review snapshot',createdBy:'kim',map:design})
  const steps=[{...design.steps[0],status:'done',completedAt:1,resultData:{delta:12,passed:false}},
   {...design.steps[1],status:'ready'}]
  const run=await db.startRun({processId:p.id,title:'review snapshot',startedBy:'kim',steps})
  const w=await db.createWorklog({date:'2026-09-03',line:'A',task:'original 0/true',progressPct:100,hours:0,createdBy:'kim',
   data:{runId:run.id,delta:0,passed:true,verification:{delta:0,passed:true}}})
  const first=await db.createApproval({worklogId:w.id,requestedBy:'kim',approver:'lee'})
  assert.equal(first.evidence?.delta,12)
  assert.equal(first.evidence?.passed,false)
  assert.equal(first.evidence?.verification,null,'do not display an old verified pass beside failed measurements')
  await db.updateRun(run.id,{steps:[{...steps[0],completedAt:2,resultData:{delta:0,passed:true}},steps[1]]})
  const second=await db.createApproval({worklogId:w.id,requestedBy:'kim',approver:'lee'})
  const prior=await db.getApproval(first.id)
  assert.equal(prior.status,'CANCELLED')
  assert.equal(prior.evidence.delta,12)
  assert.equal(prior.evidence.passed,false)
  assert.equal(second.evidence.delta,0)
  assert.equal(second.evidence.passed,true)
  assert.equal((await db.getWorklog(w.id)).data.delta,0,'source log stays intact')
  assert.equal(await db.decideApproval(first.id,'APPROVED','stale'),null)
  // Pre-migration pending reviews must remain as history, without silently
  // treating their source log as the missing signed evidence snapshot.
  if(name==='postgres'){
   const {Client}=await import('pg');const client=new Client({connectionString:url})
   await client.connect()
   try{await client.query('UPDATE approvals SET review_evidence=NULL WHERE id=$1',[second.id])}
   finally{await client.end()}
  }else delete second.evidence
  assert.equal(await db.decideApproval(second.id,'APPROVED','legacy'),null)
  assert.equal((await db.getApproval(second.id)).status,'PENDING')
  await db.decideApproval(second.id,'REJECTED','Request a review with a saved evidence snapshot')
  const replacement=await db.createApproval({worklogId:w.id,requestedBy:'kim',approver:'lee'})
  assert.equal(replacement.evidence.delta,0)
  assert.equal(replacement.evidence.passed,true)
  assert.ok(await db.decideApproval(replacement.id,'APPROVED','Current measurements checked'))
 } finally {await db.close()}
})
for(const [name,url] of configs) test(`${name}: atomic reviews, fresh evidence, immutable sign-off`,async()=>{
 process.env.DATABASE_URL=url
 const db=await createDb()
 try {
  assert.equal((await db.listUsers()).length,4)
  const w=await db.createWorklog({date:'2026-09-03',line:'A',task:'test',progressPct:100,hours:0,createdBy:'kim',data:{}})
  const submits=await Promise.all(Array.from({length:8},()=>db.createApproval({worklogId:w.id,requestedBy:'kim',approver:'lee'})))
  assert.equal(submits.filter(Boolean).length,1)
  const a=submits.find(Boolean)
  const decisions=await Promise.all(['APPROVED','REJECTED'].map(status=>db.decideApproval(a.id,status,'test')))
  assert.equal(decisions.filter(Boolean).length,1)
  assert.equal((await db.getWorklog(w.id)).status,decisions.find(Boolean).status.toLowerCase())
  const p=await db.saveProcess({title:'review',createdBy:'kim',map:{steps:[{id:'measure',type:'task'},{id:'approve',type:'approval'}]}})
  const steps=[{id:'measure',type:'task',status:'done',completedAt:1,resultData:{ok:true}},{id:'approve',type:'approval',status:'ready'}]
  const run=await db.startRun({processId:p.id,title:'review',startedBy:'kim',steps})
  const subject=await db.createWorklog({date:'2026-09-03',line:'A',task:'run evidence',progressPct:100,hours:0,createdBy:'kim',data:{runId:run.id,systemGenerated:true}})
  const duplicates=await Promise.all(Array.from({length:8},()=>db.createWorklog({date:'2026-09-03',line:'A',task:'retry',progressPct:100,hours:0,createdBy:'kim',data:{runId:run.id,systemGenerated:true}})))
  assert.ok(duplicates.every(w=>w.id===subject.id))
  const old=await db.createApproval({worklogId:subject.id,requestedBy:'kim',approver:'lee'})
  await db.updateRun(run.id,{steps:[{...steps[0],status:'ready',resultData:{}},steps[1]]})
  assert.equal((await db.getApproval(old.id)).status,'CANCELLED')
  assert.equal(await db.decideApproval(old.id,'APPROVED','stale'),null)
  assert.equal((await db.getWorklog(subject.id)).data.ok,undefined)
  await db.updateRun(run.id,{steps:[{...steps[0],resultData:{ok:false,delta:12}},steps[1]]})
  const corrected=await db.getWorklog(subject.id)
  assert.equal(corrected.data.ok,false)
  assert.equal(corrected.data.delta,12)
  assert.equal(corrected.data.verification,null)
  await db.updateRun(run.id,{steps})
  assert.equal((await db.getWorklog(subject.id)).data.delta,undefined)
  const fresh=await db.createApproval({worklogId:subject.id,requestedBy:'kim',approver:'lee'})
  assert.ok(await db.decideApproval(fresh.id,'APPROVED','fresh'))
  assert.equal((await db.getRun(run.id)).status,'completed')
  await db.updateRun(run.id,{steps,status:'active'})
  const preserved=await db.getRun(run.id)
  assert.equal(preserved.status,'completed')
  assert.equal(preserved.steps[1].completedBy,'lee')
  const finalSnapshot=structuredClone(preserved)
  await assert.rejects(()=>db.updateRun(run.id,{steps:[{id:'different-design',type:'task',status:'done'}]}),/run_design_mismatch/)
  await assert.rejects(()=>db.updateRun(run.id,{steps:preserved.steps.map(s=>s.id==='measure'?{...s,resultData:{ok:false}}:s)}),/finished_run_immutable/)
  assert.deepEqual(await db.getRun(run.id),finalSnapshot)
  await assert.rejects(()=>db.mergeWorklogData(subject.id,{ok:false}),/approved_immutable/)
 } finally {await db.close()}
})

for(const [name,url] of configs)test(`${name}: execution history pages past fifty without duplication`,async()=>{
 process.env.DATABASE_URL=url
 const db=await createDb()
 try{
  const p=await db.saveProcess({title:'pagination only',createdBy:'kim',map:{steps:[{id:'a',type:'task'}]}})
  const ids=[]
  for(let i=0;i<53;i++)ids.push((await db.startRun({processId:p.id,title:'pagination only',startedBy:'kim',steps:[]})).id)
  const first=await db.listRuns(p.id)
  assert.equal(first.length,50);assert.equal(first[0].id,ids[52])
  const earlier=await db.listRuns(p.id,{before:first.at(-1).id,limit:10})
  assert.equal(earlier.length,3)
  assert.deepEqual([...first,...earlier].map(r=>r.id),ids.reverse())
 }finally{await db.close?.()}
})
