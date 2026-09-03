import express from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, verifyPassword } from './db.js'
import { approvalGate, reviewFingerprint } from './runstate.js'
import { validateFieldBindings, validateFieldValues } from '../shared/fields.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30

const db = await createDb()
// Persisted in the DB (unless overridden) so sessions survive redeploys.
const SECRET = process.env.SESSION_SECRET || (await db.getSessionSecret())
const app = express()
app.use(express.json())

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/* ---------------- auth ---------------- */

function sign(username, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${username}|${exp}`).digest('hex')
}

function issueToken(username) {
  const exp = Date.now() + TOKEN_TTL_MS
  return Buffer.from(`${username}|${exp}|${sign(username, exp)}`).toString('base64url')
}

function readToken(token) {
  try {
    const [username, expStr, sig] = Buffer.from(token, 'base64url').toString().split('|')
    const exp = Number(expStr)
    if (!username || !exp || exp < Date.now()) return null
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(sign(username, exp), 'hex'))) return null
    return username
  } catch {
    return null
  }
}

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body ?? {}
  // Embedded-browser credential dialogs sometimes autocapitalize or add
  // whitespace — normalize defensively (demo accounts only).
  const user = await db.getUser(String(username ?? '').trim().toLowerCase())
  const pw = String(password ?? '').trim()
  if (!user || !(verifyPassword(user, pw) || verifyPassword(user, pw.charAt(0).toLowerCase() + pw.slice(1)))) {
    return res.status(401).json({ error: 'Invalid username or password' })
  }
  res.json({
    token: issueToken(user.username),
    user: { username: user.username, name: user.name, role: user.role },
  })
}))

const auth = asyncHandler(async (req, res, next) => {
  const header = req.get('authorization') ?? ''
  const username = header.startsWith('Bearer ') ? readToken(header.slice(7)) : null
  const user = username ? await db.getUser(username) : null
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  req.user = { username: user.username, name: user.name, role: user.role }
  next()
})

/* ---------------- api ----------------
 * `actingAs` lets a logged-in session act as another demo persona (kim/lee)
 * so a single reviewer can play both sides of the flow. Demo-grade by design.
 */

const actor = (req) => String(req.body?.actingAs || req.user.username)

// PostgreSQL throws on non-integer ids; an unhandled async throw kills the
// process. Validate up front and answer 400 instead.
const intParam = (req, res) => {
  const n = Number(req.params.id)
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(n) || n > 2147483647) {
    res.status(400).json({ error: 'invalid_id' })
    return null
  }
  return String(n)
}

app.get('/api/state', auth, asyncHandler(async (req, res) => {
  const [users, worklogs, approvals, processes] = await Promise.all([
    db.listUsers(),
    db.listWorklogs(),
    db.listApprovals(),
    db.listProcesses(),
  ])
  res.json({ me: req.user, users, worklogs, approvals, processes })
}))

async function roleOfUser(username) {
  if (!username) return undefined
  const users = await db.listUsers()
  return users.find((u) => u.username === username)?.role
}

app.post('/api/worklogs', auth, asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.date || !b.line || !b.task) return res.status(400).json({ error: 'date, line, task are required' })
  const role = await roleOfUser(b.actingAs)
  if (role !== 'Contributor')
    return res.status(403).json({
      error: 'role_mismatch',
      detail: `Work logs are written by a known Contributor persona; got ${b.actingAs ?? 'none'} (${role ?? 'unknown role'}).`,
    })
  if (b.data?.systemGenerated === true) {
    const run = await db.getRun(String(b.data.runId ?? ''))
    if (!run) return res.status(400).json({error: 'invalid_review_run'})
    if (run.startedBy !== req.user.username) return res.status(403).json({error: 'not_run_owner'})
    const process = await db.getProcess(run.processId)
    if (b.data.approvalStepId && !process?.map?.steps?.some(s => s.id === b.data.approvalStepId && s.type === 'approval'))
      return res.status(400).json({error: 'invalid_review_step'})
  }
  const row = await db.createWorklog({
    date: String(b.date),
    line: String(b.line),
    task: String(b.task),
    progressPct: Number(b.progressPct ?? 100) || 0,
    hours: Number(b.hours ?? 0) || 0,
    note: String(b.note ?? ''),
    urgent: Boolean(b.urgent),
    kind: String(b.kind ?? 'routine'),
    data: b.data && typeof b.data === 'object' ? b.data : {},
    createdBy: actor(req),
  })
  res.json(row)
}))

app.post('/api/worklogs/:id/discovery', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const answer = req.body?.answer
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 4000)
    return res.status(400).json({ error: 'Write an answer of 1–4,000 characters.' })
  const wl = await db.getWorklog(req.params.id)
  if (!wl) return res.status(404).json({ error: 'worklog not found' })
  const who = actor(req)
  if (who !== wl.createdBy || await roleOfUser(who) !== 'Contributor')
    return res.status(403).json({ error: 'Answer as the contributor who recorded this work.' })
  const row = await db.saveDiscoveryAnswer(wl.id, {answer: answer.trim(), answeredBy: who, answeredAt: Date.now()}, who)
  if (!row) return res.status(409).json({ error: 'Discovery answers belong to draft work, before execution or review.' })
  res.json(row)
}))

// A review signs off its own predecessor work on the active route. Work after
// that approval remains pending until the reviewer hands it to the next owner.
// Single-active-run policy: an abandoned run's paperwork must not stay
// approvable — its pending reviews are cancelled with a reason.
async function cancelPendingApprovalsForRun(runId) {
  const worklogs = await db.listWorklogs()
  const linked = worklogs.filter((w) => w?.data?.runId != null && String(w.data.runId) === String(runId))
  if (linked.length === 0) return
  const approvals = await db.listApprovals()
  for (const a of approvals) {
    if (a.status === 'PENDING' && linked.some((w) => w.id === a.worklogId)) {
      await db.decideApproval(a.id, 'CANCELLED', 'run superseded by a newer execution')
    }
  }
}

async function openRunStepsFor(worklogId, stampedRunId, stepId, requesting = false) {
  const r = stampedRunId != null ? await db.getRun(stampedRunId) : await db.findRunForWorklog(worklogId)
  if (!r) return stampedRunId != null ? { runId: stampedRunId, open: ['linked run is unavailable'] } : null
  const process = await db.getProcess(r.processId)
  return { runId: r.id, ...approvalGate(r, process?.map, stepId, requesting) }
}

app.post('/api/worklogs/:id/submit', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const wl = await db.getWorklog(req.params.id)
  if (!wl) return res.status(404).json({ error: 'worklog not found' })
  if (wl.status !== 'draft' && wl.status !== 'rejected')
    return res.status(400).json({ error: `worklog is already ${wl.status}` })
  const linked = await openRunStepsFor(wl.id, wl.data?.runId, req.body?.stepId ?? wl.data?.approvalStepId, true)
  if (linked && linked.open.length > 0) {
    return res.status(409).json({
      error: 'process_incomplete',
      detail: `This entry belongs to playbook run #${linked.runId}, which still has required steps open: ${linked.open.join(' → ')}. Finish them (or resolve a deviation) before requesting review.`,
    })
  }
  {
    const approvals = await db.listApprovals()
    if (approvals.some((a) => a.worklogId === wl.id && a.status === 'PENDING'))
      return res.status(409).json({ error: 'duplicate_review', detail: 'A review for this entry is already pending.' })
  }
  const approver = String(req.body?.approver ?? 'lee')
  const approverRole = await roleOfUser(approver)
  if (approverRole !== 'Reviewer')
    return res.status(400).json({ error: 'invalid_approver', detail: `Approver must be an existing Reviewer; "${approver}" is ${approverRole ?? 'unknown'}.` })
  if (wl.createdBy && approver === wl.createdBy)
    return res.status(400).json({ error: 'invalid_approver', detail: 'An entry cannot be reviewed by its own author.' })
  const approval = await db.createApproval({
    worklogId: wl.id,
    requestedBy: actor(req),
    approver,
    stepId: linked?.stepId,
    scope: linked?.scope,
  })
  if (!approval) return res.status(409).json({ error: 'duplicate_review' })
  res.json(approval)
}))

