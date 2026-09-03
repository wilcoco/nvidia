import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import vm from 'node:vm'
const bundle = await build({stdin:{contents:`export * as map from './sdk/mapstore'; export * as host from './sdk/host'; export * as sync from './sdk/runsync'; export * as runner from './sdk/runner'; export * as asks from './sdk/asks'; export * as onboarding from './sdk/onboarding';`,resolveDir:process.cwd()},bundle:true,format:'cjs',platform:'node',write:false})
function fixture(globals = {}) {
 const module={exports:{}}
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,document:{title:'test'},location:{pathname:'/'},setTimeout,clearTimeout,structuredClone,...globals})
 const api=module.exports
 api.host.setStateProvider(()=>({actingAs:'kim',users:[{username:'kim',role:'Contributor'}]}))
 return api
}
const step=(id,extra={})=>({id,label:id,type:'task',...extra})
const tick=()=>new Promise(r=>setTimeout(r,10))
test('reopened evidence invalidates the previous pass decision',()=>{
 const {map}=fixture()
 map.loadSavedMap({title:'evidence',steps:[step('measure'),step('d',{type:'decision',next:[{to:'measure',condition:'failed'},{to:'approve',condition:'passed',criteria:{ok:{eq:true}}}]}),step('approve',{type:'approval'})]})
 map.humanToggleStepDone('measure',{ok:true})
 assert.equal(map.resolveDecision('d','approve','passed',undefined,'agent',{ok:true}).ok,true)
 map.humanToggleStepDone('measure')
 assert.equal(map.getMap().decisions[0].invalidated,true)
 map.humanToggleStepDone('measure',{ok:false})
 assert.equal(map.pendingDecision().id,'d')
 assert.equal(map.resolveDecision('d','approve','pass',undefined,'agent',{ok:true}).ok,false)
})
test('task loop demands fresh work on each of three retries',()=>{
 const {map,sync}=fixture()
 map.loadSavedMap({title:'retry',steps:[step('work'),step('d',{type:'decision',next:[{to:'dry',condition:'failed'},{to:'approve',condition:'pass'}]}),step('dry',{next:[{to:'work'}]}),step('approve',{type:'approval'})]})
 for(let i=0;i<3;i++){
  map.humanToggleStepDone('work',{attempt:i})
  assert.equal(map.resolveDecision('d','dry','failed').ok,true)
  assert.equal(map.getMap().steps.find(s=>s.id==='dry').done,false)
  map.humanToggleStepDone('dry',{attempt:i})
  assert.equal(map.progress().get('work'),'ready')
  assert.equal(sync.isRunComplete(),false)
  assert.equal(map.resolveDecision('d','approve','premature').ok,false)
 }
})
test('a new design cannot write into the previous run',async()=>{
 const {map,host,sync}=fixture(); const writes=[]
 host.setProcessStore({startRun:async()=>({id:'old'}),updateRun:async(id,payload)=>writes.push({id,payload})})
 map.loadSavedMap({title:'old',steps:[step('old-step')]});sync.startRunTracking('1');await tick()
 map.proposeMap({title:'new',steps:[step('new-step')]});map.humanConfirmMap();map.humanToggleStepDone('new-step');await tick()
 assert.equal(sync.currentRunId(),null)
 assert.ok(writes.every(w=>w.payload.steps.every(s=>s.id==='old-step')))
 sync.stopRunTracking()
})
test('stop and resume invalidate pending start responses',async()=>{
 const {map,host,sync}=fixture();let complete
 host.setProcessStore({startRun:()=>new Promise(r=>complete=r),updateRun:async()=>{}})
 map.loadSavedMap({title:'a',steps:[step('a')]});sync.startRunTracking('1');sync.stopRunTracking()
 complete({id:'late'});await tick();assert.equal(sync.currentRunId(),null)
 sync.startRunTracking('1');sync.resumeRunTracking('existing')
 complete({id:'another-late'});await tick();assert.equal(sync.currentRunId(),'existing')
 sync.stopRunTracking()
})
test('pending action cannot cross into another map with identical action',async()=>{
 const {map,host,runner,asks}=fixture();let calls=0
 host.registerAction({name:'work',handler:()=>{calls++;return {id:'1'}}})
 map.loadSavedMap({title:'A',steps:[step('a',{action:'work'})]})
 const pending=await runner.startHostAction('work',{})
 map.loadSavedMap({title:'B',steps:[step('b',{action:'work'})]})
 await asks.decideApprovalCard(pending.actionId,true)
 assert.equal(calls,0)
})
test('retro-linking cannot bypass required evidence',()=>{
 const {map}=fixture()
 map.recordActionSuccess('log','1')
 map.loadSavedMap({title:'evidence',fields:[{key:'amount',type:'number',required:true}],steps:[step('a',{action:'log',fields:['amount']})]})
 assert.equal(map.getMap().steps[0].done,false)
})
test('failed save reverts to draft',async()=>{
 const {map}=fixture();map.proposeMap({title:'draft',steps:[step('a')]})
 map.humanConfirmMap(async()=>{throw Error('offline')});await tick()
 assert.equal(map.getMap().confirmed,false)
})
test('inactive branch cannot be checked off',()=>{
 const {map}=fixture();map.loadSavedMap({title:'branch',steps:[step('d',{type:'decision',next:[{to:'a'},{to:'b'}]}),step('a'),step('b')]})
 map.resolveDecision('d','a','choose a');map.humanToggleStepDone('b');assert.equal(map.getMap().steps[2].done,false)
})

