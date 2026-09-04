import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import vm from 'node:vm'

const bundle = await build({stdin: {contents: "export * from './src/store'", resolveDir: process.cwd()}, bundle: true, format: 'cjs', platform: 'node', write: false})
function fixture(fetch, extra = {}) {
  const module = {exports: {}}
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, fetch, AbortSignal, setTimeout, clearTimeout,
    localStorage: {getItem: () => 'test-token'},
    CustomEvent: class {},
    window: {dispatchEvent() {}, Understudy: {getLoadedProcess: () => ({}), log() {}}},
    ...extra,
  })
  return module.exports
}
const response = (data, status = 200) => ({ok: status < 400, status, json: async () => data})

test('explicit review persists new measurements and reconciles its receipt before completing the request',async()=>{
 const events=[]
 const worklogs=[{id:'w',task:'baseline',data:{runId:'r'},status:'draft'}]
 const store=fixture(async(path)=>{
  if(path.endsWith('/submit')){events.push('request');return response({id:'review',worklogId:'w',evidence:{delta:12,passed:false}})}
  events.push('refresh');return response({me:{username:'kim'},users:[],worklogs,approvals:[{id:'review',status:'PENDING'}],processes:[]})
 },{window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>({}),currentRunId:()=> 'r',
  flushRun:async()=>events.push('flush'),notifyAction:()=>events.push('complete-request'),log(){}}}})
 await store.refresh();events.length=0
 const review=await store.requestApproval('w','lee')
 assert.deepEqual(events,['flush','request','flush','refresh','complete-request','flush','refresh'])
 assert.equal(review.evidence.delta,12)
 assert.equal(review.evidence.passed,false)
})

test('reopened evidence clears a stale waiting-for-review message',async()=>{
 let done=true
 const proc={title:'review',steps:[{id:'measure',type:'task'},{id:'approve',type:'approval'}]}
 const store=fixture(async()=>response({me:{username:'kim'},users:[],
  worklogs:[{id:'w',data:{runId:'r'},status:'submitted'}],approvals:[],processes:[]}),
  {window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>proc,currentRunId:()=> 'r',log(){},
   getProgress:()=>[{id:'measure',type:'task',done,status:done?'done':'skipped'},{id:'approve',type:'approval',status:done?'ready':'blocked'}]}}})
 await store.refresh();await store.autoSyncApproval()
 assert.equal(store.getState().reviewSync.status,'ready')
 done=false;await store.autoSyncApproval()
 assert.equal(store.getState().reviewSync,null)
})

test('starting fresh changes only this tab and never deletes shared records',async()=>{
 const actions=[],entries=new Map()
 const store=fixture(async(path)=>{throw Error(`Unexpected network write: ${path}`)}, {
  localStorage:{getItem:()=>null,removeItem:k=>entries.delete(k)},
  sessionStorage:{setItem:(k,v)=>entries.set(k,v)},
  window:{dispatchEvent(){},Understudy:{flushRun:async()=>actions.push('flush'),unloadProcess:()=>actions.push('unload'),log(){}}}})
 store.setCaptureDraft('Unfinished work')
 await store.startFreshWorkspace()
 assert.deepEqual(actions,['flush','unload'])
 assert.equal(store.getState().captureDraft.task,'')
 assert.equal(store.getState().captureContext,null)
})

test('refresh reconciles the run before exposing a cancelled review to automation',async()=>{
 let releaseRead, reconciled=false
 const seen=[]
 const store=fixture(async(path)=>response(path==='/api/state'?{me:{username:'judge'},users:[],worklogs:[{id:'w',status:'draft',data:{}}],approvals:[],processes:[]}:[]),{
  window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>({}),refreshRunState:()=>new Promise(resolve=>{releaseRead=()=>{reconciled=true;resolve()}})}}})
 store.subscribe(()=>seen.push(reconciled))
 const refreshing=store.refresh()
 await new Promise(resolve=>setTimeout(resolve,0))
 assert.equal(seen.length,0)
 releaseRead();await refreshing
 assert.ok(seen.length>0 && seen.every(Boolean))
})