// Persist the verified measurements that passed a decision's criteria.
app.post('/api/worklogs/:id/verification', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const m = req.body?.measurements
  if (!m || typeof m !== 'object') return res.status(400).json({ error: 'measurements object is required' })
  {
    const row = await db.getWorklog(req.params.id)
    if (row?.status === 'approved')
      return res.status(409).json({ error: 'approved_immutable', detail: 'This entry is approved; changes require a new review cycle.' })
  }
  const patch = {
    verification: m,
    verifiedAt: new Date().toISOString(),
  }
  if (req.body?.route && typeof req.body.route === 'object') {
    patch.verifiedRoute = {
      label: typeof req.body.route.label === 'string' ? req.body.route.label : undefined,
      pass: req.body.route.pass === true,
      checked: req.body.route.checked === true,
    }
  }
  const row = await db.mergeWorklogData(req.params.id, patch)
  if (!row) return res.status(404).json({ error: 'worklog not found' })
  res.json(row)
}))

// Attach a corrective action to an EXISTING incident (instead of creating a new one).
app.post('/api/worklogs/:id/corrective', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const b = req.body ?? {}
  if (!b.actionTaken) return res.status(400).json({ error: 'actionTaken is required' })
  {
    const row = await db.getWorklog(req.params.id)
    if (row?.status === 'approved')
      return res.status(409).json({ error: 'approved_immutable', detail: 'This entry is approved; changes require a new review cycle.' })
  }
  const patch = { actionTaken: String(b.actionTaken) }
  if (b.result !== undefined) patch.correctiveResult = String(b.result)
  if (b.viscosity !== undefined) patch.viscosity = Number(b.viscosity)
  if (b.testPanelResult !== undefined) patch.testPanelResult = String(b.testPanelResult)
  const row = await db.mergeWorklogData(req.params.id, patch)
  if (!row) return res.status(404).json({ error: 'worklog not found' })
  res.json(row)
}))