test('first-visit help is read-only and distinguishes teaching from execution', () => {
  const {host, map, onboarding} = fixture()
  host.setStateProvider(() => ({loggedInAs: null, actingAs: '', savedPlaybooks: []}))
  const visitor = onboarding.describeOnboarding()
  assert.equal(visitor.current_context.signed_in, false)
  assert.match(visitor.first_reply.next, /Enter demo workspace/)
  assert.match(visitor.first_reply.create, /recently did/)
  assert.match(visitor.first_reply.run, /Playbooks/)
  assert.equal(map.getMap(), null)
  host.setStateProvider(() => ({loggedInAs: {username: 'judge'}, playbookRequest: {worklogId: '7', task: 'Review a mold trial'}}))
  assert.match(onboarding.describeOnboarding().first_reply.next, /NEW playbook from work log #7/)
  assert.equal(map.getMap(), null)
  host.setStateProvider(() => ({loggedInAs: {username: 'judge'}, actingAs: 'kim', savedPlaybooks: [], users: [{username: 'kim', role: 'Contributor'}]}))
  map.proposeMap({title: 'My existing draft', steps: [step('a')]})
  const draft = map.getMap()
  const help = onboarding.describeOnboarding()
  assert.equal(help.current_context.mode, 'draft')
  assert.match(help.first_reply.next, /do not replace/)
  assert.equal(map.getMap(), draft)
})

test('task completion reports refusal without accepting missing evidence', () => {
  const {map} = fixture()
  map.loadSavedMap({title: 'input', fields: [{key: 'amount', type: 'number', required: true}], steps: [step('a', {fields: ['amount']})]})
  assert.equal(map.humanToggleStepDone('a', {}), false)
  assert.equal(map.getMap().steps[0].done, false)
  assert.equal(map.humanToggleStepDone('a', {amount: 0}), true)
})

test('confirmation waits for saving and duplicate saves are suppressed', async () => {
  const {map} = fixture()
  map.proposeMap({title: 'save', steps: [step('a')]})
  let saved, calls = 0
  const saver = () => { calls++; return new Promise(resolve => { saved = resolve }) }
  map.humanConfirmMap(saver)
  map.humanConfirmMap(saver)
  assert.equal(calls, 1)
  assert.equal(map.getMap().confirmed, false)
  assert.equal(map.getMap().saving, true)
  saved({id: '42', version: 2})
  await tick()
  assert.equal(map.getMap().confirmed, true)
  assert.equal(map.getMap().saving, false)
  assert.equal(map.getMap().sourceProcessId, '42')
})

test('run creation failure is visible and retry announces the ready run', async () => {
  const events = []
  const {map, host, sync} = fixture({
    CustomEvent: class { constructor(type) { this.type = type } },
    window: {dispatchEvent: event => events.push({type: event.type, runId: sync.currentRunId(), error: sync.getRunStartError()})},
  })
  host.setProcessStore({startRun: async () => { throw Error('offline') }, updateRun: async () => {}})
  map.loadSavedMap({title: 'retry start', steps: [step('a')]})
  sync.startRunTracking('1')
  await tick()
  assert.equal(sync.currentRunId(), null)
  assert.match(events.at(-1).error, /offline/)
  host.setProcessStore({startRun: async () => ({id: 'new-run'}), updateRun: async () => {}})
  sync.startRunTracking('1')
  await tick()
  assert.equal(events.at(-1).type, 'understudy:run-state')
  assert.equal(events.at(-1).runId, 'new-run')
  assert.equal(sync.getRunStartError(), null)
  sync.stopRunTracking()
})

test('a confirmed revision starts with fresh work instead of inheriting completed execution', () => {
  const {map, sync} = fixture()
  map.loadSavedMap({title: 'versioned', version: 1, steps: [step('a')]})
  map.humanToggleStepDone('a', {measured: 42})
  assert.equal(sync.isRunComplete(), true)
  map.reopenAsDraft()
  map.humanEditStep('a', 'detail', 'Record the newly discovered preparation step.')
  map.humanConfirmMap()
  assert.equal(map.progress().get('a'), 'ready')
  assert.equal(sync.isRunComplete(), false)
  assert.equal(map.getMap().steps[0].resultData, undefined)
  assert.equal(map.getMap().steps[0].detail, 'Record the newly discovered preparation step.')
})
