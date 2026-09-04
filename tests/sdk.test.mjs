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
test('adaptive expert interview preserves source evidence without turning prose into executable rules', () => {
 const {map,asks}=fixture()
 map.proposeMap({title:'expert judgment',steps:[
  step('observe',{detail:'Inspect the sample.',next:[{to:'route'}]}),
  step('route',{type:'decision',detail:'Choose recovery or approval.',next:[{to:'recover',condition:'needs recovery'},{to:'approve',condition:'acceptable'}]}),
  step('recover',{detail:'Correct and retry.'}),step('approve',{type:'approval'})]})
 const answerNext=(expectedKind,question,answer)=>{
  const gap=map.mapGaps().find(g=>g.stepId==='route'&&g.kind.startsWith('knowledge_'))
  assert.equal(gap.kind,expectedKind)
  assert.equal(gap.resolves_gap,`${expectedKind}:route`)
  const id=asks.askUser(question,undefined,true,gap.resolves_gap)
  asks.answerAsk(id,answer)
  return id
 }
 const incidentId=answerNext('knowledge_incident','Tell me about one recent routing decision.','A sample passed the normal reading but its surface rhythm looked wrong.')
 assert.equal(map.getMap().steps[1].elicitation.incident,'A sample passed the normal reading but its surface rhythm looked wrong.')
 assert.equal(map.getMap().steps[1].elicitation.answers[0].questionId,incidentId)
 answerNext('knowledge_cues','What signal changed your call?','I just know it by feel.')
 let gap=map.mapGaps().find(g=>g.stepId==='route'&&g.kind.startsWith('knowledge_'))
 assert.equal(gap.kind,'knowledge_cues','one concrete sensory follow-up remains')
 assert.match(gap.question_goal,/one final attempt/i)
 answerNext('knowledge_cues','Can that feeling be separated into one observable channel?','It cannot be put into words; it has to be learned by watching.')
 assert.equal(map.getMap().steps[1].elicitation.unspeakable.length,1)
 answerNext('knowledge_novice_mistake','What would a less experienced person do?','They would approve from the normal reading and miss the unstable surface rhythm.')
 answerNext('knowledge_boundary','When does that judgment stop applying?','If the reference sample has the same rhythm, stop and recalibrate before deciding.')
 answerNext('knowledge_failure_recovery','When did it fail, and what happened next?','We once rejected a sound batch; compare the reference, recalibrate, then repeat inspection.')
 assert.equal(map.mapGaps().some(g=>g.stepId==='route'&&g.kind.startsWith('knowledge_')),false)
 assert.equal(map.getMap().steps[1].next.every(edge=>edge.criteria===undefined),true,'raw prose never becomes an executable route')
 map.proposeMap({title:'expert judgment revised',steps:[
  step('observe',{detail:'Inspect the sample.',next:[{to:'route'}]}),
  step('route',{type:'decision',detail:'Choose recovery or approval.',next:[{to:'recover'},{to:'approve'}]}),
  step('recover',{detail:'Correct and retry.'}),step('approve',{type:'approval'})]})
 assert.equal(map.getMap().steps[1].elicitation.answers.length,6,'source evidence survives a re-propose of the same step')
 assert.equal(map.getMap().steps[1].elicitation.confirmed,false)
 map.humanConfirmMap()
 assert.equal(map.getMap().steps[1].elicitation.confirmed,true)
 assert.equal(map.getMap().steps[1].elicitation.confirmedBy,'kim')
})
test('only the explicit skip control declines an expert interview question', () => {
 const {map,asks}=fixture()
 map.proposeMap({title:'literal workflow language',steps:[
  step('route',{type:'decision',next:[{to:'recover'},{to:'approve'}]}),
  step('recover'),step('approve',{type:'approval'})]})
 const answerNext=(answer,options)=>{
  const gap=map.mapGaps().find(g=>g.stepId==='route'&&g.kind.startsWith('knowledge_'))
  const id=asks.askUser(`Question for ${gap.stage}`,undefined,true,gap.resolves_gap)
  asks.answerAsk(id,answer,options)
 }
 answerNext('A recent rollout failed after the total count hid a segment mismatch.')
 answerNext('The expert compares the segment counts and the verification-query result.')
 answerNext('A novice may skip verification queries and approve from the total row count alone.')
 answerNext('The usual rule is not applicable only when the archived segment has been formally excluded.')
 answerNext('If verification fails, defer rollout, correct the filter, and repeat the dry run.')
 const record=map.getMap().steps[0].elicitation
 assert.deepEqual(Array.from(record.answers,answer=>answer.disposition),['accepted','accepted','accepted','accepted','accepted'])
 assert.match(record.noviceMistake,/skip verification queries/)
 assert.match(record.boundaries[0],/not applicable only when/)
 assert.match(record.failureRecovery,/defer rollout/)

 const explicit=fixture()
 explicit.map.proposeMap({title:'explicit decline',steps:[
  step('route',{type:'decision',next:[{to:'recover'},{to:'approve'}]}),
  step('recover'),step('approve',{type:'approval'})]})
 const gap=explicit.map.mapGaps().find(g=>g.stepId==='route'&&g.kind.startsWith('knowledge_'))
 const id=explicit.asks.askUser('Tell me about a recent case.',undefined,true,gap.resolves_gap)
 explicit.asks.answerAsk(id,'Skip this question',{declinedByUser:true})
 const declined=explicit.map.getMap().steps[0].elicitation
 assert.equal(declined.answers[0].disposition,'declined')
 assert.equal(declined.incident,undefined)
})
test('legacy saved playbooks remain confirmed without per-answer migration', () => {
 const {map}=fixture()
 map.loadSavedMap({title:'legacy',version:4,steps:[step('work',{detail:'Existing reviewed instructions.'}),step('approve',{type:'approval'})]})
 assert.equal(map.getMap().confirmed,true)
 assert.equal(map.getMap().elicitationVersion,undefined)
 assert.equal(map.getMap().steps[0].elicitation,undefined)
 assert.equal(map.mapGaps().length,0,'a running legacy playbook never opens an interview')
 map.reopenAsDraft()
 assert.equal(map.mapGaps().some(g=>g.kind.startsWith('knowledge_')),false,'legacy absence means previously confirmed')
 map.humanConfirmMap()
 assert.equal(map.getMap().confirmed,true)
 assert.equal(map.getMap().steps[0].elicitation,undefined)
})
test('expert interview focuses on one judgment point until the human expands it', () => {
 const {map,asks}=fixture()
 map.proposeMap({title:'bounded interview',steps:[
  step('routeA',{type:'decision',next:[{to:'workA'},{to:'routeB'}]}),
  step('workA'),
  step('routeB',{type:'decision',next:[{to:'workB'},{to:'approve'}]}),
  step('workB'),step('approve',{type:'approval'})]})
 const answerActive=(answer='evidence')=>{
  const knowledge=map.mapGaps().filter(g=>g.kind.startsWith('knowledge_'))
  assert.equal(knowledge.length,1,'only one adaptive move is exposed')
  const gap=knowledge[0]
  const id=asks.askUser(`Question for ${gap.step}`,undefined,true,gap.resolves_gap)
  asks.answerAsk(id,answer)
  return gap
 }
 for(let i=0;i<5;i++) assert.equal(answerActive().stepId,'routeA')
 assert.equal(map.mapGaps().some(g=>g.kind.startsWith('knowledge_')),false,'second point does not start automatically')
 let state=map.elicitationInterviewState()
 assert.equal(state.canExploreAnother,true)
 assert.equal(state.next.stepId,'routeB')
 assert.equal(map.exploreAnotherJudgmentPoint(),true)
 assert.equal(map.mapGaps().find(g=>g.kind.startsWith('knowledge_')).stepId,'routeB')
 state=map.elicitationInterviewState()
 assert.equal(state.activePoints,2)
})
test('an evidence-only fallback preserves answers but cannot be saved as a runnable playbook', () => {
 const {map}=fixture()
 map.proposeMap({title:'evidence only',draftMode:'evidence-only',steps:[step('placeholder')]})
 map.humanConfirmMap()
 assert.equal(map.getMap().confirmed,false)
 assert.match(map.getMap().saveError,/source evidence, not a runnable playbook/i)
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
test('authoritative approval reconciliation clears a stale signed-off write warning without echoing again',async()=>{
 const {map,host,sync}=fixture();let writes=0
 let remote={id:'r',status:'active',steps:[{id:'work',status:'pending'},{id:'review',status:'blocked'}],decisions:[],events:[]}
 host.setProcessStore({
  readRun:async()=>structuredClone(remote),
  updateRun:async()=>{writes++;throw Error('Work already signed off cannot be changed in this run.')},
 })
 map.loadSavedMap({title:'server-owned approval',steps:[step('work'),step('review',{type:'approval'})]})
 sync.resumeRunTracking('r');await sync.refreshRunState()
 assert.equal(map.humanToggleStepDone('work',{qty:12}),true)
 await assert.rejects(sync.flushRun(),/signed off/)
 assert.match(sync.getRunSyncError(),/signed off/)
 remote={id:'r',status:'completed',steps:[{id:'work',status:'done',resultData:{qty:12},completedBy:'kim'},
  {id:'review',status:'done',resultId:'76',completedBy:'lee'}],decisions:[],events:[{id:'approval:76',kind:'approval'}]}
 assert.equal(await sync.refreshRunState(true),true)
 assert.equal(sync.getRunSyncError(),null)
 assert.equal(sync.isRunComplete(),true)
 assert.equal(map.getMap().steps[1].resultId,'76')
 await tick()
 assert.equal(writes,1,'restoring the accepted approval must not send another browser write')
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
test('inactive recovery decisions are historical, never the current chosen route',()=>{
 const {map}=fixture()
 map.loadSavedMap({title:'recover then pass',fields:[
  {key:'passed',type:'boolean',required:true},{key:'restored',type:'boolean',required:true},{key:'needsRedesign',type:'boolean',required:true}],steps:[
  step('s1',{next:[{to:'s2'}]}),step('s2',{next:[{to:'s3'}]}),
  step('s3',{fields:['passed'],next:[{to:'s4'}]}),
  step('s4',{type:'decision',next:[{to:'s6',criteria:{passed:{eq:false}}},{to:'s5',criteria:{passed:{eq:true}}}]}),
  step('s5',{type:'approval'}),
  step('s6',{fields:['restored'],next:[{to:'s7',criteria:{restored:{eq:true}}}]}),
  step('s7',{next:[{to:'s8'}]}),
  step('s8',{type:'decision',next:[{to:'s9',criteria:{needsRedesign:{eq:true}}},{to:'s3',criteria:{needsRedesign:{eq:false}}}]}),
  step('s9',{type:'approval',approvalPurpose:'plan'})]})
 map.humanToggleStepDone('s1');map.humanToggleStepDone('s2')
 map.humanToggleStepDone('s3',{passed:false})
 assert.equal(map.resolveDecision('s4','s6','failed').ok,true)
 map.humanToggleStepDone('s6',{restored:true});map.humanToggleStepDone('s7')
 assert.equal(map.resolveDecision('s8','s3','no redesign',undefined,'agent',{needsRedesign:false}).ok,true)
 assert.equal(map.progress().get('s3'),'ready')
 map.humanToggleStepDone('s3',{passed:true})
 assert.equal(map.resolveDecision('s4','s5','fresh pass').ok,true)
 const statuses=map.progress()
 assert.equal(statuses.get('s8'),'not_applicable')
 assert.equal(map.currentDecision('s8',statuses),null)
 assert.equal(map.currentDecision('s4',statuses).to,'s5')
 assert.ok(map.getMap().decisions.some(d=>d.stepId==='s8'&&d.to==='s3'),'superseded route remains in the audit history')
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
test('agent-requested deviations wait for a human approval card',async()=>{
 const {map,runner,asks}=fixture()
 map.loadSavedMap({title:'deviation',steps:[step('manual')]})
 const pending=await runner.startHostAction('resolve_deviation',{stepId:'manual',resolution:'not_applicable',reason:'not needed for this run'})
 assert.equal(pending.status,'pending_approval')
 assert.equal(map.getMap().steps[0].done,false)
 await asks.decideApprovalCard(pending.actionId,true)
 assert.equal(map.getMap().steps[0].naReason,'not needed for this run')
})
test('a signed-off run refuses deviation before creating a human approval card',async()=>{
 const {map,runner,asks}=fixture()
 map.loadSavedMap({title:'signed',steps:[step('work')]})
 assert.equal(map.humanToggleStepDone('work'),true)
 const result=await runner.startHostAction('resolve_deviation',{stepId:'work',resolution:'not_applicable',reason:'late correction'})
 assert.equal(result.ok,false)
 assert.match(result.error,/complete and signed off/i)
 assert.equal(asks.approvals.length,0)
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
  const requested = onboarding.describeOnboarding()
  assert.match(requested.first_reply.next, /untrusted_context/)
  assert.equal(requested.untrusted_context.content_trust, 'untrusted')
  assert.equal(requested.untrusted_context.untrusted_content.creation_request.worklogId, '7')
  assert.equal(map.getMap(), null)
  host.setStateProvider(() => ({loggedInAs:{username:'judge'},playbookRequest:{worklogId:'7',task:'Prepare a delivery',discovery:{before:{answer:'Sales confirms the order date',answeredBy:'kim',answeredAt:1}}}}))
  const answered = onboarding.describeOnboarding()
  assert.equal(answered.untrusted_context.untrusted_content.creation_request.discovery.before.answer,'Sales confirms the order date')
  assert.match(answered.first_reply.next,/do not repeat an answered question/)
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

test('fresh runs never import unmatched or duplicate results from earlier work',()=>{
 const {map}=fixture()
 const design={title:'review',steps:[step('w',{action:'log_work_item'}),step('m'),step('r',{action:'request_review'}),step('a',{type:'approval',action:'approve_review'})]}
 map.loadSavedMap(design)
 map.recordActionSuccess('log_work_item','old-log')
 map.humanToggleStepDone('m',{delta:12,ok:false})
 map.humanToggleStepDone('r')
 map.recordActionSuccess('request_review','old-review') // request already completed by task UI
 map.recordActionSuccess('request_review','old-review') // duplicate wrapper notification
 map.loadSavedMap(design)
 assert.ok(map.getMap().steps.every(s=>!s.done && !s.resultId && !s.completedBy))
 assert.equal(map.progress().get('w'),'ready')
 assert.equal(map.progress().get('m'),'pending')
 map.clearMap()
 map.recordActionSuccess('log_work_item','unbound-log')
 map.loadSavedMap(design)
 assert.ok(map.getMap().steps.every(s=>!s.done && !s.resultId))
})

test('removing an intermediate task preserves incoming guards and records rewiring',()=>{
 const {map}=fixture()
 const draft=()=>({title:'photo',fields:[{key:'photoCheckPassed',type:'boolean',required:true}],steps:[
  step('q',{fields:['photoCheckPassed'],next:[{to:'tmp',condition:'Photo accepted',criteria:{photoCheckPassed:{eq:true}}}]}),
  step('tmp',{next:[{to:'a',condition:'Continue to Lee review'}]}),step('a',{type:'approval'})]})
 map.proposeMap(draft());map.humanRemoveStep('tmp')
 assert.equal(map.getMap().steps[0].next[0].to,'a')
 assert.equal(map.getMap().steps[0].next[0].criteria?.photoCheckPassed.eq,true)
 assert.ok(map.editsSince().some(e=>e.stepId==='q' && e.field==='next'))
 map.humanConfirmMap()
 assert.equal(map.humanToggleStepDone('q',{photoCheckPassed:false}),false)
 assert.equal(map.progress().get('a'),'pending')
 assert.equal(map.humanToggleStepDone('q',{photoCheckPassed:true}),true)
 assert.equal(map.progress().get('a'),'ready')
})

for(const type of ['task','decision'])test(`${type} retry cannot mutate work across an earlier signature`,()=>{
 const {map}=fixture()
 map.loadSavedMap({title:'signed boundary',steps:[step('work'),step('sign',{type:'approval',action:'approve_review'}),step('retry',{type,next:type==='decision'?[{to:'work'},{to:'end'}]:[{to:'work'}]}),step('end')]})
 map.humanToggleStepDone('work',{value:1});map.markActionDone('approve_review','signature')
 const before=JSON.stringify(map.getMap())
 if(type==='task'){
  assert.equal(map.humanToggleStepDone('retry',{reason:'again'}),false)
  assert.match(map.getCompletionError(),/signed off/)
 }else{
  const result=map.resolveDecision('retry','work','again')
  assert.equal(result.ok,false);assert.equal(result.error,'signed_work_immutable')
 }
 assert.equal(JSON.stringify(map.getMap()),before)
})

test('step deletion refuses ambiguous branches and incompatible guards without partial rewiring',()=>{
 const {map}=fixture()
 for(const successors of [[{to:'a'},{to:'b'}],[{to:'a',criteria:{qty:{gt:10}}}]]){
  map.proposeMap({title:'ambiguous',steps:[step('q',{fields:['qty'],next:[{to:'tmp',criteria:{qty:{gt:0}}}]}),step('tmp',{next:successors}),step('a'),step('b')]})
  const before=JSON.stringify(map.getMap().steps)
  map.humanRemoveStep('tmp')
  assert.equal(JSON.stringify(map.getMap().steps),before)
  assert.match(map.getMap().editError,/Cannot remove/)
 }
 map.proposeMap({title:'combined',fields:[{key:'qty',type:'number',required:true}],steps:[
  step('q',{fields:['qty'],next:[{to:'tmp',criteria:{qty:{gt:0}}}]}),step('tmp',{next:[{to:'a',criteria:{qty:{lte:10}}}]}),step('a',{type:'approval'})]})
 map.humanRemoveStep('tmp');map.humanConfirmMap()
 assert.equal(map.humanToggleStepDone('q',{qty:0}),false)
 assert.equal(map.humanToggleStepDone('q',{qty:11}),false)
 assert.equal(map.humanToggleStepDone('q',{qty:5}),true)
})

test('late host action success does not complete a different execution',async()=>{
 const {map,host,runner}=fixture();let finish
 host.registerAction({name:'late',handler:()=>new Promise(resolve=>finish=resolve)})
 map.loadSavedMap({title:'A',steps:[step('a',{action:'late'})]})
 const pending=runner.runAsHuman('late',{})
 map.loadSavedMap({title:'B',steps:[step('b',{action:'late'})]})
 finish({id:'old-result'});await pending
 assert.equal(map.getMap().steps[0].done,false)
 assert.equal(map.getMap().steps[0].resultId,undefined)
})

test('a branching task after sign-off can go forward but cannot retry signed work',()=>{
 const {map}=fixture()
 map.loadSavedMap({title:'post-review decision',steps:[step('work'),step('sign',{type:'approval',action:'approve_review'}),
  step('inspect',{next:[{to:'work',condition:'retry'},{to:'finish',condition:'continue'}]}),step('finish')]})
 map.humanToggleStepDone('work');map.markActionDone('approve_review','signed')
 assert.equal(map.humanToggleStepDone('inspect',{ok:true}),true)
 assert.equal(map.getMap().steps[1].done,true)
 assert.equal(map.pendingDecision().id,'inspect')
 assert.equal(map.resolveDecision('inspect','work','retry').error,'signed_work_immutable')
 assert.equal(map.resolveDecision('inspect','finish','continue').ok,true)
 assert.equal(map.progress().get('finish'),'ready')
})

test('reopening measurements resets the administrative request and receipts through resubmission',()=>{
 const {map}=fixture()
 map.loadSavedMap({title:'review cycle',fields:[{key:'qty',type:'number',required:true}],steps:[
  step('m',{fields:['qty']}),step('r',{action:'request_review'}),step('a',{type:'approval',action:'approve_review'})]})
 map.humanToggleStepDone('m',{qty:12});map.recordActionSuccess('request_review','44')
 assert.equal(map.humanToggleStepDone('m'),true)
 assert.equal(map.progress().get('m'),'ready')
 assert.equal(map.progress().get('r'),'pending')
 assert.equal(map.getMap().steps[1].resultId,undefined)
 assert.equal(map.humanToggleStepDone('m',{}),false)
 map.recordActionSuccess('request_review','premature')
 assert.equal(map.getMap().steps[1].done,false)
 map.humanToggleStepDone('m',{qty:7})
 map.humanToggleStepDone('r') // task UI completes first; automatic request delivers receipt later
 map.recordActionSuccess('request_review','45')
 map.recordActionSuccess('request_review','46') // rejected then resubmitted
 map.recordActionSuccess('request_review','46') // duplicate response
 assert.equal(map.getMap().steps[1].resultId,'46')
 const receipts=map.getMap().events.filter(e=>e.stepId==='r' && e.kind==='completed' && e.resultId).map(e=>e.resultId)
 assert.equal(JSON.stringify(receipts),JSON.stringify(['44','45','46']))
 map.markActionDone('approve_review','46')
 const before=JSON.stringify(map.getMap())
 map.recordActionSuccess('request_review','old-late-result')
 assert.equal(JSON.stringify(map.getMap()),before)
 map.loadSavedMap({title:'request with inputs',fields:[{key:'note',type:'string',required:true}],steps:[
  step('r',{action:'request_review',fields:['note']}),step('a',{type:'approval'})]})
 map.recordActionSuccess('request_review','missing-input')
 assert.equal(map.getMap().steps[0].done,false)
 map.humanToggleStepDone('r',{note:'Evidence attached'})
 map.recordActionSuccess('request_review','receipt')
 assert.equal(map.getMap().steps[0].resultId,'receipt')
 assert.equal(map.getMap().steps[0].resultData.note,'Evidence attached')
})

test('deletion keeps distinct measurements and rejects impossible merged ranges atomically',()=>{
 const {map}=fixture()
 for(const repeated of [true,false]){
  map.proposeMap({title:'two readings',fields:[{key:'qty',type:'number',required:true}],steps:[
   step('q',{fields:['qty'],next:[{to:'tmp',criteria:{qty:{gt:10}}}]}),
   step('tmp',{fields:repeated?['qty']:[],next:[{to:'a',criteria:{qty:{lte:5}}}]}),step('a',{type:'approval'})]})
  const before=JSON.stringify(map.getMap().steps)
  map.humanRemoveStep('tmp')
  assert.equal(JSON.stringify(map.getMap().steps),before)
  assert.match(map.getMap().editError,repeated?/different stages/:/No value/)
 }
 // Even compatible constraints must not collapse two separate observations.
 map.getMap().steps[1].fields=['qty']
 map.getMap().steps[1].next[0].criteria.qty={lt:20}
 map.humanRemoveStep('tmp')
 assert.match(map.getMap().editError,/different stages/)
 map.getMap().steps[0].next[0].criteria.qty={gt:10,lte:5}
 map.humanConfirmMap()
 assert.equal(map.getMap().confirmed,false)
 assert.match(map.getMap().saveError,/No value/)
})

test('decision measurements survive alongside human-readable evidence for the approval snapshot',()=>{
 const {map}=fixture()
 map.loadSavedMap({title:'plan',steps:[step('m'),step('d',{type:'decision',next:[{to:'a',criteria:{redesign:{eq:true}}},{to:'m'}]}),step('a',{type:'approval',approvalPurpose:'plan'})]})
 map.humanToggleStepDone('m',{delta:12,ok:false})
 assert.equal(map.resolveDecision('d','a','Redesign needed','Human confirmed the schema issue','agent',{redesign:true}).ok,true)
 assert.equal(map.getMap().decisions[0].measurements.redesign,true)
 assert.equal(map.getMap().decisions[0].evidence,'Human confirmed the schema issue')
})