app.post('/api/approvals/:id/decide', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const decision = String(req.body?.decision ?? '')
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' })
  }
  if (decision === 'REJECTED') {
    const c = String(req.body?.comment ?? '').trim()
    if (!c || c.toLowerCase() === 'rejected')
      return res.status(400).json({ error: 'comment_required', detail: 'A rejection needs a real reason the contributor can act on.' })
  }
  const existing = await db.getApproval(req.params.id)
  if (!existing) return res.status(404).json({ error: 'approval not found' })
  if (existing.status !== 'PENDING') return res.status(400).json({ error: `approval is already ${existing.status}` })
  {
    const actingAs = typeof req.body?.actingAs === 'string' ? req.body.actingAs : undefined
    if (!actingAs)
      return res.status(400).json({ error: 'actingAs_required', detail: 'Decisions must state the acting persona.' })
    if (actingAs !== existing.approver)
      return res.status(403).json({
        error: 'role_mismatch',
        detail: `This review is assigned to ${existing.approver}; the active persona is ${actingAs}.`,
      })
    const r = await roleOfUser(actingAs)
    if (r !== 'Reviewer')
      return res.status(403).json({ error: 'role_mismatch', detail: `Only a Reviewer may decide; ${actingAs} is ${r ?? 'unknown'}.` })
  }
  if (decision === 'APPROVED') {
    const wlRow = await db.getWorklog(existing.worklogId)
    const linked = await openRunStepsFor(existing.worklogId, wlRow?.data?.runId, existing.stepId)
    if (linked && linked.open.length > 0) {
      return res.status(409).json({
        error: 'process_incomplete',
        detail: `Playbook run #${linked.runId} behind this entry still has required steps open: ${linked.open.join(' → ')}. Approving now would sign off unfinished work.`,
      })
    }
  }
  const decided = await db.decideApproval(existing.id, decision, req.body?.comment)
  if (!decided || decided.status !== decision)
    return res.status(409).json({ error: 'review_conflict', detail: 'This review was already decided or its evidence changed. Refresh and request a new review if needed.' })
  res.json(decided)
}))

app.get('/api/processes', auth, asyncHandler(async (_req, res) => {
  res.json(await db.listProcesses())
}))

app.post('/api/processes', auth, asyncHandler(async (req, res) => {
  const { title, map } = req.body ?? {}
  if (!title || !Array.isArray(map?.steps) || !map.steps.length ||
      map.steps.some((s) => !s || typeof s.id !== 'string' || !['task', 'decision', 'approval'].includes(s.type)) ||
      new Set(map.steps.map((s) => s.id)).size !== map.steps.length) return res.status(400).json({ error: 'title and map.steps are required' })
  const invalid = validateFieldBindings(map)
  if (invalid) return res.status(400).json({error: 'invalid_fields', detail: invalid})
  res.json(await db.saveProcess({ title: String(title), map, createdBy: actor(req) }))
}))

app.get('/api/processes/:id', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const row = await db.getProcess(req.params.id)
  if (!row) return res.status(404).json({ error: 'process not found' })
  res.json(row)
}))

app.delete('/api/processes/:id', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const ok = await db.deleteProcess(req.params.id)
  if (!ok) return res.status(404).json({ error: 'process not found' })
  res.json({ ok: true })
}))

