// Storage layer: Postgres when DATABASE_URL is set (Railway), in-memory otherwise (local dev).
import crypto from 'node:crypto'

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex')
}

const SEED_USERS = [
  { username: 'kim', name: 'Kim', role: 'Contributor', password: 'linepulse' },
  { username: 'lee', name: 'Lee', role: 'Reviewer', password: 'linepulse' },
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
    async mergeWorklogData(id, patch) {
      const w = worklogs.find((x) => x.id === id)
      if (!w) return null
      w.data = { ...(w.data ?? {}), ...patch }
      return w
    },
    async createApproval(a) {
      const row = { id: String(seq++), ...a, status: 'PENDING', ts: Date.now() }
      approvals.unshift(row)
      return row
    },
    async listApprovals() {
      return approvals
    },
    async getApproval(id) {
      return approvals.find((a) => a.id === id) ?? null
    },
    async decideApproval(id, status, comment) {
      const a = approvals.find((x) => x.id === id)
      if (!a) return null
      a.status = status
      a.comment = comment
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
        startedAt: Date.now(), updatedAt: Date.now(), status: 'active', steps: r.steps ?? [], decisions: [], deviations: 0,
      }
      runs.unshift(row)
      return row
    },
    async updateRun(id, patch) {
      const run = runs.find((x) => x.id === id)
      if (!run) return null
      if (patch.steps) run.steps = patch.steps
      if (patch.decisions) run.decisions = patch.decisions
      if (patch.status) run.status = patch.status
      if (patch.deviations !== undefined) run.deviations = patch.deviations
      run.updatedAt = Date.now()
      return run
    },
    async listRuns(processId) {
      return runs.filter((r) => !processId || r.processId === processId)
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
  `)

  // Keep display roles in sync with the current neutral naming (idempotent).
  await pool.query(`UPDATE users SET role='Contributor' WHERE username='kim' AND role<>'Contributor'`)
  await pool.query(`UPDATE users SET role='Reviewer' WHERE username='lee' AND role<>'Reviewer'`)
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users')
  if (rows[0].n === 0) {
    for (const u of seedRows()) {
      await pool.query(
        'INSERT INTO users (username, name, role, pass_hash, salt) VALUES ($1,$2,$3,$4,$5)',
        [u.username, u.name, u.role, u.passHash, u.salt],
      )
    }
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
    ts: new Date(r.ts).getTime(),
  })

  return {
    kind: 'postgres',
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
      const { rows } = await pool.query(
        `INSERT INTO worklogs (date, line, task, progress_pct, hours, note, urgent, created_by, kind, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [w.date, w.line, w.task, w.progressPct, w.hours, w.note, w.urgent, w.createdBy,
         w.kind ?? 'routine', JSON.stringify(w.data ?? {})],
      )
      return wl(rows[0])
    },
    async listWorklogs() {
      const { rows } = await pool.query('SELECT * FROM worklogs ORDER BY id DESC LIMIT 200')
      return rows.map(wl)
    },
    async setWorklogStatus(id, status) {
      const { rows } = await pool.query('UPDATE worklogs SET status=$2 WHERE id=$1 RETURNING *', [id, status])
      return rows[0] ? wl(rows[0]) : null
    },
    async mergeWorklogData(id, patch) {
      const { rows } = await pool.query(
        `UPDATE worklogs SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb WHERE id=$1 RETURNING *`,
        [id, JSON.stringify(patch)],
      )
      return rows[0] ? wl(rows[0]) : null
    },
    async createApproval(a) {
      const { rows } = await pool.query(
        `INSERT INTO approvals (worklog_id, requested_by, approver) VALUES ($1,$2,$3) RETURNING *`,
        [a.worklogId, a.requestedBy, a.approver],
      )
      return ap(rows[0])
    },
    async listApprovals() {
      const { rows } = await pool.query('SELECT * FROM approvals ORDER BY id DESC LIMIT 200')
      return rows.map(ap)
    },
    async getApproval(id) {
      const { rows } = await pool.query('SELECT * FROM approvals WHERE id=$1', [id])
      return rows[0] ? ap(rows[0]) : null
    },
    async decideApproval(id, status, comment) {
      const { rows } = await pool.query(
        'UPDATE approvals SET status=$2, comment=$3 WHERE id=$1 RETURNING *',
        [id, status, comment ?? null],
      )
      return rows[0] ? ap(rows[0]) : null
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
      const { rows } = await pool.query(
        `UPDATE process_runs SET
           steps = COALESCE($2, steps),
           status = COALESCE($3, status),
           deviations = COALESCE($4, deviations),
           decisions = COALESCE($5, decisions),
           updated_at = now()
         WHERE id=$1 RETURNING *`,
        [id, patch.steps ? JSON.stringify(patch.steps) : null, patch.status ?? null, patch.deviations ?? null, patch.decisions ? JSON.stringify(patch.decisions) : null],
      )
      return rows[0] ? runRow(rows[0]) : null
    },
    async listRuns(processId) {
      const { rows } = await pool.query(
        processId
          ? `SELECT * FROM process_runs WHERE process_id=$1 ORDER BY id DESC LIMIT 50`
          : `SELECT * FROM process_runs ORDER BY id DESC LIMIT 50`,
        processId ? [Number(processId)] : [],
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
