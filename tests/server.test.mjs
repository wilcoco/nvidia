import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
const modes=[['memory',''],...(process.env.TEST_DATABASE_URL?[['postgres',process.env.TEST_DATABASE_URL]]:[])]
for(const [mode,url] of modes)test(`${mode}: HTTP guards and cross-login approval`,async()=>{
 const port=18989
 const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATABASE_URL:url,PORT:String(port)},stdio:['ignore','pipe','pipe']})
 let errors='';server.stderr.on('data',b=>errors+=b)
 try {
  await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{if(String(b).includes('listening'))resolve()});server.once('exit',c=>reject(Error(errors||String(c))))})
  const call=async(path,token,body)=>{
   const response=await fetch(`http://127.0.0.1:${port}/api${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(4000)})
   return {status:response.status,body:await response.json()}
  }
  const owner=(await call('/auth/login',null,{username:'judge',password:'webmcp2026'})).body.token
  const reviewer=(await call('/auth/login',null,{username:'park',password:'linepulse'})).body.token
  assert.ok(owner);assert.ok(reviewer)
  for(const id of ['bad','999999999999999999999','0'])assert.equal((await call(`/worklogs/${id}/verification`,owner,{measurements:{ok:true}})).status,400)
  assert.equal((await call('/runs?processId=not-an-id',owner)).status,400)
  if(mode==='postgres'){
   const bad=await call('/worklogs',owner,{date:'2026-09-03',line:'A',task:'TEST out of range',actingAs:'kim',progressPct:1e50})
   assert.equal(bad.status,500)
   assert.equal((await call('/state',owner)).status,200)
  }
  const map={title:'TEST HTTP review',steps:[{id:'work',type:'task',label:'work'},{id:'review',type:'approval',label:'review'}]}
  const process=(await call('/processes',owner,{title:map.title,map,actingAs:'kim'})).body
  const run=(await call('/runs',owner,{processId:process.id,title:map.title})).body
  assert.ok(run.id)
  assert.equal((await call(`/runs/${run.id}`,owner,{steps:[{id:'replacement',type:'approval',status:'done'}]})).status,400)
  assert.equal((await call(`/runs/${run.id}`,owner,{steps:[null]})).status,400)
  const subject=(await call('/worklogs',owner,{date:'2026-09-03',line:'A',task:'TEST evidence',actingAs:'kim',data:{runId:run.id,systemGenerated:true}})).body
  assert.equal((await call(`/worklogs/${subject.id}/submit`,owner,{actingAs:'kim',approver:'lee'})).status,409)
  const steps=[{id:'work',type:'task',status:'done',resultData:{ok:true},completedAt:1},{id:'review',type:'approval',status:'ready'}]
  assert.equal((await call(`/runs/${run.id}`,owner,{steps})).status,200)
  const subs=await Promise.all(Array.from({length:6},()=>call(`/worklogs/${subject.id}/submit`,owner,{actingAs:'kim',approver:'lee'})))
  assert.equal(subs.filter(x=>x.status===200).length,1)
  const old=subs.find(x=>x.status===200).body
  assert.equal((await call(`/runs/${run.id}`,owner,{steps:[{...steps[0],status:'ready'},steps[1]]})).status,200)
  assert.notEqual((await call(`/approvals/${old.id}/decide`,reviewer,{actingAs:'lee',decision:'APPROVED'})).status,200)
  await call(`/runs/${run.id}`,owner,{steps})
  const fresh=(await call(`/worklogs/${subject.id}/submit`,owner,{actingAs:'kim',approver:'lee'})).body
  assert.equal((await call(`/approvals/${fresh.id}/decide`,reviewer,{actingAs:'lee',decision:'APPROVED'})).status,200)
  const final=(await call('/runs',owner)).body.find(r=>r.id===run.id)
  assert.equal(final.status,'completed');assert.equal(final.steps[1].completedBy,'lee')
  // A sign-off controls only its predecessors. Handoff and a second review follow it.
  const middleMap={title:'TEST middle approval',steps:[
   {id:'prepare',type:'task',label:'prepare'}, {id:'first',type:'approval',label:'first sign-off'},
   {id:'handoff',type:'task',label:'handoff'}, {id:'last',type:'approval',label:'final sign-off'}]}
  const midProcess=(await call('/processes',owner,{title:middleMap.title,map:middleMap,actingAs:'kim'})).body
  const midRun=(await call('/runs',owner,{processId:midProcess.id,title:middleMap.title})).body
  const stage=(id)=>call('/worklogs',owner,{date:'2026-09-03',line:'A',task:`TEST ${id} evidence`,actingAs:'kim',data:{runId:midRun.id,systemGenerated:true,approvalStepId:id}})
  const firstSubject=(await stage('first')).body
  const secondSubject=(await stage('last')).body
  const midSteps=middleMap.steps.map((s,i)=>({...s,status:i===0?'done':i===1?'ready':'pending',...(i===0?{completedAt:2,resultData:{ready:true}}:{})}))
  await call(`/runs/${midRun.id}`,owner,{steps:midSteps})
  assert.equal((await call(`/worklogs/${secondSubject.id}/submit`,owner,{actingAs:'kim',approver:'lee'})).status,409)
  const firstReview=await call(`/worklogs/${firstSubject.id}/submit`,owner,{actingAs:'kim',approver:'lee'})
  assert.equal(firstReview.status,200);assert.equal(firstReview.body.stepId,'first')
  // An unrelated downstream field cannot invalidate an upstream review.
  await call(`/runs/${midRun.id}`,owner,{steps:midSteps.map(s=>s.id==='handoff'?{...s,resultData:{future:'unused'}}:s)})
  assert.equal((await call(`/approvals/${firstReview.body.id}/decide`,reviewer,{actingAs:'lee',decision:'APPROVED'})).status,200)
  let mid=(await call('/runs',owner)).body.find(r=>r.id===midRun.id)
  assert.equal(mid.status,'active');assert.equal(mid.steps.find(s=>s.id==='handoff').status,'pending')
  assert.equal(mid.steps.find(s=>s.id==='last').status,'pending')
  assert.equal((await call(`/runs/${midRun.id}`,owner,{steps:mid.steps.map(s=>s.id==='prepare'?{...s,resultData:{ready:false}}:s)})).status,409)
  assert.equal((await call(`/runs/${midRun.id}`,owner,{decisions:{bad:true}})).status,400)
  assert.equal((await call(`/runs/${midRun.id}`,owner,{decisions:[{stepId:'prepare',to:'handoff'}]})).status,409)
  assert.equal((await call(`/worklogs/${secondSubject.id}/submit`,owner,{actingAs:'kim',approver:'lee'})).status,409)
  const event={id:'test-problem-'+midRun.id,ts:Date.now(),kind:'problem',stepId:'handoff',label:'handoff',note:'Need an explicit recipient'}
  await call(`/runs/${midRun.id}`,owner,{steps:mid.steps.map(s=>s.id==='handoff'?{...s,status:'done',resultData:{recipient:'Park'},completedAt:3}:s),events:[event]})
  await call(`/runs/${midRun.id}`,owner,{events:[]})
  const lastReview=await call(`/worklogs/${secondSubject.id}/submit`,owner,{actingAs:'kim',approver:'lee'})
  assert.equal(lastReview.status,200);assert.equal(lastReview.body.stepId,'last')
  assert.equal((await call(`/approvals/${lastReview.body.id}/decide`,reviewer,{actingAs:'lee',decision:'APPROVED'})).status,200)
  mid=(await call('/runs',owner)).body.find(r=>r.id===midRun.id)
  assert.equal(mid.status,'completed')
  assert.ok(mid.events.some(e=>e.id===event.id && e.note===event.note))
  assert.equal(mid.events.filter(e=>e.kind==='approval').length,2)

 } finally {
  server.kill()
  await new Promise(r=>server.exitCode!==null?r():server.once('exit',r))
 }
})