test('a review request stops when work is reopened during its pending flush',async()=>{
 let atApproval=true, releaseFlush, writes=0
 const proc={title:'shared',steps:[{id:'work',type:'task'},{id:'approve',type:'approval'}]}
 const store=fixture(async(path,opts)=>{
  if(opts?.method==='POST')writes++
  return response(path==='/api/state'?{me:{username:'judge'},users:[{username:'kim',role:'Contributor'}],worklogs:[],approvals:[],processes:[]}:[])
 },{window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>proc,currentRunId:()=> 'r',
  getProgress:()=>[{id:'work',type:'task',status:atApproval?'done':'ready',done:atApproval},{id:'approve',type:'approval',status:atApproval?'ready':'pending'}],
  flushRun:()=>new Promise(resolve=>releaseFlush=resolve),log(){}}}})
 await store.refresh()
 const requesting=store.autoSyncApproval()
 atApproval=false;releaseFlush();await requesting
 assert.equal(writes,0)
 assert.equal(store.getState().reviewSync,null)
})

test('reuse keeps Korean keywords and uses the chosen source instead of the newest unrelated work', async () => {
  const worklogs = [
    {id: 'new', task: 'Unrelated invoice approval', kind: 'review', data: {}},
    {id: 'source', task: '신규 금형 시사출 결과 확인 후 양산 투입 요청', kind: 'operations', data: {}},
  ]
  let saved
  const processes = []
  const store = fixture(async (path, opts) => {
    if (path === '/api/state') return response({me: {username: 'kim'}, users: [], worklogs, approvals: [], processes})
    if (path === '/api/processes' && opts.method === 'POST') {
      saved = JSON.parse(opts.body)
      const id = `p${processes.length + 1}`
      processes.unshift({id, title: saved.title, version: saved.map.version, appliesWhen: saved.map.appliesWhen})
      return response({id, title: saved.title})
    }
    throw Error(`Unexpected request: ${path}`)
  })
  await store.refresh()
  const first = await store.saveProcess({title: '금형 양산 승인', sourceWorklogId: 'source', steps: []})
  assert.equal(first.version, 1)
  assert.equal(saved.map.sourceWorklogId, 'source')
  assert.equal(saved.map.appliesWhen.kind, 'operations')
  assert.ok(saved.map.appliesWhen.keywords.includes('시사출'))
  assert.ok(!saved.map.appliesWhen.keywords.includes('invoice'))
  store.setDraftContext({task: worklogs[1].task, hasInput: true})
  assert.equal(store.computeMatches()[0].processId, 'p1')
  assert.equal(store.computeMatches()[0].tier, 'candidate')
  store.setDraftContext({task: worklogs[1].task, kind: 'review', hasInput: true})
  assert.equal(store.computeMatches().length, 0)
  const revision = await store.saveProcess({title: '금형 양산 승인', sourceWorklogId: 'source', steps: []})
  assert.equal(revision.version, 2)
  assert.equal(saved.map.version, 2)
})

test('a rejected delete is reported as a failure without refreshing as if it succeeded', async () => {
  let requests = 0
  const store = fixture(async () => { requests++; return response({error: 'forbidden', detail: 'Only the owner may delete this playbook.'}, 403) })
  await assert.rejects(store.deleteProcess('p1'), /Only the owner/)
  assert.equal(requests, 1)
})

test('starting-page work matches its saved playbook before submission', async () => {
  const processes = [{id: 'delivery-v2', title: 'Customer order handoff', version: 2,
    appliesWhen: {kind: 'routine work', keywords: ['customer', 'order', 'handoff', 'pickup', 'courier']}}]
  const store = fixture(async () => response({me: {username: 'kim'}, users: [], worklogs: [], approvals: [], processes}))
  await store.refresh()
  store.setCaptureDraft('I have another customer order to prepare for pickup.')
  assert.equal(store.computeMatches()[0]?.processId, 'delivery-v2')
  assert.equal(store.computeMatches()[0]?.tier, 'strong')
  store.setCaptureDraft('')
  assert.equal(store.computeMatches().length, 0)
  store.setCaptureDraft('I have another customer order to prepare for pickup.', true)
  assert.equal(store.computeMatches().length, 0, 'the operations example must not match a routine-work-only playbook')
})


test('work input restores after reload and an empty unrelated form does not replace its saved draft', async () => {
  const entries = new Map()
  const sessionStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)}
  const fetch=async(path)=>response(path==='/api/state'?{me:{username:'kim'},users:[],worklogs:[],approvals:[],processes:[]}:[])
  const first=fixture(fetch,{sessionStorage});await first.refresh()
  first.setCaptureDraft('금형 시사출을 준비합니다',false)
  const restored=fixture(fetch,{sessionStorage});await restored.refresh()
  assert.equal(restored.getState().captureDraft.task,'금형 시사출을 준비합니다')
  assert.equal(restored.getState().draft.task,'금형 시사출을 준비합니다')
})

