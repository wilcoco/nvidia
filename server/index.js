import express from 'express'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, verifyPassword } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30

const db = await createDb()
// Persisted in the DB (unless overridden) so sessions survive redeploys.
const SECRET = process.env.SESSION_SECRET || (await db.getSessionSecret())
const app = express()
app.use(express.json())

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

app.post('/api/auth/login', async (req, res) => {
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
})

async function auth(req, res, next) {
  const header = req.get('authorization') ?? ''
  const username = header.startsWith('Bearer ') ? readToken(header.slice(7)) : null
  const user = username ? await db.getUser(username) : null
  if (!user) return res.status(401).json({ error: 'Not authenticated' })
  req.user = { username: user.username, name: user.name, role: user.role }
  next()
}

/* ---------------- api ----------------
 * `actingAs` lets a logged-in session act as another demo persona (kim/lee)
 * so a single reviewer can play both sides of the flow. Demo-grade by design.
 */

const actor = (req) => String(req.body?.actingAs || req.user.username)

app.get('/api/state', auth, async (req, res) => {
  const [users, worklogs, approvals, processes] = await Promise.all([
    db.listUsers(),
    db.listWorklogs(),
    db.listApprovals(),
    db.listProcesses(),
  ])
  res.json({ me: req.user, users, worklogs, approvals, processes })
})

app.post('/api/worklogs', auth, async (req, res) => {
  const b = req.body ?? {}
  if (!b.date || !b.line || !b.task) return res.status(400).json({ error: 'date, line, task are required' })
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
})

// A worklog produced inside a playbook run may only move toward approval when
// that run has no open required steps left (approval steps themselves and
// explicitly resolved deviations excluded). The engine syncs live statuses
// into the run row; the server enforces them here so UI clicks and direct
// API calls obey the same gate as agent tools.
async function openRunStepsFor(worklogId, stampedRunId) {
  const runs = await db.listRuns()
  for (const r of runs) {
    const steps = r?.steps
    if (!Array.isArray(steps)) continue
    const linked =
      (stampedRunId && String(r.id) === String(stampedRunId)) ||
      steps.some((s) => s && s.resultId === worklogId)
    if (!linked) continue
    const open = steps.filter(
      (s) =>
        s &&
        s.type !== 'approval' &&
        ['ready', 'blocked', 'skipped', 'pending'].includes(String(s.status ?? '')),
    )
    return { runId: r.id, open: open.map((s) => s.label || s.id) }
  }
  return null
}

app.post('/api/worklogs/:id/submit', auth, async (req, res) => {
  const worklogs = await db.listWorklogs()
  const wl = worklogs.find((w) => w.id === req.params.id)
  if (!wl) return res.status(404).json({ error: 'worklog not found' })
  if (wl.status !== 'draft') return res.status(400).json({ error: `worklog is already ${wl.status}` })
  const linked = await openRunStepsFor(wl.id, wl.data?.runId)
  if (linked && linked.open.length > 0) {
    return res.status(409).json({
      error: 'process_incomplete',
      detail: `This entry belongs to playbook run #${linked.runId}, which still has required steps open: ${linked.open.join(' → ')}. Finish them (or resolve a deviation) before requesting review.`,
    })
  }
  const approval = await db.createApproval({
    worklogId: wl.id,
    requestedBy: actor(req),
    approver: String(req.body?.approver ?? 'lee'),
  })
  await db.setWorklogStatus(wl.id, 'submitted')
  res.json(approval)
})

