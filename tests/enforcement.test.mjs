import test from 'node:test'
import assert from 'node:assert/strict'
import { enforceRunUpdate } from '../server/enforcement.js'
import {routeProgress} from '../server/route.js'
import {approvalGate} from '../server/runstate.js'

const contributor = {actor:'kim', role:'Contributor', authenticatedAs:'kim', canAdmin:false}
const operator = {actor:'park', role:'Operations', authenticatedAs:'park', canAdmin:false}
const reviewer = {actor:'lee', role:'Reviewer', authenticatedAs:'lee', canAdmin:false}

test('server enforces sequence, role, attribution and approval ownership', () => {
  const map={steps:[
    {id:'prepare',type:'task',label:'Prepare',role:'Contributor'},
    {id:'handoff',type:'task',label:'Handoff',role:'Operations'},
    {id:'sign',type:'approval',label:'Sign',role:'Reviewer'},
  ]}
  const run={id:'1',startedBy:'kim',status:'active',steps:map.steps.map(s=>({...s,status:'pending'})),decisions:[],events:[]}
  assert.throws(()=>enforceRunUpdate(run,{steps:run.steps.map(s=>s.id==='handoff'?{...s,status:'done'}:s)},map,operator),/out_of_sequence/)
  assert.throws(()=>enforceRunUpdate(run,{steps:run.steps.map(s=>s.id==='prepare'?{...s,status:'done'}:s)},map,reviewer),/role_mismatch/)
  const first=enforceRunUpdate(run,{status:'completed',steps:run.steps.map(s=>s.id==='prepare'?{...s,status:'done',completedBy:'mallory',completedAt:1}:s)},map,contributor)
  assert.equal(first.status,'active')
  assert.equal(first.steps[0].completedBy,'kim')
  assert.equal(first.steps[0].authenticatedBy,'kim')
  assert.notEqual(first.steps[0].completedAt,1)
  assert.throws(()=>enforceRunUpdate({...run,steps:first.steps},{steps:first.steps.map(s=>s.id==='sign'?{...s,status:'done'}:s)},map,reviewer),/approval_server_owned/)
})

test('server recomputes decision criteria from persisted task evidence', () => {
  const map={fields:[{key:'ok',type:'boolean',required:true}],steps:[
    {id:'measure',type:'task',label:'Measure',role:'Contributor',fields:['ok']},
    {id:'health',type:'decision',label:'Health',role:'Reviewer',next:[
      {to:'pass',criteria:{ok:{eq:true}}},{to:'retry',criteria:{ok:{eq:false}}},
    ]},
    {id:'pass',type:'approval',label:'Approve',role:'Reviewer'},
    {id:'retry',type:'task',label:'Retry',role:'Contributor'},
  ]}
  const steps=[
    {...map.steps[0],status:'done',resultData:{ok:false},completedBy:'kim'},
    {...map.steps[2],status:'conditional'},
    {...map.steps[3],status:'conditional'},
  ]
  const run={id:'2',startedBy:'kim',status:'active',steps,decisions:[],events:[]}
  const base={stepId:'health',reason:'measured',ts:1}
  assert.throws(()=>enforceRunUpdate(run,{decisions:[{...base,to:'pass',measurements:{ok:true}}]},map,reviewer),/evidence_conflict/)
  const accepted=enforceRunUpdate(run,{decisions:[{...base,to:'retry',measurements:{ok:false}}]},map,reviewer)
  assert.equal(accepted.decisions[0].decidedBy,'lee')
  assert.equal(accepted.decisions[0].authenticatedBy,'lee')
})

test('server preserves its attribution when a later browser snapshot omits it', () => {
  const map={steps:[{id:'work',type:'task',role:'Contributor'}]}
  const run={id:'3',startedBy:'kim',status:'active',steps:[{id:'work',type:'task',status:'done',resultData:{n:1},completedBy:'kim',authenticatedBy:'judge',completedAt:7}],decisions:[],events:[]}
  const patch=enforceRunUpdate(run,{steps:[{id:'work',type:'task',status:'done',resultData:{n:1}}]},map,{...contributor,authenticatedAs:'judge'})
  assert.equal(patch.steps[0].completedBy,'kim')
  assert.equal(patch.steps[0].authenticatedBy,'judge')
  assert.equal(patch.steps[0].completedAt,7)
})