test('version comparison includes knowledge and same-count edge changes', async () => {
  const old={title:'procedure',map:{version:1,steps:[{id:'a',label:'Check',type:'task',detail:'Check setup',next:[{to:'b'}]},{id:'b',label:'B',type:'task'},{id:'c',label:'C',type:'task'}]}}
  const store=fixture(async(path)=>response(path==='/api/processes'?[{id:'1',title:'procedure',version:1}]:old))
  const diff=await store.diffWithPrevious({title:'procedure',map:{...old.map,version:2,steps:[{...old.map.steps[0],detail:'Check alignment before setup',next:[{to:'c'}]},...old.map.steps.slice(1)]}})
  assert.ok(diff.changed[0].changes.some(c=>c.includes('Check alignment before setup')))
  assert.ok(diff.changed[0].changes.some(c=>c.includes('b → c')))
})

test('starter answer survives a failed save and reload, then reaches the saved work without completing any task', async () => {
  const entries=new Map(), events=[]
  const sessionStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)}
  let fail=true, work={id:'1',task:'Prepare a delivery',data:{example:true}}
  const fetch=async(path,opts)=>{
    if(path==='/api/state')return response({me:{username:'kim'},users:[],worklogs:[structuredClone(work)],approvals:[],processes:[]})
    if(path==='/api/runs')return response([])
    if(path==='/api/worklogs/1/discovery'){
      if(fail)return response({error:'Save unavailable'},503)
      const payload=JSON.parse(opts.body)
      work={...work,data:{...work.data,discovery:{...(work.data.discovery??{}),[payload.slot]:{answer:payload.answer,answeredBy:payload.actingAs,answeredAt:1}}}}
      return response(structuredClone(work))
    }
    throw Error(path)
  }
  const extra={sessionStorage,window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>null,log:(...args)=>events.push(args),notifyAction(){throw Error('Discovery must not complete a task')}}}}
  const first=fixture(fetch,extra);await first.refresh()
  first.requestPlaybookCreation(work);first.setStarterDraft('Sales confirms the order date')
  await assert.rejects(first.saveStarterAnswer('1',first.getState().captureContext.answerDraft),/Save unavailable/)
  const retry=fixture(fetch,extra);await retry.refresh()
  assert.equal(retry.getState().captureContext.answerDraft,'Sales confirms the order date')
  assert.equal(retry.getState().worklogs[0].data.discovery,undefined)
  fail=false;await retry.saveStarterAnswer('1',retry.getState().captureContext.answerDraft)
  const reloaded=fixture(fetch,extra);await reloaded.refresh()
  assert.equal(reloaded.getState().worklogs[0].data.discovery.before.answer,'Sales confirms the order date')
  assert.equal(reloaded.getState().captureContext.answerDraft,'')
  assert.equal(reloaded.getState().captureContext.creationRequested,true)
  assert.equal(events.at(-1)[1].discovery.before.answer,'Sales confirms the order date')
  reloaded.setStarterDraft('Logistics books the courier, then Lee reviews')
  await reloaded.saveStarterAnswer('1',reloaded.getState().captureContext.answerDraft,'after')
  assert.equal(reloaded.getState().worklogs[0].data.discovery.before.answer,'Sales confirms the order date')
  assert.equal(reloaded.getState().worklogs[0].data.discovery.after.answer,'Logistics books the courier, then Lee reviews')
})

test('permanent review failure is visible, explicit retry succeeds, and the banner clears after sign-off', async () => {
  const proc={title:'test',steps:[{id:'a',type:'approval',label:'Review',role:'Reviewer'}]}
  let submitted=0, fail=true, atApproval=true
  const worklogs=[{id:'w',createdBy:'kim',status:'draft',data:{runId:'r',approvalStepId:'a'}}]
  const store=fixture(async(path)=>{
    if(path==='/api/state')return response({me:{username:'judge'},users:[{username:'kim',role:'Contributor'},{username:'lee',role:'Reviewer'}],worklogs,approvals:[],processes:[]})
    if(path==='/api/runs')return response([])
    if(path==='/api/worklogs/w/submit'){
      submitted++
      if(fail)return response({detail:'Required predecessor is still open'},409)
      worklogs[0].status='submitted';return response({id:'review',stepId:'a'})
    }
    throw Error(path)
  },{window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>proc,currentRunId:()=> 'r',getProgress:()=>atApproval?[{id:'a',type:'approval',status:'ready',label:'Review'}]:[],flushRun:async()=>{},log(){},notifyAction(){}}}})
  await store.refresh();await store.autoSyncApproval()
  assert.equal(store.getState().reviewSync.status,'error')
  assert.match(store.getState().reviewSync.message,/predecessor/)
  await store.autoSyncApproval();assert.equal(submitted,1)
  fail=false;await store.retryReview()
  assert.equal(submitted,2);assert.equal(store.getState().reviewSync.status,'ready')
  atApproval=false;await store.autoSyncApproval();assert.equal(store.getState().reviewSync,null)
})

