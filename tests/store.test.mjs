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
