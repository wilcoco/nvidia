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
test('interview requires inputs per task and refuses to save an unassigned form', () => {
 const {map}=fixture()
 map.proposeMap({title:'input discovery',steps:[step('first'),step('next')]})
 assert.equal(map.mapGaps().filter(g=>g.kind==='required_context').length,2)
 map.setMapFields([{key:'method',type:'select',options:['Courier','Pickup'],required:true}])
 map.humanConfirmMap()
 assert.equal(map.getMap().confirmed,false)
 assert.match(map.getMap().saveError,/Assign/)
 map.agentUpdateStep('next',{fields:['method']})
 map.humanConfirmMap()
 assert.equal(map.getMap().confirmed,true)
})
test('dropdown submissions control both routes and cannot be replaced by agent claims', () => {
 for(const method of ['Courier','Pickup']){
  const {map}=fixture()
  const target=method==='Courier'?'ship':'pickup', other=method==='Courier'?'pickup':'ship'
  map.loadSavedMap({title:'delivery',fields:[{key:'quantity',type:'number',required:true},{key:'method',type:'select',options:['Courier','Pickup'],required:true}],steps:[
   step('input',{fields:['quantity','method'],next:[{to:'route'}]}),
   step('route',{type:'decision',next:[{to:'ship',criteria:{method:{eq:'Courier'}}},{to:'pickup',criteria:{method:{eq:'Pickup'}}}]}),
   step('ship',{next:[{to:'finish'}]}),step('pickup',{next:[{to:'finish'}]}),step('finish')]
  })
  assert.equal(map.humanToggleStepDone('input',{quantity:NaN,method}),false)
  assert.equal(map.humanToggleStepDone('input',{quantity:12.5,method:'Other'}),false)
  assert.equal(map.humanToggleStepDone('input',{quantity:12.5,method}),true)
  assert.equal(map.resolveDecision('route',other,'wrong route').ok,false)
  assert.equal(map.resolveDecision('route',other,'fabricated selection',undefined,'agent',{method:method==='Courier'?'Pickup':'Courier'}).ok,false)
  assert.equal(map.resolveDecision('route',target,'use submitted choice').ok,true)
  assert.equal(map.progress().get(target),'ready')
  assert.equal(map.progress().get(other),'not_applicable')
 }
})
test('remote sign-off advances the existing map without echo writes or stale-run evidence',async()=>{
 const {map,host,sync}=fixture();let writes=0
 const remote={id:'r',status:'active',steps:[{id:'work',status:'done',resultData:{qty:12}},{id:'review',status:'done',resultId:'approval',completedBy:'lee'},{id:'handoff',status:'pending'}],events:[{id:'signed',kind:'approval'}]}
 host.setProcessStore({readRun:async()=>structuredClone(remote),updateRun:async()=>{writes++}})
 map.loadSavedMap({title:'handoff',steps:[step('work'),step('review',{type:'approval'}),step('handoff')]})
 sync.resumeRunTracking('r');const original=map.getMap()
 assert.equal(await sync.refreshRunState(),true)
 assert.equal(map.getMap(),original)
 assert.equal(map.progress().get('handoff'),'ready')
 assert.equal(map.getMap().steps[1].completedBy,'lee')
 assert.equal(await sync.refreshRunState(),false)
 assert.equal(writes,0)
 map.loadSavedMap({title:'fresh',steps:[step('work'),step('review',{type:'approval'}),step('handoff')]})
 sync.resumeRunTracking('new')
 assert.equal(await sync.refreshRunState(),false)
 assert.equal(map.getMap().steps[1].done,false)
 sync.stopRunTracking()
})
test('a slow run refresh cannot overwrite a task completed after the read began',async()=>{
 const {map,host,sync}=fixture();let resolveRead
 host.setProcessStore({readRun:()=>new Promise(r=>resolveRead=r),updateRun:async()=>{}})
 map.loadSavedMap({title:'race',steps:[step('a'),step('b')]});sync.resumeRunTracking('r')
 const reading=sync.refreshRunState()
 map.humanToggleStepDone('a',{qty:7})
 resolveRead({id:'r',status:'active',steps:[{id:'a',status:'pending'},{id:'b',status:'pending'}]})
 assert.equal(await reading,false)
 assert.equal(map.getMap().steps[0].done,true)
 assert.equal(map.getMap().steps[0].resultData.qty,7)
 sync.stopRunTracking()
})
test('an unchanged reviewer tab cannot flush old success over reopened work',async()=>{
 const editor=fixture(), reviewer=fixture()
 const design={title:'shared run',steps:[step('work'),step('approve',{type:'approval'})]}
 let writes=0, remote={id:'r',status:'active',steps:[{id:'work',status:'done',completedBy:'kim',resultData:{passed:true}},{id:'approve',status:'ready'}]}
 const store={readRun:async()=>structuredClone(remote),updateRun:async(_id,patch)=>{writes++;remote={...remote,...structuredClone(patch)}}}
 for(const client of [editor,reviewer]){
  client.host.setProcessStore(store);client.map.loadSavedMap(design)
  client.sync.resumeRunTracking('r');await client.sync.refreshRunState()
 }
 assert.equal(editor.map.humanToggleStepDone('work'),true)
 await editor.sync.flushRun()
 assert.equal(remote.steps[0].status,'ready')
 assert.equal(reviewer.map.getMap().steps[0].done,true)
 await reviewer.sync.flushRun()
 assert.equal(writes,1)
 assert.equal(remote.steps[0].status,'ready')
 assert.equal(remote.steps[0].resultData,undefined)
 await reviewer.sync.refreshRunState()
 assert.equal(reviewer.map.getMap().steps[0].done,false)
 for(const client of [editor,reviewer])client.sync.stopRunTracking()
})
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
for(const mode of ['task','decision']) test(`${mode} retry: three failures each demand new work and preserve attempt history`,()=>{
 const {map,sync}=fixture()
 map.loadSavedMap({title:`three ${mode} retries`,fields:[
  {key:'passed',type:'boolean',required:true},{key:'restoreOK',type:'boolean',required:true},{key:'sampleCount',type:'number',required:true}],steps:[
  step('work',{fields:['passed'],next:[{to:'health'}]}),
  step('health',{type:'decision',next:[{to:'restore',criteria:{passed:{eq:false}}},{to:'approve',criteria:{passed:{eq:true}}}]}),
  step('restore',{fields:['restoreOK'],next:[{to:'dry',criteria:{restoreOK:{eq:true}}}]}),
  step('dry',{fields:['sampleCount'],next:[{to:mode==='task'?'work':'retry'}]}),
  ...(mode==='decision'?[step('retry',{type:'decision',next:[{to:'work',condition:'retry'},{to:'plan',condition:'replan'}]})]:[]),
  step('approve',{type:'approval',action:'approve_review'}),
  ...(mode==='decision'?[step('plan',{type:'approval',action:'approve_review'})]:[])]})
 for(let attempt=1;attempt<=3;attempt++){
  assert.equal(map.resolveDecision('health','approve','premature').ok,false)
  assert.equal(map.humanToggleStepDone('work',{passed:false}),true)
  assert.equal(map.resolveDecision('health','approve','fabricated',undefined,'agent',{passed:true}).ok,false)
  assert.equal(map.resolveDecision('health','restore','actual failure').ok,true)
  assert.equal(map.humanToggleStepDone('restore',{restoreOK:false}),false)
  assert.match(map.getCompletionError(),/restoreOK must equal true/)
  assert.equal(map.humanToggleStepDone('restore',{restoreOK:true}),true)
  assert.equal(map.getMap().steps.find(s=>s.id==='dry').done,false)
  assert.equal(map.humanToggleStepDone('dry',{}),false)
  assert.equal(map.humanToggleStepDone('dry',{sampleCount:10+attempt}),true)
  if(mode==='decision')assert.equal(map.resolveDecision('retry','work','retry').ok,true)
  for(const id of ['work','restore','dry']){
   const current=map.getMap().steps.find(s=>s.id===id)
   assert.equal(current.done,false)
   assert.equal(current.resultData,undefined)
   assert.equal(current.completedAt,undefined)
  }
  assert.equal(map.progress().get('work'),'ready')
  assert.equal(sync.isRunComplete(),false)
  assert.equal(map.getMap().events.filter(e=>e.stepId==='dry'&&e.kind==='completed').length,attempt)
 }
 assert.equal(map.humanToggleStepDone('work',{passed:true}),true)
 assert.equal(map.resolveDecision('health','approve','fresh success').ok,true)
 assert.equal(map.progress().get('approve'),'ready')
 assert.equal(sync.isRunComplete(),false)
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
  host.setStateProvider(() => ({loggedInAs:{username:'judge'},playbookRequest:{worklogId:'7',task:'Prepare a delivery',discovery:{before:{answer:'Sales confirms the order date',answeredBy:'kim',answeredAt:1}}}}))
  const answered = onboarding.describeOnboarding()
  assert.equal(answered.current_context.creation_request.discovery.before.answer,'Sales confirms the order date')
  assert.match(answered.first_reply.next,/do not repeat a question already answered/)
  assert.equal(map.getMap(),null)
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

test('an answered agent question advances onboarding only for its own work', () => {
  const {host, asks} = fixture()
  const context = {playbookRequest: {worklogId: 'first'}}
  host.setStateProvider(() => context)
  const id = asks.askUser('Who takes over after packing?')
  assert.equal(asks.getInterviewProgress().asked,1)
  assert.equal(asks.getInterviewProgress().answered,0)
  asks.answerAsk(id,'Logistics')
  assert.equal(asks.getInterviewProgress().answered,1)
  context.playbookRequest.worklogId='second'
  assert.equal(asks.getInterviewProgress().asked,0)
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


test('retry history and problem reports survive restore without becoming current evidence', async () => {
 const {map,host,sync}=fixture(); let persisted
 const design={title:'history',steps:[step('work'),step('check',{type:'decision',next:[{to:'repair'},{to:'approve'}]}),step('repair',{next:[{to:'work'}]}),step('approve',{type:'approval'})]}
 host.setProcessStore({startRun:async()=>({id:'history-run'}),updateRun:async(_id,p)=>{persisted=structuredClone(p)}})
 map.loadSavedMap(design);sync.startRunTracking('history');await tick()
 map.humanToggleStepDone('work',{defects:3})
 map.resolveDecision('check','repair','failed')
 map.reportProblem('repair','Alignment step missing')
 map.humanToggleStepDone('repair',{adjustment:'Aligned fixture'})
 await sync.flushRun()
 assert.equal(map.getMap().steps.find(s=>s.id==='work').resultData,undefined)
 assert.equal(map.getMap().steps.find(s=>s.id==='repair').resultData,undefined)
 assert.ok(persisted.events.some(e=>e.values?.adjustment==='Aligned fixture'))
 assert.ok(persisted.events.some(e=>e.kind==='problem' && e.note==='Alignment step missing'))
 sync.stopRunTracking();map.loadSavedMap(design);map.restoreRunState(persisted.steps,persisted.decisions,persisted.events)
 assert.ok(map.getMap().events.some(e=>e.values?.defects===3))
 assert.equal(map.progress().get('work'),'ready')
 map.reopenAsDraft();map.humanConfirmMap()
 assert.equal(map.getMap().events.length,0)
})


test('a middle approval freezes its evidence while allowing downstream work', () => {
 const {map}=fixture()
 map.loadSavedMap({title:'middle approval',steps:[step('work'),step('approve',{type:'approval',action:'approve_review'}),step('handoff')]})
 map.humanToggleStepDone('work',{ok:true})
 map.markActionDone('approve_review','review-1','user')
 assert.equal(map.humanToggleStepDone('work'),false)
 assert.equal(map.humanToggleStepDone('handoff',{recipient:'Park'}),true)
 assert.equal(map.getMap().events.filter(e=>e.id==='approval:review-1').length,1)
})