test('past decisions cannot be deleted or rewritten while invalidation preserves the record',()=>{
  const map={steps:[{id:'d',type:'decision',next:[{to:'work'}]},{id:'work',type:'task'}]}
  const old={stepId:'d',to:'work',reason:'recorded',measurements:{ok:true},ts:1,decidedBy:'lee',authenticatedBy:'lee'}
  const run={id:'4',startedBy:'lee',status:'active',steps:[{id:'work',type:'task',status:'pending'}],decisions:[old],events:[]}
  assert.throws(()=>enforceRunUpdate(run,{decisions:[]},map,reviewer),/decision_history_immutable/)
  assert.throws(()=>enforceRunUpdate(run,{decisions:[{...old,measurements:{ok:false}}]},map,reviewer),/decision_history_immutable/)
  const invalidated=enforceRunUpdate(run,{decisions:[{...old,invalidated:true}]},map,reviewer)
  assert.equal(invalidated.decisions[0].invalidated,true)
  assert.equal(invalidated.decisions[0].measurements.ok,true)
})

test('completed evidence cannot change under a stale branch and only its role may reopen it',()=>{
  const map={fields:[{key:'ok',type:'boolean',required:true}],steps:[
    {id:'measure',type:'task',label:'Measure',role:'Contributor',fields:['ok']},
    {id:'health',type:'decision',label:'Health',role:'Reviewer',next:[
      {to:'pass',criteria:{ok:{eq:true}}},{to:'retry',criteria:{ok:{eq:false}}},
    ]},
    {id:'pass',type:'approval',label:'Approve',role:'Reviewer'},
    {id:'retry',type:'task',label:'Retry',role:'Contributor'},
  ]}
  const choice={stepId:'health',to:'pass',measurements:{ok:true},ts:1,decidedBy:'lee',authenticatedBy:'lee'}
  const run={id:'5',startedBy:'kim',status:'active',steps:[
    {...map.steps[0],status:'done',resultData:{ok:true},completedBy:'kim',authenticatedBy:'kim',completedAt:1},
    {...map.steps[2],status:'ready'}, {...map.steps[3],status:'conditional'},
  ],decisions:[choice],events:[]}
  const conflicting=run.steps.map(step=>step.id==='measure'?{...step,resultData:{ok:false}}:step)
  assert.throws(()=>enforceRunUpdate(run,{steps:conflicting,decisions:[choice]},map,contributor),/evidence_conflict/)
  const reopened=run.steps.map(step=>step.id==='measure'?{...step,status:'ready'}:step)
  assert.throws(()=>enforceRunUpdate(run,{steps:reopened,decisions:[{...choice,invalidated:true}]},map,operator),/role_mismatch/)
  const accepted=enforceRunUpdate(run,{steps:reopened,decisions:[{...choice,invalidated:true}]},map,contributor)
  assert.equal(accepted.steps[0].status,'ready')
  assert.equal(accepted.steps[0].resultData,undefined)
  assert.equal(accepted.steps[0].completedBy,undefined)
})

test('server completion follows persisted decisions and ignores pending unchosen branches',()=>{
  const map={entry:'measure',steps:[
    {id:'measure',type:'task',next:[{to:'health'}]},
    {id:'health',type:'decision',next:[{to:'pass'},{to:'restore'}]},
    {id:'restore',type:'task',next:[{to:'diagnose'}]},
    {id:'diagnose',type:'task'},
    {id:'pass',type:'task',next:[{to:'sign'}]},
    {id:'sign',type:'approval'},
  ]}
  const steps=[
    {id:'measure',type:'task',status:'done'},
    {id:'restore',type:'task',status:'pending'},
    {id:'diagnose',type:'task',status:'pending'},
    {id:'pass',type:'task',status:'done'},
    {id:'sign',type:'approval',status:'done',resultId:'review-1'},
  ]
  const decisions=[{stepId:'health',to:'pass',ts:1}]
  assert.equal(routeProgress(map,steps,decisions).completed,true)
  const recomputed=enforceRunUpdate({id:'6',startedBy:'kim',status:'active',steps,decisions,events:[]},{status:'active'},map,contributor)
  assert.equal(recomputed.status,'completed')
  assert.deepEqual(routeProgress(map,steps,decisions).reachable,['measure','health','pass','sign'])
})

