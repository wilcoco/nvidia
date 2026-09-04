// Storage layer: Postgres when DATABASE_URL is set (Railway), in-memory otherwise (local dev).
import crypto from 'node:crypto'
import { applySignoff, preserveSignoffs, reviewFingerprint, matchesReviewFingerprint, evidencePatch, reviewEvidence, approvalGate, mergeRunEvents, guardRunUpdate } from './runstate.js'
import { enforceRunUpdate } from './enforcement.js'

function requestScope(run, map, stepId) {
  const gate = approvalGate(run, map, stepId, true)
  if (gate.open.length) throw Object.assign(new Error(`process_incomplete: ${gate.open.join(' → ')}`), {status: 409})
  return {stepId: gate.stepId, scope: gate.scope}
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex')
}

const SEED_USERS = [
  { username: 'kim', name: 'Kim', role: 'Contributor', password: 'linepulse' },
  { username: 'lee', name: 'Lee', role: 'Reviewer', password: 'linepulse' },
  { username: 'park', name: 'Park', role: 'Operations', password: 'linepulse' },
  { username: 'judge', name: 'Judge', role: 'Guest reviewer', password: 'webmcp2026' },
]

function seedRows() {
  return SEED_USERS.map((u) => {
    const salt = crypto.randomBytes(8).toString('hex')
    return { ...u, salt, passHash: hashPassword(u.password, salt) }
  })
}

export function verifyPassword(user, password) {
  return (
    user &&
    crypto.timingSafeEqual(
      Buffer.from(user.passHash, 'hex'),
      Buffer.from(hashPassword(password, user.salt), 'hex'),
    )
  )
}

/* ---------------- in-memory backend (no DATABASE_URL) ---------------- */

