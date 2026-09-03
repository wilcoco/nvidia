import {execFileSync, spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {buildRefMatchesCommit, validateBuildRef} from './release-build-ref.mjs'

const required = ['RUN_ID', 'REVIEW_ID', 'RUN_BUILD', 'VIDEO_BUILD', 'VIDEO_URL']
const missing = required.filter(key => !process.env[key]?.trim())
if (missing.length) {
  console.error(`Missing required release evidence: ${missing.join(', ')}`)
  process.exit(1)
}

const runBuild = validateBuildRef(process.env.RUN_BUILD, 'RUN_BUILD')

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim()
const commit = git('rev-parse', 'HEAD')
const short = commit.slice(0, 7)
const origin = git('rev-parse', 'origin/main')
const dirty = git('status', '--porcelain')
if (dirty) throw new Error('Worktree is not clean; commit or discard changes before creating a release manifest.')
if (origin !== commit) throw new Error(`HEAD ${commit} does not match origin/main ${origin}.`)

const liveUrl = (process.env.LIVE_URL?.trim() || 'https://nvidia-production-f205.up.railway.app').replace(/\/$/, '')
const fresh = path => fetch(`${liveUrl}${path}`, {
  headers: {'Cache-Control': 'no-cache'},
  cache: 'no-store',
  signal: AbortSignal.timeout(20_000),
})
const getBytes = async path => {
  const response = await fresh(path)
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

console.error(`Building exact commit ${commit} before comparing live artifacts…`)
const build = spawnSync('npm', ['run', 'build'], {
  cwd: process.cwd(),
  env: {...process.env, RAILWAY_GIT_COMMIT_SHA: commit},
  encoding: 'utf8',
})
if (build.status !== 0) {
  process.stderr.write(build.stdout || '')
  process.stderr.write(build.stderr || '')
  process.exit(build.status ?? 1)
}

const liveIndex = await getBytes('/')
const asset = liveIndex.toString().match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0]
if (!asset) throw new Error('Could not find the live app asset in index.html.')
const [liveApp, liveSdk] = await Promise.all([getBytes(asset), getBytes('/understudy.js')])
if (!liveApp.toString().includes(short)) throw new Error(`Live app does not identify build ${short}.`)

const localIndex = readFileSync('dist/index.html')
const localAsset = localIndex.toString().match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0]
if (localAsset !== asset) throw new Error(`Local asset ${localAsset ?? '(missing)'} does not match live asset ${asset}.`)
const localApp = readFileSync(`dist${localAsset}`)
const localSdk = readFileSync('public/understudy.js')
const artifacts = [
  ['index.html', localIndex, liveIndex],
  [asset, localApp, liveApp],
  ['/understudy.js', localSdk, liveSdk],
]
for (const [name, local, live] of artifacts) {
  if (!local.equals(live)) throw new Error(`Local and live ${name} differ for ${commit}.`)
}

const runMatches = buildRefMatchesCommit(commit, runBuild, 'RUN_BUILD')
const recordedAt = new Date().toISOString()
const validation = process.env.VALIDATION_SUMMARY?.trim() || 'Record exact commands and counts before submission.'

console.log(`# Understudy release manifest — ${short}`)
console.log('')
console.log(`- Recorded at: ${recordedAt}`)
console.log(`- Git commit / origin/main: \`${commit}\``)
console.log(`- Live URL: ${liveUrl}`)
console.log(`- Live build marker: \`${short}\``)
console.log(`- Qualification run: #${process.env.RUN_ID} on build \`${runBuild}\``)
console.log(`- Qualification review: #${process.env.REVIEW_ID}`)
console.log(`- Run matches release build: ${runMatches ? 'YES' : 'NO — rerun or document why this release is evidence-only/documentation-only'}`)
console.log(`- Demo video: ${process.env.VIDEO_URL}`)
console.log(`- Video-recorded build: \`${process.env.VIDEO_BUILD.trim()}\``)
console.log(`- Validation: ${validation}`)
console.log('')
console.log('## Exact live artifacts')
console.log('')
for (const [name, , live] of artifacts) console.log(`- \`${name}\`: \`${sha256(live)}\``)
console.log('')
console.log('## Evidence boundary')
console.log('')
console.log('- PostgreSQL, a physical phone, and an external WebMCP client count only when their dedicated evidence folders contain a dated result.')
console.log('- A 375px browser viewport and `window.__understudy` do not count as physical-mobile or external-client evidence.')
console.log('- Hard reload the judging tab after deployment before comparing the on-screen build or starting a qualification run.')