test('browser branch presentation cannot waive reachable work or approval',()=>{
  const map={steps:[
    {id:'work',type:'task',label:'Do work',role:'Contributor'},
    {id:'sign',type:'approval',label:'Approve work',role:'Reviewer'},
  ]}
  const run={id:'7',startedBy:'kim',status:'active',steps:map.steps.map(step=>({...step,status:'pending'})),decisions:[],events:[],deviations:0}
  for(const status of ['conditional','not_applicable']){
    const patch=enforceRunUpdate(run,{status:'completed',steps:run.steps.map(step=>({...step,status}))},map,contributor)
    assert.equal(patch.status,'active')
    assert.deepEqual(patch.steps.map(step=>step.status),['pending','pending'])
  }
  assert.throws(()=>enforceRunUpdate(run,{steps:run.steps.map(step=>step.id==='sign'
    ? {...step,status:'not_applicable',naReason:'skip approval'} : step)},map,reviewer),/approval_server_owned/)
  const deviation=enforceRunUpdate(run,{steps:run.steps.map(step=>step.id==='work'
    ? {...step,status:'not_applicable',naReason:'No shipment was received'} : step)},map,contributor)
  assert.equal(deviation.status,'active')
  assert.equal(deviation.steps[0].completedBy,'kim')
  assert.equal(deviation.events[0].kind,'deviation')
  assert.equal(deviation.deviations,1)
})

test('explicit terminal and approval selection follow the persisted active route',()=>{
  const map={entry:'measure',steps:[
    {id:'measure',type:'task',next:[{to:'health'}]},
    {id:'health',type:'decision',next:[{to:'sign'},{to:'restore'}]},
    {id:'sign',type:'approval',next:[]},
    {id:'restore',type:'task',next:[{to:'diagnose'}]},
    {id:'diagnose',type:'decision',next:[{to:'recoverSign'},{to:'plan'}]},
    {id:'recoverSign',type:'approval',next:[]},
    {id:'plan',type:'approval',approvalPurpose:'plan',next:[]},
  ]}
  const base=[
    {id:'measure',type:'task',status:'done'},
    {id:'sign',type:'approval',status:'pending'},
    {id:'restore',type:'task',status:'done'},
    {id:'recoverSign',type:'approval',status:'ready'},
    {id:'plan',type:'approval',status:'pending'},
  ]
  const recovered={status:'active',steps:base,decisions:[
    {stepId:'health',to:'restore',ts:1},{stepId:'diagnose',to:'recoverSign',ts:2},
  ]}
  assert.deepEqual(approvalGate(recovered,map,'recoverSign').open,[])
  assert.equal(approvalGate(recovered,map).stepId,'recoverSign')
  const signed=base.map(step=>step.id==='recoverSign'?{...step,status:'done',resultId:'review-1'}:step)
  assert.equal(routeProgress(map,signed,recovered.decisions).completed,true)
  assert.deepEqual(routeProgress(map,signed,recovered.decisions).reachable,
    ['measure','health','restore','diagnose','recoverSign'])

  const replanned={...recovered,steps:base.map(step=>step.id==='recoverSign'?{...step,status:'pending'}:
    step.id==='plan'?{...step,status:'ready'}:step),decisions:[
      {stepId:'health',to:'restore',ts:1},{stepId:'diagnose',to:'plan',ts:2},
    ]}
  assert.deepEqual(approvalGate(replanned,map,'plan').open,[])
  assert.equal(approvalGate(replanned,map).stepId,'plan')

  const cleanSteps=base.map(step=>step.id==='restore'?{...step,status:'pending'}:
    step.id==='sign'?{...step,status:'done',resultId:'review-clean'}:
      step.id==='recoverSign'?{...step,status:'pending'}:step)
  const cleanDecisions=[{stepId:'health',to:'sign',ts:1}]
  assert.equal(routeProgress(map,cleanSteps,cleanDecisions).completed,true)
  assert.deepEqual(routeProgress(map,cleanSteps,cleanDecisions).reachable,['measure','health','sign'])
})