function memoryBackend() {
  const users = seedRows()
  let seq = 1
  const worklogs = []
  const approvals = []
  const processes = []
  const runs = []
  const secret = crypto.randomBytes(16).toString('hex')

  return {
    kind: 'memory',
    async close() {},
    async getSessionSecret() {
      return secret
    },
    async getUser(username) {
      return users.find((u) => u.username === username) ?? null
    },
    async listUsers() {
      return users.map(({ username, name, role }) => ({ username, name, role }))
    },
    async createWorklog(w) {
      if (w.data?.systemGenerated && w.data?.runId != null) {
        const existing = worklogs.find(row => row.data?.systemGenerated &&
          String(row.data.runId) === String(w.data.runId) && (row.data.approvalStepId ?? '') === (w.data.approvalStepId ?? ''))
        if (existing) return existing
      }
      const row = { id: String(seq++), ...w, status: 'draft' }
      worklogs.unshift(row)
      return row
    },
    async listWorklogs() {
      return worklogs
    },
    async setWorklogStatus(id, status) {
      const w = worklogs.find((x) => x.id === id)
      if (w) w.status = status
      return w ?? null
    },
    async saveDiscoveryAnswer(id, answer, createdBy) {
      const w = worklogs.find(x => x.id === id)
      if (!w || w.createdBy !== createdBy || w.status !== 'draft' || w.data?.runId != null || w.data?.systemGenerated) return null
      w.data = {...w.data, discovery: {before: answer}}
      return w
    },
    async mergeWorklogData(id, patch) {
      const w = worklogs.find((x) => x.id === id)
      if (!w) return null
      if (w.status === 'approved') throw Object.assign(new Error('approved_immutable'), { status: 409 })
      w.data = { ...(w.data ?? {}), ...patch }
      return w
    },
    async createApproval(a) {
      const w = worklogs.find((x) => x.id === a.worklogId)
      if (!w || !['draft', 'rejected'].includes(w.status) ||
          approvals.some((x) => x.worklogId === a.worklogId && x.status === 'PENDING')) return null
      const linked = runs.find((r) => r.id === String(w.data?.runId))
      const design = processes.find(p => p.id === linked?.processId)?.map
      const context = w.data?.runId != null ? requestScope(linked, design, a.stepId ?? w.data.approvalStepId) : {}
      const row = { id: String(seq++), ...a, ...context, status: 'PENDING', ts: Date.now(),
        reviewFingerprint: reviewFingerprint(linked, context.scope), evidence: reviewEvidence(linked, design, context.scope, w.data) }
      approvals.unshift(row)
      w.status = 'submitted'
      return row
    },
    async getWorklog(id) {
      return worklogs.find((w) => w.id === id) ?? null
    },
    async listApprovals() {
      return approvals
    },
    async getApproval(id) {
      return approvals.find((a) => a.id === id) ?? null
    },
    async decideApproval(id, status, comment, authority) {
      const a = approvals.find((x) => x.id === id)
      if (!a) return null
      if (a.status !== 'PENDING') return null
      const subject = worklogs.find((x) => x.id === a.worklogId)
      const linked = runs.find((r) => r.id === String(subject?.data?.runId))
      if (status === 'APPROVED' && subject?.data?.runId != null &&
          (!a.evidence || !matchesReviewFingerprint(a.reviewFingerprint, linked, a.scope) ||
            approvalGate(linked, processes.find(p => p.id === linked?.processId)?.map, a.stepId).open.length)) return null
      a.status = status
      a.comment = comment
      if (['APPROVED', 'REJECTED'].includes(status)) a.decidedBySession = authority?.authenticatedAs
      const w = worklogs.find((x) => x.id === a.worklogId)
      if (w && ['APPROVED', 'REJECTED'].includes(status)) {
        w.status = status === 'APPROVED' ? 'approved' : 'rejected'
        const run = runs.find((r) => r.id === String(w.data?.runId))
        const patch = status === 'APPROVED' ? applySignoff(run, a) : null
        if (patch) Object.assign(run, patch, { updatedAt: Date.now() })
      }
      return a
    },
    async saveProcess(p) {
      const row = { id: String(seq++), ...p, createdAt: Date.now() }
      processes.unshift(row)
      return row
    },
    async listProcesses() {
      return processes.map((p) => ({
        id: p.id,
        title: p.title,
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        appliesWhen: p.map?.appliesWhen,
        priorityWhen: p.map?.priorityWhen,
        version: p.map?.version ?? 1,
        sourceProcessId: p.map?.sourceProcessId,
      }))
    },
    async getProcess(id) {
      return processes.find((p) => p.id === id) ?? null
    },
    async deleteProcess(id) {
      const i = processes.findIndex((p) => p.id === id)
      if (i < 0) return false
      processes.splice(i, 1)
      return true
    },
    async resetData(scope) {
      worklogs.length = 0
      approvals.length = 0
      runs.length = 0
      if (scope === 'all') processes.length = 0
      return true
    },
    async startRun(r) {
      const row = {
        id: String(seq++), processId: r.processId, title: r.title, startedBy: r.startedBy,
        startedAt: Date.now(), updatedAt: Date.now(), status: 'active', steps: r.steps ?? [], decisions: [], events: [], deviations: 0,
      }
      runs.unshift(row)
      return row
    },
    async updateRun(id, patch) {
      const run = runs.find((x) => x.id === id)
      if (!run) return null
      const process = processes.find(p => p.id === run.processId)
      patch = enforceRunUpdate(run, patch, process?.map, patch._authority)
      delete patch._authority
      patch = preserveSignoffs(run, patch)
      if (!guardRunUpdate(run, patch, process?.map)) return run
      if (patch.steps) run.steps = patch.steps
      if (patch.decisions) run.decisions = patch.decisions
      if (patch.events) run.events = mergeRunEvents(run.events, patch.events)
      if (patch.status) run.status = patch.status
      if (patch.deviations !== undefined) run.deviations = patch.deviations
      run.updatedAt = Date.now()
      for (const a of approvals) {
        const w = worklogs.find((x) => x.id === a.worklogId)
        if (a.status === 'PENDING' && String(w?.data?.runId) === run.id &&
            !matchesReviewFingerprint(a.reviewFingerprint, run, a.scope)) {
          a.status = 'CANCELLED'
          a.comment = 'Evidence changed; a new review is required.'
          if (w) {
            w.status = 'draft'
          }
        }
      }
      for (const w of worklogs) {
        if (String(w.data?.runId) === run.id && w.status === 'draft' && w.data.systemGenerated) {
          w.data = { runId: run.id, systemGenerated: true, approvalStepId: w.data.approvalStepId, ...evidencePatch(run) }
        }
      }
      return run
    },
    async listRuns(processId, {before, limit = 50} = {}) {
      return runs.filter((r) => (!processId || r.processId === processId) && (!before || Number(r.id) < Number(before)))
        .sort((a,b) => Number(b.id) - Number(a.id)).slice(0, limit)
    },
    async getRun(id) { return runs.find((r) => r.id === String(id)) ?? null },
    async findRunForWorklog(id) {
      return runs.find((r) => r.steps.some((s) => s.resultId === id && s.action === 'log_work_item')) ?? null
    },
  }
}