/* Process runs: one row per execution of a playbook, updated as steps progress. */

app.post('/api/runs', auth, asyncHandler(async (req, res) => {
  const { processId, title } = req.body ?? {}
  if (!processId || !title) return res.status(400).json({ error: 'processId and title are required' })
  const process = await db.getProcess(String(processId).match(/^[1-9]\d{0,8}$/) ? String(processId) : '0')
  if (!process) return res.status(404).json({ error: 'process not found' })
  const steps = process.map.steps.filter((s) => s.type !== 'decision')
    .map((s) => ({ id: s.id, label: s.label, type: s.type, action: s.action, role: s.role, status: 'pending' }))
  // Ownership binds to the authenticated session (personas are a demo skin
  // and change mid-run — they must never break the sync lane).
  const run = await db.startRun({
    processId: String(processId),
    title: String(title),
    startedBy: req.user.username,
    steps: Array.isArray(steps) ? steps : [],
  })
  // One live run per workspace: starting retires every older active run so a
  // reload can trust "the newest active" as the real state.
  const all = await db.listRuns()
  for (const r of all) {
    if (r.status === 'active' && Number(r.id) < Number(run.id)) {
      // Three-way classification: real open work → abandoned (+ cancel its
      // reviews); everything done → completed; only sign-off outstanding →
      // stays ACTIVE awaiting approval (multi-pending is supported).
      const steps = Array.isArray(r.steps) ? r.steps : []
      const open = steps.filter(
        (s) => s && s.type !== 'approval' && ['ready', 'blocked', 'skipped', 'pending'].includes(String(s.status ?? '')),
      )
      const approvalsOutstanding = steps.some(
        (s) => s && s.type === 'approval' && !['done', 'not_applicable'].includes(String(s.status ?? '')),
      )
      if (open.length > 0) {
        await db.updateRun(r.id, { status: 'abandoned' })
        await cancelPendingApprovalsForRun(r.id)
      } else if (steps.length > 0 && !approvalsOutstanding) {
        await db.updateRun(r.id, { status: 'completed' })
      }
      // else: awaiting sign-off — leave active, keep its pending review.
    }
  }
  res.json(run)
}))

