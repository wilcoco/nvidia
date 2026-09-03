import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import vm from 'node:vm'
const bundle=await build({stdin:{contents:"export * from './src/taskHints'",resolveDir:process.cwd()},bundle:true,format:'cjs',platform:'node',write:false})
test('previous-value hints stay with the same user, process, task, and units',()=>{
 const module={exports:{}},entries=new Map([['understudy.recentValues','{"weight":"999"}']])
 vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,localStorage:{getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)}})
 const {taskHint,rememberTaskHint}=module.exports
 const scope={user:'judge:kim',processId:'p1',stepId:'measure',field:{key:'weight',type:'number',unit:'kg'}}
 assert.equal(taskHint(scope),undefined)
 rememberTaskHint(scope,0,'r1')
 assert.equal(taskHint(scope).value,'0');assert.equal(taskHint(scope).runId,'r1')
 for(const change of [{user:'park'},{processId:'p2'},{stepId:'other'},{field:{...scope.field,unit:'g'}}])assert.equal(taskHint({...scope,...change}),undefined)
})