// Persist the verified measurements that passed a decision's criteria.
app.post('/api/worklogs/:id/verification', auth, async (req, res) => {
  const m = req.body?.measurements
  if (!m || typeof m !== 'object') return res.status(400).json({ error: 'measurements object is required' })
  {
    const all = await db.listWorklogs()
    const row = all.find((w) => w.id === req.params.id)
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
})

// Attach a corrective action to an EXISTING incident (instead of creating a new one).
app.post('/api/worklogs/:id/corrective', auth, async (req, res) => {
  const b = req.body ?? {}
  if (!b.actionTaken) return res.status(400).json({ error: 'actionTaken is required' })
  {
    const all = await db.listWorklogs()
    const row = all.find((w) => w.id === req.params.id)
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
})

app.post('/api/approvals/:id/decide', auth, async (req, res) => {
  const decision = String(req.body?.decision ?? '')
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' })
  }
  const existing = await db.getApproval(req.params.id)
  if (!existing) return res.status(404).json({ error: 'approval not found' })
  if (existing.status !== 'PENDING') return res.status(400).json({ error: `approval is already ${existing.status}` })
  if (decision === 'APPROVED') {
    const wlAll = await db.listWorklogs()
    const wlRow = wlAll.find((w) => w.id === existing.worklogId)
    const linked = await openRunStepsFor(existing.worklogId, wlRow?.data?.runId)
    if (linked && linked.open.length > 0) {
      return res.status(409).json({
        error: 'process_incomplete',
        detail: `Playbook run #${linked.runId} behind this entry still has required steps open: ${linked.open.join(' → ')}. Approving now would sign off unfinished work.`,
      })
    }
  }
  const decided = await db.decideApproval(existing.id, decision, req.body?.comment)
  await db.setWorklogStatus(existing.worklogId, decision === 'APPROVED' ? 'approved' : 'rejected')
  res.json(decided)
})

app.get('/api/processes', auth, async (_req, res) => {
  res.json(await db.listProcesses())
})

app.post('/api/processes', auth, async (req, res) => {
  const { title, map } = req.body ?? {}
  if (!title || !map?.steps?.length) return res.status(400).json({ error: 'title and map.steps are required' })
  res.json(await db.saveProcess({ title: String(title), map, createdBy: actor(req) }))
})

app.get('/api/processes/:id', auth, async (req, res) => {
  const row = await db.getProcess(req.params.id)
  if (!row) return res.status(404).json({ error: 'process not found' })
  res.json(row)
})

app.delete('/api/processes/:id', auth, async (req, res) => {
  const ok = await db.deleteProcess(req.params.id)
  if (!ok) return res.status(404).json({ error: 'process not found' })
  res.json({ ok: true })
})

/* Process runs: one row per execution of a playbook, updated as steps progress. */

app.post('/api/runs', auth, async (req, res) => {
  const { processId, title, steps } = req.body ?? {}
  if (!processId || !title) return res.status(400).json({ error: 'processId and title are required' })
  const run = await db.startRun({
    processId: String(processId),
    title: String(title),
    startedBy: actor(req),
    steps: Array.isArray(steps) ? steps : [],
  })
  res.json(run)
})

app.post('/api/runs/:id', auth, async (req, res) => {
  const b = req.body ?? {}
  const run = await db.updateRun(req.params.id, {
    steps: Array.isArray(b.steps) ? b.steps : undefined,
    decisions: Array.isArray(b.decisions) ? b.decisions : undefined,
    status: typeof b.status === 'string' ? b.status : undefined,
    deviations: typeof b.deviations === 'number' ? b.deviations : undefined,
  })
  if (!run) return res.status(404).json({ error: 'run not found' })
  res.json(run)
})

app.get('/api/runs', auth, async (req, res) => {
  res.json(await db.listRuns(req.query.processId ? String(req.query.processId) : undefined))
})

// Demo housekeeping: clear worklogs+approvals ('worklogs') or everything ('all').
app.post('/api/admin/reset', auth, async (req, res) => {
  const scope = req.body?.scope === 'all' ? 'all' : 'worklogs'
  await db.resetData(scope)
  res.json({ ok: true, scope })
})

/* ---------------- static ---------------- */

const dist = path.join(__dirname, '..', 'dist')
app.use(express.static(dist))
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))

app.listen(PORT, () => console.log(`[server] listening on :${PORT} (db: ${db.kind})`))