test('selecting a run fetches current evidence rather than restoring the stale picker row',async()=>{
 let restored
 const map={title:'procedure',steps:[]}
 const fresh={id:'r',processId:'p',status:'completed',steps:[{id:'a',status:'done',resultData:{delta:12}}]}
 const store=fixture(async(path)=>{
  if(path==='/api/processes/p')return response({id:'p',title:map.title,map})
  if(path==='/api/runs/r')return response(fresh)
  throw Error(path)
 },{window:{dispatchEvent(){},Understudy:{flushRun:async()=>{},loadProcess:(_map,meta)=>restored=meta.resume,log(){}}}})
 await store.followPlaybook('p',{run:{...fresh,steps:[{id:'a',status:'pending'}]}})
 assert.equal(restored.steps[0].status,'done')
 assert.equal(restored.steps[0].resultData.delta,12)
 fresh.status='abandoned'
 await assert.rejects(store.followPlaybook('p',{run:fresh}),/no longer available/)
})

test('review journal identifies another target run and its actual server status',async()=>{
 const logs=[],completed=[]
 const review={id:'a',worklogId:'w',stepId:'approve',evidence:{runId:'other'}}
 const store=fixture(async(path)=>{
  if(path.endsWith('/decide'))return response(review)
  if(path==='/api/runs/other')return response({id:'other',status:'completed'})
  return response({me:{username:'lee'},users:[],worklogs:[],approvals:[],processes:[]})
 },{window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>({}),currentRunId:()=> 'current',log:(message,detail)=>logs.push({message,detail}),notifyAction:name=>completed.push(name)}}})
 await store.decideApproval('a','APPROVED')
 assert.equal(completed.length,0)
 assert.match(logs.at(-1).message,/run #other — run is completed/)
 assert.equal(logs.at(-1).detail.runId,'other')
})

test('version comparison describes input and branch-rule changes without raw JSON',async()=>{
 const old={title:'process',map:{version:1,fields:[{key:'weight',label:'Weight',type:'number',unit:'g'},{key:'method',label:'Delivery method',type:'select',options:['Courier']}],steps:[{id:'a',label:'Measure',type:'task',next:[{to:'b',criteria:{weight:{gt:0}}}]},{id:'b',label:'Review',type:'approval'}]}}
 const store=fixture(async(path)=>response(path==='/api/processes'?[{id:'1',title:'process',version:1}]:old))
 const revised={...old.map,version:2,fields:[{...old.map.fields[0],unit:'kg',required:true},{...old.map.fields[1],options:['Courier','Pickup'],required:true}],steps:[{...old.map.steps[0],next:[{to:'b',criteria:{weight:{gte:1}}}]},old.map.steps[1]]}
 const diff=await store.diffWithPrevious({title:'process',map:revised})
 const text=diff.changed.flatMap(c=>[c.label,...c.changes]).join('\n')
 assert.match(text,/unit: g · optional → number · unit: kg · required/)
 assert.match(text,/Courier \/ Pickup/)
 assert.match(text,/Weight > 0 g → Weight ≥ 1 kg/)
 assert.ok(!text.includes('{'))
})

test('reload restores the exact run selected in this tab, even when a newer run exists',async()=>{
 const entries=new Map(),localStorage={getItem:k=>k==='linepulse-token'?'test-token':k==='understudy.lastPlaybook'?'p':null,setItem(){}}
 const sessionStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)}
 const old={id:'old',processId:'p',status:'active',steps:[{id:'w',status:'done',resultData:{delta:12}}]}, latest={id:'new',processId:'p',status:'active',steps:[{id:'w',status:'pending'}]}
 const fetch=async(path)=>{
  if(path==='/api/state')return response({me:{username:'judge'},users:[],worklogs:[],approvals:[],processes:[]})
  if(path==='/api/runs')return response([latest,old])
  if(path==='/api/runs/old')return response(old)
  if(path==='/api/processes/p')return response({id:'p',title:'shared playbook',map:{sourceProcessId:'p',steps:[{id:'w'}]}})
  throw Error(path)
 }
 const first=fixture(fetch,{localStorage,sessionStorage,window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>({sourceProcessId:'p'}),currentRunId:()=> 'old',log(){}}}})
 await first.refresh();first.rememberActiveRun()
 let restored
 const second=fixture(fetch,{localStorage,sessionStorage,window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>null,loadProcess:(_m,meta)=>restored=meta.resume,log(){}}}})
 await second.refresh();await new Promise(r=>setTimeout(r,10))
 assert.equal(restored.runId,'old')
 assert.equal(restored.steps[0].resultData.delta,12)
})

