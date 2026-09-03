import test from 'node:test'
import assert from 'node:assert/strict'
import {createDb} from '../server/db.js'
const configs=[['memory',''],...(process.env.TEST_DATABASE_URL?[['postgres',process.env.TEST_DATABASE_URL]]:[])]
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
  await assert.rejects(()=>db.mergeWorklogData(subject.id,{ok:false}),/approved_immutable/)
 } finally {await db.close()}
})
