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
 } finally {
  server.kill()
  await new Promise(r=>server.exitCode!==null?r():server.once('exit',r))
 }
})