app.post('/api/runs/:id', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const b = req.body ?? {}
  {
    const row = await db.getRun(req.params.id)
    if (!row) return res.status(404).json({ error: 'run not found' })
    if (row.startedBy && row.startedBy !== req.user.username)
      return res.status(403).json({ error: 'not_run_owner', detail: `Run ${row.id} is synced by ${row.startedBy}.` })
    if (b.decisions !== undefined && (!Array.isArray(b.decisions) || b.decisions.some((d) =>
      !d || typeof d.stepId !== 'string' || typeof d.to !== 'string')))
      return res.status(400).json({error: 'invalid_decisions'})
    if (b.steps !== undefined) {
      if (Array.isArray(b.steps) && b.steps.length === 0 && Array.isArray(row.steps) && row.steps.length > 0)
        return res.status(400).json({ error: 'invalid_steps', detail: 'A run\u2019s recorded steps cannot be cleared.' })
      const ok =
        Array.isArray(b.steps) &&
        b.steps.every(
          (s) =>
            s && typeof s === 'object' && typeof s.id === 'string' &&
            ['done', 'ready', 'blocked', 'skipped', 'pending', 'conditional', 'not_applicable'].includes(s.status),
        )
      if (!ok) return res.status(400).json({ error: 'invalid_steps' })
      const fixed = (row.steps ?? []).filter((s) => s.type !== 'gate')
      const incoming = Array.isArray(b.steps) ? b.steps : []
      const sameDesign = fixed.every((s) => incoming.some((n) => n.id === s.id && n.type === s.type)) &&
        incoming.every((n) => fixed.some((s) => s.id === n.id) || (n.type === 'gate' && n.id.startsWith('gate:'))) &&
        new Set(incoming.map((s) => s.id)).size === incoming.length
      if (!sameDesign) return res.status(400).json({ error: 'invalid_steps' })
    }
    if (b.steps !== undefined || b.decisions !== undefined) {
      const incoming = b.steps ?? row.steps
      const process = await db.getProcess(row.processId)
      const design = process?.map?.steps ?? row.steps
      for (const step of incoming.filter(s => s.type === 'task' && s.status === 'done')) {
        const keys = design.find(s => s.id === step.id)?.fields ?? []
        const fields = (process?.map?.fields ?? []).filter(f => keys.includes(f.key))
        const errors = validateFieldValues(fields, step.resultData)
        if (fields.length !== keys.length) errors.push('Undefined task inputs')
        if (errors.length) return res.status(400).json({error: 'invalid_field_values', detail: `${step.label || step.id}: ${errors.join('; ')}`})
      }
      const lastSigned = design.reduce((last, s, i) =>
        s.type === 'approval' && row.steps.some((r) => r.id === s.id && r.status === 'done' && r.resultId) ? i : last, -1)
      if (lastSigned >= 0) {
        const scope = design.slice(0, lastSigned).flatMap((s) => [s.id, `gate:${s.id}`])
        if (reviewFingerprint(row, scope) !== reviewFingerprint({...row, steps: incoming, decisions: b.decisions ?? row.decisions}, scope))
          return res.status(409).json({error: 'signed_work_immutable', detail: 'Work already signed off cannot be changed in this run. Start a new execution to record a correction.'})
      }
    }
    if (b.status !== undefined && !['active', 'completed', 'abandoned'].includes(String(b.status)))
      return res.status(400).json({ error: 'invalid_status' })
    if (b.events !== undefined && (!Array.isArray(b.events) || b.events.length > 5000 || b.events.some((e) =>
      !e || typeof e.id !== 'string' || e.id.length > 100 || !Number.isFinite(e.ts) ||
      !['completed', 'reopened', 'problem', 'approval', 'deviation'].includes(e.kind) ||
      typeof e.stepId !== 'string' || typeof e.label !== 'string' ||
      (e.note !== undefined && (typeof e.note !== 'string' || e.note.length > 10000)))))
      return res.status(400).json({ error: 'invalid_events' })
  }
  const run = await db.updateRun(req.params.id, {
    steps: Array.isArray(b.steps) ? b.steps : undefined,
    decisions: Array.isArray(b.decisions) ? b.decisions : undefined,
    status: typeof b.status === 'string' ? b.status : undefined,
    deviations: typeof b.deviations === 'number' ? b.deviations : undefined,
    events: b.events,
  })
  if (!run) return res.status(404).json({ error: 'run not found' })
  if (b.status === 'abandoned') await cancelPendingApprovalsForRun(run.id)
  res.json(run)
}))

app.get('/api/runs/:id', auth, asyncHandler(async (req, res) => {
  if (intParam(req, res) === null) return
  const run = await db.getRun(req.params.id)
  if (!run) return res.status(404).json({error: 'run not found'})
  res.json(run)
}))

app.get('/api/runs', auth, asyncHandler(async (req, res) => {
  if (req.query.processId && !/^[1-9]\d{0,8}$/.test(String(req.query.processId))) return res.status(400).json({ error: 'invalid_id' })
  if (req.query.before && !/^[1-9]\d{0,8}$/.test(String(req.query.before))) return res.status(400).json({ error: 'invalid_id' })
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return res.status(400).json({error: 'invalid_limit'})
  res.json(await db.listRuns(req.query.processId ? String(req.query.processId) : undefined, {before: req.query.before ? String(req.query.before) : undefined, limit}))
}))

// Visitors share the demo library; no visitor may erase another reviewer's work.
app.post('/api/admin/reset', auth, asyncHandler(async (req, res) => {
  res.status(403).json({error: 'shared_reset_disabled', detail: 'Shared demo records cannot be reset from a visitor session. Start a new work item in your own tab.'})
}))

/* ---------------- static ---------------- */

const dist = path.join(__dirname, '..', 'dist')
// Hashed assets may cache forever; the HTML shell and the SDK bundle must not —
// otherwise deploys don't reach already-open judges.
app.use(
  express.static(dist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store')
      } else if (filePath.endsWith('understudy.js')) {
        // Unhashed SDK bundle — always revalidate.
        res.setHeader('Cache-Control', 'no-cache')
      } else if (/assets[\\/].+-[\w-]+\.(js|css)$/.test(filePath)) {
        // Vite content-hashed assets are immutable.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }),
)
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.sendFile(path.join(dist, 'index.html'))
})

// Every async route and authentication middleware forwards failures here.
app.use((err, _req, res, _next) => {
  console.error('request error:', err?.message ?? err)
  if (res.headersSent) return _next(err)
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500
  res.status(status).json({ error: status === 500 ? 'internal_error' : err.message })
})

app.listen(PORT, () => console.log(`[server] listening on :${PORT} (db: ${db.kind})`))