/* ---------------- Postgres backend (Railway) ---------------- */

async function pgBackend(databaseUrl) {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : undefined,
  })
  async function transaction(fn) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const value = await fn(client)
      await client.query('COMMIT')
      return value
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally { client.release() }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
      pass_hash TEXT NOT NULL, salt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worklogs (
      id SERIAL PRIMARY KEY, date TEXT NOT NULL, line TEXT NOT NULL, task TEXT NOT NULL,
      progress_pct INT NOT NULL, hours REAL NOT NULL, note TEXT DEFAULT '',
      urgent BOOLEAN DEFAULT FALSE, status TEXT DEFAULT 'draft', created_by TEXT NOT NULL
    );
    ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'routine';
    ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}';
    CREATE TABLE IF NOT EXISTS approvals (
      id SERIAL PRIMARY KEY, worklog_id INT NOT NULL, requested_by TEXT NOT NULL,
      approver TEXT NOT NULL, status TEXT DEFAULT 'PENDING', comment TEXT,
      ts TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS processes (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, map JSONB NOT NULL,
      created_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS process_runs (
      id SERIAL PRIMARY KEY,
      process_id INT NOT NULL,
      title TEXT NOT NULL,
      started_by TEXT NOT NULL,
      started_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      status TEXT DEFAULT 'active',
      steps JSONB NOT NULL DEFAULT '[]',
      deviations INT DEFAULT 0
    );
    ALTER TABLE process_runs ADD COLUMN IF NOT EXISTS decisions JSONB DEFAULT '[]';
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS review_fingerprint TEXT;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS step_id TEXT;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS review_scope JSONB;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS review_evidence JSONB;
    ALTER TABLE approvals ADD COLUMN IF NOT EXISTS decided_by_session TEXT;
    ALTER TABLE process_runs ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]';
  `)

  // Keep display roles in sync with the current neutral naming (idempotent).
  await pool.query(`UPDATE users SET role='Contributor' WHERE username='kim' AND role<>'Contributor'`)
  await pool.query(`UPDATE users SET role='Reviewer' WHERE username='lee' AND role<>'Reviewer'`)
  // Every default account is seeded individually — a partial users table
  // (e.g. one row inserted first) must not suppress the rest.
  for (const u of seedRows()) {
    await pool.query('INSERT INTO users (username, name, role, pass_hash, salt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
      u.username,
      u.name,
      u.role,
      u.passHash,
      u.salt,
    ])
  }

  const wl = (r) => ({
    id: String(r.id), date: r.date, line: r.line, task: r.task,
    progressPct: r.progress_pct, hours: r.hours, note: r.note,
    urgent: r.urgent, status: r.status, createdBy: r.created_by,
    kind: r.kind ?? 'routine', data: r.data ?? {},
  })
  const ap = (r) => ({
    id: String(r.id), worklogId: String(r.worklog_id), requestedBy: r.requested_by,
    approver: r.approver, status: r.status, comment: r.comment ?? undefined,
    stepId: r.step_id ?? undefined, scope: r.review_scope ?? undefined,
    evidence: r.review_evidence ?? undefined,
    decidedBySession: r.decided_by_session ?? undefined,
    ts: new Date(r.ts).getTime(),
  })

  return {
    kind: 'postgres',
    close: () => pool.end(),
    // Session secret persists in the DB so logins survive redeploys/restarts.
    async getSessionSecret() {
      await pool.query(
        `INSERT INTO app_config (key, value) VALUES ('session_secret', $1) ON CONFLICT (key) DO NOTHING`,
        [crypto.randomBytes(16).toString('hex')],
      )
      const { rows } = await pool.query(`SELECT value FROM app_config WHERE key='session_secret'`)
      return rows[0].value
    },
    async getUser(username) {
      const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username])
      const r = rows[0]
      return r ? { username: r.username, name: r.name, role: r.role, passHash: r.pass_hash, salt: r.salt } : null
    },
    async listUsers() {
      const { rows } = await pool.query('SELECT username, name, role FROM users ORDER BY username')
      return rows
    },
    async createWorklog(w) {
      return transaction(async (client) => {
      if (w.data?.systemGenerated && w.data?.runId != null) {
        // Serialize retrying creators by the immutable run. This also covers a
        // response lost after commit, without requiring a schema migration.
        await client.query('SELECT id FROM process_runs WHERE id::text=$1 FOR UPDATE', [String(w.data.runId)])
        const existing = await client.query(`SELECT * FROM worklogs WHERE data->>'systemGenerated'='true'
          AND data->>'runId'=$1 AND COALESCE(data->>'approvalStepId','')=$2 ORDER BY id LIMIT 1`,
          [String(w.data.runId), String(w.data.approvalStepId ?? '')])
        if (existing.rows[0]) return wl(existing.rows[0])
      }
      const { rows } = await client.query(
        `INSERT INTO worklogs (date, line, task, progress_pct, hours, note, urgent, created_by, kind, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [w.date, w.line, w.task, w.progressPct, w.hours, w.note, w.urgent, w.createdBy,
         w.kind ?? 'routine', JSON.stringify(w.data ?? {})],
      )
      return wl(rows[0])
      })
    },
    async listWorklogs() {
      const { rows } = await pool.query('SELECT * FROM worklogs ORDER BY id DESC LIMIT 200')
      return rows.map(wl)
    },
    async setWorklogStatus(id, status) {
      const { rows } = await pool.query('UPDATE worklogs SET status=$2 WHERE id=$1 RETURNING *', [id, status])
      return rows[0] ? wl(rows[0]) : null
    },
    async saveDiscoveryAnswer(id, answer, createdBy) {
      const {rows} = await pool.query(
        `UPDATE worklogs SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('discovery', $2::jsonb)
         WHERE id=$1 AND created_by=$3 AND status='draft' AND data->>'runId' IS NULL
         AND COALESCE(data->>'systemGenerated', 'false')='false' RETURNING *`,
        [id, JSON.stringify({before: answer}), createdBy],
      )
      return rows[0] ? wl(rows[0]) : null
    },
    async mergeWorklogData(id, patch) {
      const { rows } = await pool.query(
        `UPDATE worklogs SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb WHERE id=$1 AND status <> 'approved' RETURNING *`,
        [id, JSON.stringify(patch)],
      )
      if (rows[0]) return wl(rows[0])
      const existing = await pool.query('SELECT status FROM worklogs WHERE id=$1', [id])
      if (existing.rows[0]?.status === 'approved') throw Object.assign(new Error('approved_immutable'), { status: 409 })
      return null
    },
    async createApproval(a) {
      return transaction(async (client) => {
        // Lock the run first, like updateRun/decideApproval. Evidence and its
        // fingerprint must come from one snapshot, after pending writes finish.
        const before = await client.query('SELECT data FROM worklogs WHERE id=$1', [a.worklogId])
        const runId = before.rows[0]?.data?.runId
        const linked = runId != null ? await client.query('SELECT * FROM process_runs WHERE id::text=$1 FOR UPDATE', [String(runId)]) : {rows: []}
        const run = linked.rows[0] && runRow(linked.rows[0])
        const { rows: work } = await client.query('SELECT status,data FROM worklogs WHERE id=$1 FOR UPDATE', [a.worklogId])
        if (!work[0] || !['draft', 'rejected'].includes(work[0].status) || String(work[0].data?.runId) !== String(runId)) return null
        const pending = await client.query("SELECT 1 FROM approvals WHERE worklog_id=$1 AND status='PENDING'", [a.worklogId])
        if (pending.rows.length) return null
        const process = run ? await client.query('SELECT map FROM processes WHERE id=$1', [run.processId]) : {rows: []}
        const design = process.rows[0]?.map
        const context = runId != null ? requestScope(run, design, a.stepId ?? work[0].data.approvalStepId) : {}
        const { rows } = await client.query(
          'INSERT INTO approvals (worklog_id, requested_by, approver, review_fingerprint, step_id, review_scope, review_evidence) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [a.worklogId, a.requestedBy, a.approver, reviewFingerprint(run, context.scope), context.stepId ?? null,
            context.scope ? JSON.stringify(context.scope) : null, JSON.stringify(reviewEvidence(run, design, context.scope, work[0].data))],
        )
        await client.query("UPDATE worklogs SET status='submitted' WHERE id=$1", [a.worklogId])
        return ap(rows[0])
      })
    },
    async getWorklog(id) {
      const { rows } = await pool.query('SELECT * FROM worklogs WHERE id=$1', [Number(id)])
      return rows[0] ? wl(rows[0]) : null
    },
    async listApprovals() {
      const { rows } = await pool.query('SELECT * FROM approvals ORDER BY id DESC LIMIT 200')
      return rows.map(ap)
    },
    async getApproval(id) {
      const { rows } = await pool.query('SELECT * FROM approvals WHERE id=$1', [id])
      return rows[0] ? ap(rows[0]) : null
    },
    async decideApproval(id, status, comment, authority) {
      return transaction(async (client) => {
        const before = await client.query('SELECT a.review_fingerprint,a.review_scope,a.review_evidence,a.step_id,w.data FROM approvals a JOIN worklogs w ON w.id=a.worklog_id WHERE a.id=$1', [id])
        const linkedId = before.rows[0]?.data?.runId
        if (status === 'APPROVED' && linkedId != null) {
          // Legacy pending reviews have no evidence snapshot; require a fresh review.
          if (!before.rows[0].review_fingerprint || !before.rows[0].review_evidence) return null
          const linked = await client.query('SELECT * FROM process_runs WHERE id::text=$1 FOR UPDATE', [String(linkedId ?? '')])
          const run = linked.rows[0] && runRow(linked.rows[0])
          const process = run ? await client.query('SELECT map FROM processes WHERE id=$1', [run.processId]) : {rows: []}
          if (!matchesReviewFingerprint(before.rows[0].review_fingerprint, run, before.rows[0].review_scope) ||
              approvalGate(run, process.rows[0]?.map, before.rows[0].step_id).open.length) return null
        }
        const { rows } = await client.query(
          "UPDATE approvals SET status=$2, comment=$3, decided_by_session=$4 WHERE id=$1 AND status='PENDING' RETURNING *",
          [id, status, comment ?? null, ['APPROVED', 'REJECTED'].includes(status) ? authority?.authenticatedAs ?? null : null],
        )
        if (!rows[0]) return null
        const approval = ap(rows[0])
        if (['APPROVED', 'REJECTED'].includes(status)) {
          const { rows: work } = await client.query('UPDATE worklogs SET status=$2 WHERE id=$1 RETURNING data',
            [approval.worklogId, status === 'APPROVED' ? 'approved' : 'rejected'])
          const linkedId = work[0]?.data?.runId
          if (status === 'APPROVED' && linkedId != null) {
            const { rows: linked } = await client.query('SELECT * FROM process_runs WHERE id::text=$1 FOR UPDATE', [String(linkedId)])
            const patch = linked[0] && applySignoff(runRow(linked[0]), approval)
            if (patch) await client.query('UPDATE process_runs SET steps=$2,status=$3,events=$4,updated_at=now() WHERE id=$1',
              [linked[0].id, JSON.stringify(patch.steps), patch.status, JSON.stringify(patch.events)])
          }
        }
        return approval
      })
    },
    async saveProcess(p) {
      const { rows } = await pool.query(
        'INSERT INTO processes (title, map, created_by) VALUES ($1,$2,$3) RETURNING id, title, created_by, created_at',
        [p.title, JSON.stringify(p.map), p.createdBy],
      )
      const r = rows[0]
      return { id: String(r.id), title: r.title, createdBy: r.created_by, createdAt: new Date(r.created_at).getTime() }
    },
    async listProcesses() {
      const { rows } = await pool.query(
        `SELECT id, title, created_by, created_at,
                map->'appliesWhen' AS applies_when, map->'priorityWhen' AS priority_when,
                COALESCE((map->>'version')::int, 1) AS version,
                map->>'sourceProcessId' AS source_process_id
         FROM processes ORDER BY id DESC LIMIT 100`,
      )
      return rows.map((r) => ({
        id: String(r.id), title: r.title, createdBy: r.created_by, createdAt: new Date(r.created_at).getTime(),
        appliesWhen: r.applies_when ?? undefined, priorityWhen: r.priority_when ?? undefined,
        version: r.version ?? 1,
        sourceProcessId: r.source_process_id ?? undefined,
      }))
    },
    async getProcess(id) {
      const { rows } = await pool.query('SELECT * FROM processes WHERE id=$1', [id])
      const r = rows[0]
      return r
        ? { id: String(r.id), title: r.title, map: r.map, createdBy: r.created_by, createdAt: new Date(r.created_at).getTime() }
        : null
    },
    async deleteProcess(id) {
      const { rowCount } = await pool.query('DELETE FROM processes WHERE id=$1', [id])
      return rowCount > 0
    },
    async resetData(scope) {
      await pool.query('TRUNCATE worklogs, approvals, process_runs RESTART IDENTITY')
      if (scope === 'all') await pool.query('TRUNCATE processes RESTART IDENTITY')
      return true
    },
    async startRun(r) {
      const { rows } = await pool.query(
        `INSERT INTO process_runs (process_id, title, started_by, steps) VALUES ($1,$2,$3,$4) RETURNING *`,
        [Number(r.processId), r.title, r.startedBy, JSON.stringify(r.steps ?? [])],
      )
      return runRow(rows[0])
    },
    async updateRun(id, patch) {
      return transaction(async (client) => {
        const current = await client.query('SELECT * FROM process_runs WHERE id=$1 FOR UPDATE', [id])
        if (!current.rows[0]) return null
        const run = runRow(current.rows[0])
        const process = await client.query('SELECT map FROM processes WHERE id=$1', [run.processId])
        patch = enforceRunUpdate(run, patch, process.rows[0]?.map, patch._authority)
        delete patch._authority
        patch = preserveSignoffs(run, patch)
        if (!guardRunUpdate(run, patch, process.rows[0]?.map)) return run
        const { rows } = await client.query(
          `UPDATE process_runs SET
             steps = COALESCE($2, steps),
             status = COALESCE($3, status),
             deviations = COALESCE($4, deviations),
             decisions = COALESCE($5, decisions),
             events = $6,
             updated_at = now()
           WHERE id=$1 RETURNING *`,
          [id, patch.steps ? JSON.stringify(patch.steps) : null, patch.status ?? null,
           patch.deviations ?? null, patch.decisions ? JSON.stringify(patch.decisions) : null,
           JSON.stringify(mergeRunEvents(current.rows[0].events ?? [], patch.events ?? []))],
        )
        const updated = runRow(rows[0])
        const pending = await client.query(`SELECT a.* FROM approvals a JOIN worklogs w ON a.worklog_id=w.id
          WHERE w.data->>'runId'=$1 AND a.status='PENDING'`, [String(id)])
        for (const row of pending.rows) {
          if (matchesReviewFingerprint(row.review_fingerprint, updated, row.review_scope)) continue
          await client.query("UPDATE approvals SET status='CANCELLED',comment='Evidence changed; a new review is required.' WHERE id=$1 AND status='PENDING'", [row.id])
          await client.query("UPDATE worklogs SET status='draft' WHERE id=$1 AND status<>'approved'", [row.worklog_id])
        }
        await client.query(`UPDATE worklogs SET data=jsonb_build_object('runId',data->'runId','systemGenerated',true,'approvalStepId',data->'approvalStepId') || $2::jsonb
          WHERE data->>'runId'=$1 AND data->>'systemGenerated'='true' AND status='draft'`,
          [String(id), JSON.stringify(evidencePatch(updated))])
        return updated
      })
    },
    async getRun(id) {
      const { rows } = await pool.query('SELECT * FROM process_runs WHERE id::text=$1', [String(id)])
      return rows[0] ? runRow(rows[0]) : null
    },
    async findRunForWorklog(id) {
      const { rows } = await pool.query('SELECT * FROM process_runs WHERE steps @> $1::jsonb ORDER BY id DESC LIMIT 1',
        [JSON.stringify([{ action: 'log_work_item', resultId: id }])])
      return rows[0] ? runRow(rows[0]) : null
    },
    async listRuns(processId, {before, limit = 50} = {}) {
      const { rows } = await pool.query(
        `SELECT * FROM process_runs WHERE ($1::int IS NULL OR process_id=$1) AND ($2::int IS NULL OR id<$2) ORDER BY id DESC LIMIT $3`,
        [processId ? Number(processId) : null, before ? Number(before) : null, limit],
      )
      return rows.map(runRow)
    },
  }
}

function runRow(r) {
  return {
    id: String(r.id),
    processId: String(r.process_id),
    title: r.title,
    startedBy: r.started_by,
    startedAt: new Date(r.started_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    status: r.status,
    steps: r.steps ?? [],
    decisions: r.decisions ?? [],
    events: r.events ?? [],
    deviations: r.deviations ?? 0,
  }
}

export async function createDb() {
  const url = process.env.DATABASE_URL
  if (url) {
    const db = await pgBackend(url)
    console.log('[db] using Postgres')
    return db
  }
  console.log('[db] DATABASE_URL not set — using in-memory store (dev mode)')
  return memoryBackend()
}
