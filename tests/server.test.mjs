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
  const resetBefore=(await call('/state',owner)).body
  assert.equal((await call('/admin/reset',owner,{scope:'all'})).status,403)
  const resetAfter=(await call('/state',owner)).body
  assert.deepEqual(resetAfter,resetBefore)
  const formMap={title:'TEST assigned form',fields:[{key:'quantity',type:'number',required:true},{key:'method',type:'select',options:['Courier','Pickup'],required:true}],steps:[{id:'input',type:'task',label:'Delivery inputs',fields:['quantity','method']}]}
  const noOwner={...formMap,steps:[{id:'input',type:'task',label:'Delivery inputs'}]}
  assert.equal((await call('/processes',owner,{title:formMap.title,map:noOwner})).status,400)
  const formProcess=await call('/processes',owner,{title:formMap.title,map:formMap,actingAs:'kim'})
  assert.equal(formProcess.status,200)
  const formRun=(await call('/runs',owner,{processId:formProcess.body.id,title:formMap.title})).body
  for(const resultData of [{},{quantity:'12',method:'Pickup'},{quantity:12,method:'Other'}])
    assert.equal((await call(`/runs/${formRun.id}`,owner,{steps:[{id:'input',type:'task',status:'done',resultData}]})).status,400)
  assert.equal((await call(`/runs/${formRun.id}`,owner,{status:'completed',steps:[{id:'input',type:'task',status:'done',resultData:{quantity:12.5,method:'Pickup'}}]})).status,200)
  assert.equal((await call(`/runs/${formRun.id}`,null)).status,401)
  const otherViewer=await call(`/runs/${formRun.id}`,reviewer)
  assert.equal(otherViewer.status,200)
  assert.deepEqual(otherViewer.body.steps[0].resultData,{quantity:12.5,method:'Pickup'})
  const startingWork=(await call('/worklogs',owner,{date:'2026-09-03',line:'A',task:'TEST delivery discovery',actingAs:'kim',data:{example:true}})).body
  const discoveryPath=`/worklogs/${startingWork.id}/discovery`
  assert.equal((await call(discoveryPath,null,{actingAs:'kim',answer:'Sales confirms the order.'})).status,401)
  for(const answer of ['',{},'x'.repeat(4001)])assert.equal((await call(discoveryPath,owner,{actingAs:'kim',answer})).status,400)
  assert.equal((await call(discoveryPath,owner,{actingAs:'lee',answer:'Sales confirms the order.'})).status,403)
  const discovered=await call(discoveryPath,owner,{actingAs:'kim',answer:' Sales confirms the quantity and delivery date. '})
  assert.equal(discovered.status,200);assert.equal(discovered.body.data.example,true)
  assert.equal(discovered.body.data.discovery.before.answer,'Sales confirms the quantity and delivery date.')
  assert.equal(discovered.body.data.discovery.before.answeredBy,'kim')
  assert.equal((await call('/state',reviewer)).body.worklogs.find(w=>w.id===startingWork.id).data.discovery.before.answer,discovered.body.data.discovery.before.answer)
  await call(`/worklogs/${startingWork.id}/submit`,owner,{actingAs:'kim',approver:'lee'})
  assert.equal((await call(discoveryPath,owner,{actingAs:'kim',answer:'Changed while under review'})).status,409)
  for(const id of ['bad','999999999999999999999','0'])assert.equal((await call(`/worklogs/${id}/verification`,owner,{measurements:{ok:true}})).status,400)
  assert.equal((await call('/runs?processId=not-an-id',owner)).status,400)
  for(const query of ['before=bad','before=0','limit=0','limit=51','limit=NaN'])
    assert.equal((await call(`/runs?${query}`,owner)).status,400)
  const page=(await call(`/runs?processId=${formProcess.body.id}&limit=1`,owner)).body
  assert.equal(page.length,1);assert.equal(page[0].id,formRun.id)
  assert.deepEqual((await call(`/runs?processId=${formProcess.body.id}&before=${formRun.id}&limit=1`,owner)).body,[])
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
  assert.equal((await call(`/worklogs/${subject.id}/discovery`,owner,{actingAs:'kim',answer:'Must not change run evidence'})).status,409)
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

  // Requesting a review completes an administrative action; it is not its own
  // unfinished prerequisite. The review must snapshot the run, not its old log.
  const explicitMap={title:'TEST explicit request and fresh measurements',fields:[
    {key:'rowCountDelta',type:'number',required:true},
    {key:'verificationQueriesPassed',type:'boolean',required:true}],steps:[
    {id:'log',type:'task',label:'Initial baseline',action:'log_work_item'},
    {id:'measure',type:'task',label:'Measure actual result',fields:['rowCountDelta','verificationQueriesPassed']},
    {id:'request',type:'task',label:'Request this review',action:'request_review'},
    {id:'approve',type:'approval',label:'Human sign-off',action:'approve_review'}]}
  const explicitProcess=(await call('/processes',owner,{title:explicitMap.title,map:explicitMap,actingAs:'kim'})).body
  const explicitRun=(await call('/runs',owner,{processId:explicitProcess.id,title:explicitMap.title})).body
  const baseline=(await call('/worklogs',owner,{date:'2026-09-03',line:'A',task:'TEST original 0/true baseline',actingAs:'kim',
    data:{runId:explicitRun.id,rowCountDelta:0,verificationQueriesPassed:true}})).body
  let explicitSteps=explicitMap.steps.map((s,i)=>({...s,status:i===0?'done':i===1?'ready':'pending',
    ...(i===0?{resultId:baseline.id,completedBy:'kim',completedAt:1}:{})}))
  await call(`/runs/${explicitRun.id}`,owner,{steps:explicitSteps})
  const premature=await call(`/worklogs/${baseline.id}/submit`,owner,{actingAs:'kim',approver:'lee'})
  assert.equal(premature.status,409)
  assert.match(premature.body.detail,/Measure actual result/)
  explicitSteps=explicitSteps.map(s=>s.id==='measure'?{...s,status:'done',completedAt:2,resultData:{rowCountDelta:12,verificationQueriesPassed:false}}:
    s.id==='request'?{...s,status:'ready'}:s)
  await call(`/runs/${explicitRun.id}`,owner,{steps:explicitSteps})
  const measuredReview=await call(`/worklogs/${baseline.id}/submit`,owner,{actingAs:'kim',approver:'lee'})
  assert.equal(measuredReview.status,200,JSON.stringify(measuredReview.body))
  assert.equal(measuredReview.body.evidence.rowCountDelta,12)
  assert.equal(measuredReview.body.evidence.verificationQueriesPassed,false)
  let explicitState=(await call('/state',reviewer)).body
  assert.equal(explicitState.worklogs.find(w=>w.id===baseline.id).data.rowCountDelta,0,'preserve the original observation')
  assert.equal(explicitState.approvals.find(a=>a.id===measuredReview.body.id).evidence.rowCountDelta,12)
  // A later measurement cancels the pending review, but must not rewrite its evidence.
  explicitSteps=explicitSteps.map(s=>s.id==='measure'?{...s,completedAt:3,resultData:{rowCountDelta:0,verificationQueriesPassed:true}}:s)
  await call(`/runs/${explicitRun.id}`,owner,{steps:explicitSteps})
  const correctedReview=await call(`/worklogs/${baseline.id}/submit`,owner,{actingAs:'kim',approver:'lee'})
  assert.equal(correctedReview.status,200,JSON.stringify(correctedReview.body))
  explicitState=(await call('/state',reviewer)).body
  const previous=explicitState.approvals.find(a=>a.id===measuredReview.body.id)
  assert.equal(previous.status,'CANCELLED')
  assert.equal(previous.evidence.rowCountDelta,12)
  assert.equal(previous.evidence.verificationQueriesPassed,false)
  assert.equal(correctedReview.body.evidence.rowCountDelta,0)
  assert.equal(correctedReview.body.evidence.verificationQueriesPassed,true)
  explicitSteps=explicitSteps.map(s=>s.id==='request'?{...s,status:'done',resultId:correctedReview.body.id,completedAt:4}:
    s.id==='approve'?{...s,status:'ready'}:s)
  await call(`/runs/${explicitRun.id}`,owner,{steps:explicitSteps})
  assert.equal((await call(`/approvals/${measuredReview.body.id}/decide`,reviewer,{actingAs:'lee',decision:'APPROVED'})).status,400)
  assert.equal((await call(`/approvals/${correctedReview.body.id}/decide`,reviewer,{actingAs:'lee',decision:'APPROVED'})).status,200)

 } finally {
  server.kill()
  await new Promise(r=>server.exitCode!==null?r():server.once('exit',r))
 }
})
