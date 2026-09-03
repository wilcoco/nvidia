import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {build} from 'esbuild'
import vm from 'node:vm'

const bundle = await build({stdin:{contents:"export * from './src/store'",resolveDir:process.cwd()},bundle:true,format:'cjs',platform:'node',write:false})
const modes=[['memory',''],...(process.env.TEST_DATABASE_URL?[['postgres',process.env.TEST_DATABASE_URL]]:[])]
for(const [mode,url] of modes) test(`${mode}: review delivery recovers across real HTTP commits and lost responses`, async()=>{
 let base=''
 const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DATABASE_URL:url,PORT:'0'},stdio:['ignore','pipe','pipe']})
 let stderr=''; server.stderr.on('data',b=>stderr+=b)
 try {
  await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{const match=String(b).match(/listening on :(\d+)/);if(match){base=`http://127.0.0.1:${match[1]}`;resolve()}});server.once('exit',c=>reject(Error(stderr||String(c))))})
  const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'judge',password:'webmcp2026'})}).then(r=>r.json())
  const request=async(path,body)=>{
   const res=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${login.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
   const data=await res.json();assert.equal(res.ok,true,JSON.stringify(data));return data
  }
  for(const path of ['normal','recovered','replan']) for(const failure of ['none','before-record','after-record','before-submit','after-submit']) {
   const steps=[{id:'work',type:'task',label:`${path} evidence`},{id:'approve',type:'approval',label:`Approve ${path}`,role:'Reviewer'}]
   const proc={title:`TEST delivery ${mode} ${path} ${failure}`,steps}
   const process=await request('/api/processes',{title:proc.title,map:proc,actingAs:'kim'})
   const run=await request('/api/runs',{processId:process.id,title:proc.title})
   const progress=[{...steps[0],status:'done',done:true,completedBy:'kim',completedAt:Date.now(),resultData:{path,passed:path!=='replan'}},{...steps[1],status:'ready'}]
   proc.steps=progress
   await request(`/api/runs/${run.id}`,{steps:progress})
   let fired=false, missState=0, recordPosts=0, submitPosts=0
   const notices=[]
   const transport=async(pathname,opts)=>{
    if(pathname==='/api/state' && missState){missState--;throw Error('QA transient reconnect failure')}
    const record=pathname==='/api/worklogs' && opts.method==='POST', submit=/\/submit$/.test(pathname)
    if(record)recordPosts++;if(submit)submitPosts++
    const matched=!fired && ((record && failure.endsWith('record')) || (submit && failure.endsWith('submit')))
    if(matched && failure.startsWith('before')){fired=true;throw Error('QA failure before HTTP commit')}
    const res=await fetch(base+pathname,opts)
    if(matched && failure.startsWith('after')){
     await res.text();fired=true;missState=1;throw Error('QA response lost after HTTP commit')
    }
    return res
   }
   const module={exports:{}}
   const storeGlobals={module,exports:module.exports,fetch:transport,AbortSignal,setTimeout,clearTimeout,
    localStorage:{getItem:k=>k==='linepulse-token'?login.token:null},sessionStorage:{getItem:()=>null,setItem(){}},CustomEvent:class{},
    window:{dispatchEvent(){},Understudy:{getLoadedProcess:()=>proc,currentRunId:()=>run.id,getProgress:()=>progress,
     flushRun:()=>request(`/api/runs/${run.id}`,{steps:progress}),log:message=>notices.push(message),notifyAction(){}}}}
   vm.runInNewContext(bundle.outputFiles[0].text,storeGlobals)
   const store=module.exports
   await store.refresh()
   await Promise.all(Array.from({length:8},()=>store.autoSyncApproval()))
   if(failure!=='none')await new Promise(r=>setTimeout(r,1900))
   await store.refresh();await store.autoSyncApproval()
   assert.equal(store.getState().reviewSync?.status,'ready',`${path}/${failure}`)
   const state=await request('/api/state')
   const records=state.worklogs.filter(w=>String(w.data.runId)===run.id)
   assert.equal(records.length,1,`${path}/${failure}: one evidence record`)
   const reviews=state.approvals.filter(a=>a.worklogId===records[0].id)
   assert.equal(reviews.length,1,`${path}/${failure}: one review`)
   assert.equal(reviews[0].status,'PENDING')
   for(let i=0;i<20;i++)await store.autoSyncApproval()
   assert.ok(recordPosts<=2 && submitPosts<=2)
   if(failure==='after-submit')assert.ok(notices.some(n=>n.includes('confirmed from the server')))
  }
 } finally {
  server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r))
 }
})