test('reload leaves a completed run in history instead of restoring its graph onto Start here',async()=>{
 const completed={id:'done',processId:'p',status:'completed',steps:[{id:'w',status:'done'}]}
 let loaded=0
 const store=fixture(async(path)=>{
  if(path==='/api/state')return response({me:{username:'kim'},users:[],worklogs:[],approvals:[],processes:[]})
  if(path==='/api/runs')return response([completed])
  if(path==='/api/runs/done')return response(completed)
  throw Error(path)
 },{
  sessionStorage:{getItem:k=>k==='understudy.selectedRun'?JSON.stringify({username:'kim',runId:'done',processId:'p'}):null},
  window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>null,loadProcess:()=>loaded++,log(){}}},
 })
 await store.refresh();await new Promise(r=>setTimeout(r,10))
 assert.equal(loaded,0)
 assert.equal(store.getState().restoration,'ready')
 assert.equal(store.getState().recentRuns[0].id,'done')
})

test('restoration exposes loading and recoverable errors without creating a replacement execution',async()=>{
 let release, fail=true, loaded=0, requests=[]
 const run={id:'selected',processId:'p',status:'active',steps:[{id:'w',status:'done',resultData:{delta:12}}]}
 const store=fixture(async(path,opts)=>{
  requests.push({path,method:opts?.method})
  if(path==='/api/state')return response({me:{username:'kim'},users:[],worklogs:[],approvals:[],processes:[]})
  if(path==='/api/runs'){await new Promise(r=>release=r);if(fail)throw Error('offline');return response([run])}
  if(path==='/api/runs/selected')return response(run)
  if(path==='/api/processes/p')return response({id:'p',title:'Saved work',map:{steps:[]}})
  throw Error(path)
 },{sessionStorage:{getItem:k=>k==='understudy.selectedRun'?JSON.stringify({username:'kim',runId:'selected'}):null},
  window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>null,loadProcess:()=>loaded++,log(){}}}})
 await store.refresh()
 assert.equal(store.getState().restoration,'loading');assert.equal(loaded,0)
 release();await new Promise(r=>setTimeout(r,0))
 assert.equal(store.getState().restoration,'error')
 fail=false;store.retryRestoration();release();await new Promise(r=>setTimeout(r,10))
 assert.equal(store.getState().restoration,'ready');assert.equal(loaded,1)
 assert.ok(requests.every(r=>r.method!=='POST'))
})

test('reconnecting to a committed review attaches its receipt without submitting a second review',async()=>{
 const notices=[],proc={steps:[{id:'r',type:'task',action:'request_review',done:true},{id:'a',type:'approval'}]}
 const store=fixture(async(path,opts)=>{
  assert.notEqual(opts?.method,'POST')
  return response(path==='/api/state'?{me:{username:'kim'},users:[],processes:[],
   worklogs:[{id:'w',status:'submitted',data:{runId:'run',approvalStepId:'a'}}],
   approvals:[{id:'new-review',worklogId:'w',stepId:'a',status:'PENDING'}]}:[])
 },{window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>proc,currentRunId:()=> 'run',
  getProgress:()=>[{id:'r',type:'task',status:'done',done:true},{id:'a',type:'approval',status:'ready'}],
  notifyAction:(...args)=>notices.push(args),log(){}}}})
 await store.refresh();await store.autoSyncApproval()
 assert.deepEqual(notices,[['request_review','new-review']])
})

test('a delayed receipt from a rejected request cannot replace the newer pending review',async()=>{
 let finish, phase='first'
 const ids=[]
 const store=fixture(async(path)=>{
  if(path.endsWith('/submit'))return new Promise(r=>finish=()=>r(response({id:'old',worklogId:'w'})))
  return response(path==='/api/state'?{me:{username:'kim'},users:[],processes:[],
   worklogs:[{id:'w',data:{runId:'r'}}],approvals:phase==='first'?[]:[{id:'old',status:'REJECTED'},{id:'new',status:'PENDING'}]}:[])
 },{window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>({}),currentRunId:()=> 'r',
  flushRun:async()=>{},notifyAction:(_name,id)=>ids.push(id),log(){}}}})
 await store.refresh()
 const pending=store.requestApproval('w','lee')
 await new Promise(r=>setTimeout(r,0));phase='new';finish();await pending
 assert.equal(ids.length,0)
})
