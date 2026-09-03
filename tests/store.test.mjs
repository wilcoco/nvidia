import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import vm from 'node:vm'

const bundle = await build({stdin: {contents: "export * from './src/store'", resolveDir: process.cwd()}, bundle: true, format: 'cjs', platform: 'node', write: false})
function fixture(fetch) {
  const module = {exports: {}}
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, fetch, AbortSignal, setTimeout, clearTimeout,
    localStorage: {getItem: () => 'test-token'},
    CustomEvent: class {},
    window: {dispatchEvent() {}, Understudy: {getLoadedProcess: () => ({}), log() {}}},
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
