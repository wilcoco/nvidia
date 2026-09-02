import { useEffect, useState, useSyncExternalStore } from 'react'
import * as store from './store'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const WORK_CATEGORIES = [
  'routine work',
  'planning',
  'development',
  'design',
  'operations',
  'review',
  'incident',
]

function Login() {
  // Pre-filled with the reviewer account so judges can sign in with one click.
  const [username, setUsername] = useState('judge')
  const [password, setPassword] = useState('webmcp2026')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await store.login(username.trim().toLowerCase(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <h1>
          🎭 Understudy{' '}
          <span className="sub">turn work into living playbooks</span>
        </h1>
        <p className="hint">
          Demo accounts — <code>kim</code> / <code>linepulse</code> (line worker),{' '}
          <code>lee</code> / <code>linepulse</code> (team lead), <code>judge</code> /{' '}
          <code>webmcp2026</code> (reviewer)
        </p>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function SuggestionCard() {
  const matches = store.computeMatches().filter((m) => m.tier === 'strong').slice(0, 2)
  const [followedId, setFollowedId] = useState<string | null>(null)
  if (matches.length === 0) return null
  return (
    <div className="card suggestion">
      <div className="entry-head">
        <span className="task">
          📋 {matches.length > 1 ? `${matches.length} related playbooks found — pick one` : 'Related playbook found'}
        </span>
      </div>
      {matches.map((m) => (
        <div key={m.processId} className="suggestion-item">
          <div className="entry-head">
            <span className="suggestion-title">
              {m.title} <span className="version-tag">v{m.version}</span>
            </span>
            <span className="confidence">{Math.round(m.confidence * 100)}% match</span>
          </div>
          <div className="meta">Matched because: {m.reasons.join(' · ')}</div>
          <div className="decide">
            <button
              className="primary"
              onClick={() => {
                void store.followPlaybook(m.processId).then(() => {
                  setFollowedId(m.processId)
                  setTimeout(() => setFollowedId(null), 2500)
                })
              }}
            >
              {followedId === m.processId ? '✓ Loaded — see the panel →' : 'Follow this playbook'}
            </button>
            <button
              className="ghost"
              data-flow-ignore
              onClick={() => store.dismissSuggestion(m.processId, 'not relevant to this incident')}
            >
              Not relevant
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function IncidentForm() {
  const [date, setDate] = useState(today())
  const [line, setLine] = useState('A')
  const [kind, setKind] = useState('routine work')
  const [task, setTask] = useState('')
  const [hours, setHours] = useState(0.5)
  const [urgent, setUrgent] = useState(false)
  // The loaded playbook's data contract (defined via interview) renders as a
  // dynamic section of this form.
  const [playbookFields, setPlaybookFields] = useState<UnderstudyFieldDef[]>([])
  const [playbookTitle, setPlaybookTitle] = useState('')
  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean>>({})

  useEffect(() => {
    const read = () => {
      const m = window.Understudy.getLoadedProcess?.()
      setPlaybookFields(m?.fields?.length ? m.fields : [])
      setPlaybookTitle(m?.fields?.length ? m.title : '')
    }
    read()
    window.addEventListener('understudy:mapchange', read)
    return () => window.removeEventListener('understudy:mapchange', read)
  }, [])

  // Keep the live draft context in the store so playbook matching (and the
  // agent, via find_relevant_processes) sees what is being entered right now.
  useEffect(() => {
    store.setDraftContext({
      kind,
      urgent,
      task,
      hasInput: task.trim().length > 0 || urgent || kind !== 'routine work',
    })
  }, [kind, urgent, task])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!task.trim()) return
    await store.createWorklog({
      date,
      line,
      task: task.trim(),
      hours,
      note: '',
      urgent,
      kind,
      data: {
        ...Object.fromEntries(
          playbookFields
            .map((f) => {
              const v = fieldValues[f.key]
              if (f.type === 'boolean') return [f.key, Boolean(v)]
              if (v === undefined || v === '') return [f.key, undefined]
              return [f.key, f.type === 'number' ? Number(v) : String(v)]
            })
            .filter(([, v]) => v !== undefined),
        ),
      },
    })
    setFieldValues({})
    setTask('')
    setUrgent(false)
  }

  return (
    <form className="card form" onSubmit={submit} data-flow-label="incident report">
      <h3>Write a work log</h3>
      <div className="grid">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Area
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option>A</option>
            <option>B</option>
          </select>
        </label>
        <label className="wide">
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {WORK_CATEGORIES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="wide wide4">
          What happened
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="e.g. Completed the release checklist review and follow-ups"
          />
        </label>
        <label>
          Hours
          <input type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </label>
        {playbookFields.length > 0 && (
          <div className="wide wide4 playbook-fields">
            <div className="pf-title">📋 {playbookTitle} — required data</div>
            <div className="pf-grid">
              {playbookFields.map((f) =>
                f.type === 'boolean' ? (
                  <label key={f.key} className="check">
                    <input
                      type="checkbox"
                      checked={Boolean(fieldValues[f.key])}
                      onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.checked })}
                    />
                    {f.label ?? f.key}
                  </label>
                ) : (
                  <label key={f.key}>
                    {f.label ?? f.key}
                    {f.unit ? ` (${f.unit})` : ''}
                    {f.required ? ' *' : ''}
                    <input
                      type={f.type === 'number' ? 'number' : 'text'}
                      step={f.type === 'number' ? 'any' : undefined}
                      value={String(fieldValues[f.key] ?? '')}
                      onChange={(e) => setFieldValues({ ...fieldValues, [f.key]: e.target.value })}
                    />
                  </label>
                ),
              )}
            </div>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          Urgent — blocked / needs reviewer now
        </label>
      </div>
      <button type="submit" className="primary">
        Save work log
      </button>
    </form>
  )
}

function CorrectiveInput({ worklogId }: { worklogId: string }) {
  const [text, setText] = useState('')
  return (
    <div className="decide">
      <input
        placeholder="Corrective action taken, e.g. reduced viscosity to 17s…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        onClick={() => {
          if (!text.trim()) return
          void store.recordCorrectiveAction(worklogId, { actionTaken: text.trim() })
          setText('')
        }}
      >
        Save action
      </button>
    </div>
  )
}

function VerificationBlock({ w }: { w: store.Worklog }) {
  const v = w.data.verification
  if (!v) return null
  const rows = Object.entries(v).map(([k, val]) => {
    const initial = (w.data as Record<string, unknown>)[k]
    const changed = initial !== undefined && initial !== val
    return (
      <span key={k} className="verify-item">
        {k}: {changed ? <><s>{String(initial)}</s> → <b>{String(val)}</b></> : <b>{String(val)}</b>}
      </span>
    )
  })
  const route = w.data.verifiedRoute as
    | { label?: string; pass?: boolean; checked?: boolean }
    | undefined
  const t = w.data.verifiedAt ? new Date(w.data.verifiedAt).toLocaleTimeString('en-US') : ''
  const verdict = !route
    ? '\u{1F4CA} Measurements recorded'
    : route.pass
      ? route.checked
        ? "\u2705 Passed verification \u2014 measurements met the playbook's criteria"
        : '\u2611\uFE0F Routed to sign-off \u2014 this branch has no machine criteria saved (agent judgment)'
      : `\u26A0\uFE0F Verification failed \u2014 playbook rerouted to: ${route.label ?? 'remediation'}`
  return (
    <div
      className={`note verify-note ${route ? (route.pass ? (route.checked ? '' : 'neutral') : 'reroute') : 'neutral'}`}
    >
      <div className="verify-head">
        {verdict}
        {t && <span className="verify-time">{t}</span>}
      </div>
      <div className="verify-vals">{rows}</div>
    </div>
  )
}

function conditions(w: store.Worklog): string {
  return [
    w.data.colorChange ? 'after color change' : null,
    w.data.viscosity != null ? `viscosity ${w.data.viscosity}s` : null,
    w.data.boothTemp != null ? `booth ${w.data.boothTemp}°C` : null,
    w.data.sprayPressure != null ? `spray ${w.data.sprayPressure}bar` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function IncidentList({ state }: { state: store.AppState }) {
  const mine = state.worklogs.filter((w) => w.createdBy === state.actingAs)
  if (mine.length === 0) return <p className="empty">No entries yet. Log an incident or routine work above.</p>
  return (
    <div className="list">
      {mine.map((w) => (
        <div
          key={w.id}
          className={`card entry clickable ${w.urgent ? 'urgent' : ''}`}
          title="Click to open this entry's playbook in the panel"
          onClick={(e) => {
            // Inner buttons/inputs keep their own meaning.
            if ((e.target as HTMLElement).closest('button, input, select, textarea, a')) return
            // A run's own record is an output, not new work — no re-suggestion loop.
            if (w.data.runId) return
            store.setDraftContext({ kind: w.kind, urgent: w.urgent, task: w.task, hasInput: true })
            // Never yank an active run out from under the team — suggestions only.
            if (window.Understudy.currentRunId?.()) return
            const best = store.computeMatches().filter((m) => m.tier === 'strong')
            // The click on a specific entry IS the human's decision: load the
            // clear winner immediately; fall back to the suggestion card only
            // when the match is ambiguous.
            if (best.length > 0) void store.followPlaybook(best[0].processId)
          }}
        >
          <div className="entry-head">
            <span className="task">
              <span className="kind-tag">{w.kind}</span> {w.task}
            </span>
            <span className={`status ${w.status}`}>{w.status}</span>
          </div>
          <div className="meta">
            {w.date} · Area {w.line} · {w.hours}h
            {conditions(w) && <> · {conditions(w)}</>}
            {w.urgent && <span className="flag"> · URGENT</span>}
          </div>
          {w.data.actionTaken && (
            <div className="note">
              Corrective action: {w.data.actionTaken}
              {w.data.correctiveResult ? ` — ${w.data.correctiveResult}` : ''}
              {w.data.testPanelResult ? ` (test panel: ${w.data.testPanelResult})` : ''}
            </div>
          )}
          <VerificationBlock w={w} />
          {w.status === 'draft' && (
            <button
              onClick={() =>
                void store.requestApproval(w.id, 'lee').catch((err) => {
                  window.Understudy.log(
                    `review request refused: ${err instanceof Error ? err.message : err}`,
                    { worklogId: w.id },
                  )
                })
              }
            >
              Send to Lee for review
            </button>
          )}
          {!w.data.actionTaken && w.status !== 'draft' && w.status !== 'approved' && (
            <CorrectiveInput worklogId={w.id} />
          )}
        </div>
      ))}
    </div>
  )
}

function ApprovalsInbox({ state }: { state: store.AppState }) {
  const [comments, setComments] = useState<Record<string, string>>({})
  const inbox = state.approvals.filter((a) => a.approver === state.actingAs)
  if (inbox.length === 0) return <p className="empty">No review requests for {state.actingAs}.</p>
  return (
    <div className="list">
      {inbox.map((a) => {
        const wl = state.worklogs.find((w) => w.id === a.worklogId)
        const evidence = wl
          ? Object.entries(wl.data).filter(
              ([k, v]) =>
                !['runId', 'systemGenerated', 'verification', 'verifiedAt', 'verifiedRoute'].includes(k) &&
                (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
            )
          : []
        return (
          <div key={a.id} className="card entry">
            <div className="entry-head">
              <span className="task">
                {wl && <span className="kind-tag">{wl.kind}</span>} {wl?.task ?? a.worklogId}
              </span>
              <span className={`status ${a.status.toLowerCase()}`}>{a.status}</span>
            </div>
            {evidence.length > 0 && (
              <div className="meta review-evidence">
                {evidence.map(([k, v]) => (
                  <span key={k} className="verify-item">
                    {k}: <b>{String(v)}</b>
                  </span>
                ))}
              </div>
            )}
            <div className="meta">
              from {state.users.find((u) => u.username === a.requestedBy)?.name ?? a.requestedBy}
              {wl ? ` · ${wl.date} · Area ${wl.line}` : ''}
              {wl && conditions(wl) && <> · {conditions(wl)}</>}
              {wl?.urgent && <span className="flag"> · URGENT</span>}
            </div>
            {wl?.data.actionTaken && <div className="note">Action: {wl.data.actionTaken}</div>}
            {wl && <VerificationBlock w={wl} />}
            {a.comment && <div className="note">Comment: {a.comment}</div>}
            {a.status === 'PENDING' && (
              <div className="decide">
                <input
                  placeholder="Comment (optional for approve)"
                  value={comments[a.id] ?? ''}
                  onChange={(e) => setComments({ ...comments, [a.id]: e.target.value })}
                />
                <button
                  className="primary"
                  onClick={() =>
                    void store
                      .decideApproval(a.id, 'APPROVED', comments[a.id] || undefined)
                      .catch((err) => {
                        window.Understudy.log(
                          `approval refused: ${err instanceof Error ? err.message : err}`,
                          { worklogId: a.worklogId },
                        )
                      })
                  }
                >
                  Approve
                </button>
                <button
                  className="danger"
                  onClick={() => void store.decideApproval(a.id, 'REJECTED', comments[a.id] || 'rejected')}
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface LoadedProcess {
  id: string
  title: string
  createdBy: string
  map: UnderstudyProcessMap
}

const STATUS_ICON: Record<string, string> = {
  done: '✅',
  not_applicable: '⚪',
  skipped: '🔴',
  ready: '🟡',
  blocked: '🟠',
  pending: '▫️',
}

function RunHistory({ runs }: { runs: store.ProcessRun[] }) {
  if (runs.length === 0) return <p className="empty">Not run yet.</p>
  return (
    <div className="run-history">
      {runs.map((r) => (
        <div key={r.id} className="run-row">
          <div className="meta">
            Run #{r.id} · by {r.startedBy} · {new Date(r.startedAt).toLocaleString('en-US')} ·{' '}
            <span className={`status ${r.status === 'completed' ? 'approved' : 'submitted'}`}>
              {r.status}
            </span>
            {r.deviations > 0 && <span className="flag"> · {r.deviations} deviation(s)</span>}
          </div>
          <div className="run-steps">
            {r.steps.filter((s) => !String(s.id).startsWith('gate:')).map((s) => (
              <span key={s.id} title={`${s.label}: ${s.status}${s.naReason ? ` (${s.naReason})` : ''}`}>
                {STATUS_ICON[s.status ?? 'pending'] ?? '▫️'}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const latestPerTitle = store.latestPerTitle

function VersionDiffView({ proc }: { proc: LoadedProcess }) {
  const [diff, setDiff] = useState<store.VersionDiff | null | 'loading'>(null)
  if ((proc.map.version ?? 1) <= 1) return null
  if (diff === null)
    return (
      <button
        className="ghost"
        data-flow-ignore
        onClick={() => {
          setDiff('loading')
          void store.diffWithPrevious(proc).then((d) => setDiff(d ?? null))
        }}
      >
        Compare with v{(proc.map.version ?? 2) - 1}
      </button>
    )
  if (diff === 'loading') return <p className="meta">Comparing…</p>
  return (
    <div className="card entry diff-card">
      <div className="entry-head">
        <span className="task">Δ vs v{diff.prevVersion}</span>
      </div>
      {diff.added.map((l) => (
        <div key={`a${l}`} className="meta diff-add">+ added: {l}</div>
      ))}
      {diff.removed.map((l) => (
        <div key={`r${l}`} className="meta diff-del">− removed: {l}</div>
      ))}
      {diff.changed.map((c) => (
        <div key={c.label} className="meta">~ {c.label}: {c.changes.join('; ')}</div>
      ))}
      {diff.added.length + diff.removed.length + diff.changed.length === 0 && (
        <div className="meta">No structural changes.</div>
      )}
    </div>
  )
}

function PlaybookList({ state }: { state: store.AppState }) {
  const [selected, setSelected] = useState<LoadedProcess | null>(null)
  const [runs, setRuns] = useState<store.ProcessRun[]>([])
  const [followFlash, setFollowFlash] = useState(false)
  const visible = latestPerTitle(state.processes)
  const historyCount = (title: string) => state.processes.filter((p) => p.title === title).length - 1

  const open = async (id: string) => {
    const p = await store.getProcess(id)
    setSelected({ id: p.id, title: p.title, createdBy: p.createdBy, map: p.map as UnderstudyProcessMap })
    setRuns(await store.listRuns(id))
  }

  const follow = (p: LoadedProcess) => {
    void store.followPlaybook(p.id).then(() => {
      setFollowFlash(true)
      setTimeout(() => setFollowFlash(false), 2500)
    })
  }

  if (state.processes.length === 0) {
    return (
      <p className="empty">
        No playbooks yet. Handle an incident in the app, let the agent draft the response process,
        then press “Confirm &amp; save to library” in the Understudy panel.
      </p>
    )
  }

  return (
    <div className="proc-layout">
      <div className="list">
        {visible.map((p) => (
          <button
            key={p.id}
            className={`card proc-item ${selected?.id === p.id ? 'selected' : ''}`}
            onClick={() => void open(p.id)}
          >
            <span className="task">
              {p.title} <span className="version-tag">v{p.version || 1}</span>
            </span>
            <span className="meta">
              by {state.users.find((u) => u.username === p.createdBy)?.name ?? p.createdBy} ·{' '}
              {new Date(p.createdAt).toLocaleDateString('en-US')}
              {historyCount(p.title) > 0 && ` · ${historyCount(p.title)} earlier version(s) in history`}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="card proc-detail">
          <div className="entry-head">
            <span className="task">{selected.title}</span>
            <span>
              <button className="primary" onClick={() => follow(selected)}>
                {followFlash ? '✓ Run started — see the panel →' : '▶ Run this playbook'}
              </button>
              <VersionDiffView proc={selected} />{' '}
              <button
                className="ghost"
                data-flow-ignore
                onClick={() => {
                  void store.deleteProcess(selected.id)
                  setSelected(null)
                }}
              >
                Delete
              </button>
            </span>
          </div>
          <p className="meta">
            Loads into the Understudy panel — work along it yourself (check steps off), or ask the
            agent to run it for you. Skipped steps stay visible, so nothing gets missed.
          </p>
          <ol className="proc-steps">
            {selected.map.steps.map((s) => (
              <li key={s.id}>
                <span className={`badge-inline ${s.type}`}>{s.type}</span> {s.label}
                {s.next && s.next.length > 1 && (
                  <ul>
                    {s.next.map((b) => (
                      <li key={b.to} className="meta">
                        → {selected.map.steps.find((t) => t.id === b.to)?.label ?? b.to}
                        {b.condition ? ` — if ${b.condition}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          <h4 className="run-h">Run history</h4>
          <RunHistory runs={runs} />
        </div>
      )}
    </div>
  )
}

function RunStartedModal({ info }: { info: NonNullable<store.AppState['runStarted']> }) {
  // Presenter-friendly: the toast dismisses itself so the next click always
  // lands on the UI, never on the backdrop.
  useEffect(() => {
    const t = setTimeout(() => store.dismissRunStarted(), 5000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="modal-backdrop" onClick={() => store.dismissRunStarted()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          ▶ Run started — {info.title}
          {info.version ? <span className="version-tag"> v{info.version}</span> : null}
        </h3>
        {info.next && (
          <p>
            First step: <b>{info.next}</b>
          </p>
        )}
        <p className="hint">
          The panel on the right guides this run: a yellow border marks your next step, red marks a
          skipped one, and the playbook's required data fields are now part of the work-log form.
          Out-of-order or criteria-violating moves will be blocked.
        </p>
        <button className="primary" onClick={() => store.dismissRunStarted()}>
          Got it — start working
        </button>
      </div>
    </div>
  )
}

function MyTasks({ state, goReviews }: { state: store.AppState; goReviews: () => void }) {
  const [, setTick] = useState(0)
  const [taskValues, setTaskValues] = useState<Record<string, Record<string, string | boolean>>>({})
  const [problemFor, setProblemFor] = useState<string | null>(null)
  const [problemText, setProblemText] = useState('')
  useEffect(() => {
    const f = () => setTick((t) => t + 1)
    window.addEventListener('understudy:mapchange', f)
    return () => window.removeEventListener('understudy:mapchange', f)
  }, [])
  const proc = window.Understudy.getLoadedProcess?.()
  const prog = window.Understudy.getProgress?.() ?? []
  const runId = window.Understudy.currentRunId?.()
  const myRole = state.users.find((u) => u.username === state.actingAs)?.role
  if (!proc || prog.length === 0)
    return (
      <p className="empty">
        No process is running. Follow a playbook (Playbooks tab, or click a work-log entry) and its
        steps will be assigned here by role.
      </p>
    )
  const stepOf = (id: string) => proc.steps.find((s) => s.id === id)
  const fieldDefs = proc.fields ?? []
  const attention = prog.filter((p) => p.status === 'ready' || p.status === 'blocked' || p.status === 'skipped')
  const mine = attention.filter((p) => !p.role || !myRole || p.role === myRole)
  const theirs = attention.filter((p) => p.role && myRole && p.role !== myRole)
  const done = prog.filter((p) => p.done).length
  const required = prog.filter(
    (p) => p.done || (p.status !== 'not_applicable' && p.status !== 'conditional'),
  ).length
  const idxOf = (id: string) => prog.findIndex((p) => p.id === id)
  const prevDone = (id: string) => {
    const before = prog.slice(0, idxOf(id)).filter((p) => p.done)
    return before.length ? before[before.length - 1] : undefined
  }
  const nextUp = (id: string) => prog.slice(idxOf(id) + 1).find((p) => !p.done && p.status !== 'not_applicable')
  const rememberValues = (vals: Record<string, unknown>) => {
    try {
      const cur = JSON.parse(localStorage.getItem('understudy.recentValues') ?? '{}')
      for (const [k, v] of Object.entries(vals)) if (typeof v !== 'boolean') cur[k] = String(v)
      localStorage.setItem('understudy.recentValues', JSON.stringify(cur))
    } catch {
      /* per-viewer convenience only */
    }
  }
  const recentValue = (key: string): string | undefined => {
    try {
      const cur = JSON.parse(localStorage.getItem('understudy.recentValues') ?? '{}')
      return typeof cur[key] === 'string' ? cur[key] : undefined
    } catch {
      return undefined
    }
  }
  const complete = (p: { id: string; fields?: string[] }) => {
    const defs = (p.fields ?? [])
      .map((k) => fieldDefs.find((f) => f.key === k))
      .filter((d): d is UnderstudyFieldDef => !!d)
    const raw = taskValues[p.id] ?? {}
    const values = Object.fromEntries(
      defs
        .map((d) => {
          const v = raw[d.key]
          if (d.type === 'boolean') {
            if (d.confirm) return [d.key, Boolean(v)]
            if (v === '' || v === undefined) return [d.key, undefined]
            return [d.key, v === true || v === 'true']
          }
          if (v === undefined || v === '') return [d.key, undefined]
          return [d.key, d.type === 'number' ? Number(v) : String(v)]
        })
        .filter(([, v]) => v !== undefined),
    )
    rememberValues(values)
    window.Understudy.completeStep?.(p.id, values)
  }
  return (
    <div className="list">
      <div className="meta">
        {proc.title}
        {runId ? ` · run #${runId}` : ''} · path {done}/{required} done · map {prog.length} nodes · your
        role: {myRole ?? '—'}
      </div>
      {mine.length === 0 && theirs.length === 0 && (
        <p className="empty">
          Nothing is waiting on anyone — the run may be complete or awaiting a decision (ask the
          agent).
        </p>
      )}
      {mine.map((p) => {
        const st = stepOf(p.id)
        const defs = (p.fields ?? [])
          .map((k) => fieldDefs.find((f) => f.key === k))
          .filter((d): d is UnderstudyFieldDef => !!d)
        const raw = taskValues[p.id] ?? {}
        const missingRequired = defs.some((d) => {
          if (d.type === 'boolean') {
            if (d.confirm === true) return raw[d.key] !== true
            return d.required ? raw[d.key] === undefined || raw[d.key] === '' : false
          }
          if (!d.required) return false
          return raw[d.key] === undefined || raw[d.key] === ''
        })
        const prev = prevDone(p.id)
        const next = nextUp(p.id)
        return (
          <div key={p.id} className="card entry task-card">
            <div className="entry-head">
              <span className="task">
                <span className="kind-tag">{p.type}</span> {p.label}
              </span>
              <span className={`status ${p.status === 'skipped' ? 'rejected' : 'draft'}`}>
                {p.status === 'blocked'
                  ? 'blocked'
                  : p.status === 'skipped'
                    ? 'skipped — needs resolution'
                    : `assigned to you${p.role ? ` (${p.role})` : ''}`}
              </span>
            </div>
            {p.status === 'blocked' && (
              <div className="meta">Blocked — the panel card shows the exact reason.</div>
            )}
            {p.status === 'skipped' && (
              <div className="meta">
                This step was jumped over. Ask the agent to resolve the deviation (complete it late or
                excuse it with a reason) before sign-off.
              </div>
            )}
            {st?.detail && <div className="meta">{st.detail}</div>}
            {prev && (
              <div className="meta">
                Previous: ✓ {prev.label}
                {stepOf(prev.id)?.completedBy ? ` (by ${stepOf(prev.id)?.completedBy})` : ''}
              </div>
            )}
            {defs.length > 0 && (
              <div className="pf-grid task-fields">
                {defs.map((f) =>
                  f.type === 'boolean' && f.confirm ? (
                    <label key={f.key} className="check">
                      <input
                        type="checkbox"
                        checked={Boolean(raw[f.key])}
                        onChange={(e) =>
                          setTaskValues({ ...taskValues, [p.id]: { ...raw, [f.key]: e.target.checked } })
                        }
                      />
                      {f.label ?? f.key}
                      {'*'}
                    </label>
                  ) : f.type === 'boolean' ? (
                    <label key={f.key}>
                      {f.label ?? f.key}
                      {f.required ? '*' : ''}
                      <select
                        value={String(raw[f.key] ?? '')}
                        onChange={(e) =>
                          setTaskValues({ ...taskValues, [p.id]: { ...raw, [f.key]: e.target.value } })
                        }
                      >
                        <option value="">— not measured —</option>
                        <option value="true">pass / true</option>
                        <option value="false">fail / false</option>
                      </select>
                    </label>
                  ) : (
                    <label key={f.key}>
                      {f.label ?? f.key}
                      {f.unit ? ` (${f.unit})` : ''}
                      {f.required ? '*' : ''}
                      <input
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={String(raw[f.key] ?? '')}
                        placeholder={recentValue(f.key) ? `last: ${recentValue(f.key)}` : undefined}
                        onChange={(e) =>
                          setTaskValues({ ...taskValues, [p.id]: { ...raw, [f.key]: e.target.value } })
                        }
                      />
                    </label>
                  ),
                )}
              </div>
            )}
            {p.type === 'approval' ? (
              <button className="primary" onClick={goReviews}>
                Open Reviews to decide
              </button>
            ) : p.type === 'decision' ? (
              <div className="meta">Decision point — resolve it with the agent (measurements required).</div>
            ) : (
              <div className="decide">
                <button className="primary" disabled={missingRequired} onClick={() => complete(p)}>
                  {missingRequired ? 'Fill required fields…' : 'Complete & submit'}
                </button>
                <button className="ghost" data-flow-ignore onClick={() => setProblemFor(problemFor === p.id ? null : p.id)}>
                  Report a problem
                </button>
              </div>
            )}
            {problemFor === p.id && (
              <div className="decide">
                <input
                  placeholder="What is blocking this step?"
                  value={problemText}
                  onChange={(e) => setProblemText(e.target.value)}
                />
                <button
                  onClick={() => {
                    if (problemText.trim()) {
                      window.Understudy.reportProblem?.(p.id, problemText.trim())
                      setProblemText('')
                      setProblemFor(null)
                    }
                  }}
                >
                  Send
                </button>
              </div>
            )}
            {next && (
              <div className="meta">
                Next: {next.label}
                {next.role ? ` → ${next.role}` : ''}
              </div>
            )}
          </div>
        )
      })}
      {theirs.map((p) => (
        <div key={p.id} className="card entry waiting-card">
          <div className="entry-head">
            <span className="task">⏳ Waiting on {p.role}</span>
          </div>
          <div className="meta">
            {p.label} — switch persona to {p.role} to complete it, or ask the agent who is blocked.
          </div>
        </div>
      ))}
      <RunTimeline proc={proc} />
    </div>
  )
}

function RunTimeline({ proc }: { proc: UnderstudyProcessMap }) {
  const events: Array<{ ts: number; text: string; kind: 'step' | 'decision' }> = []
  for (const s of proc.steps) {
    if (s.done && s.completedAt)
      events.push({ ts: s.completedAt, kind: 'step', text: `✓ ${s.label}${s.completedBy ? ` — ${s.completedBy}` : ''}` })
  }
  for (const d of proc.decisions ?? []) {
    const target = proc.steps.find((s) => s.id === d.to)?.label ?? d.to
    events.push({
      ts: d.ts ?? 0,
      kind: 'decision',
      text: `◈ ${proc.steps.find((s) => s.id === d.stepId)?.label ?? d.stepId} → ${target}${d.reason ? ` (${d.reason})` : ''}${d.invalidated ? ' · superseded by retry' : ''}`,
    })
  }
  if (events.length === 0) return null
  events.sort((a, b) => a.ts - b.ts)
  return (
    <div className="card entry timeline">
      <div className="entry-head">
        <span className="task">🕒 Run timeline</span>
      </div>
      {events.map((e, i) => (
        <div key={i} className={`meta ${e.kind === 'decision' ? 'tl-decision' : ''}`}>
          <span className="tl-time">{e.ts ? new Date(e.ts).toLocaleTimeString('en-US') : ''}</span> {e.text}
        </div>
      ))}
    </div>
  )
}

function DemoStrip({ state }: { state: store.AppState }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const f = () => setTick((t) => t + 1)
    window.addEventListener('understudy:mapchange', f)
    return () => window.removeEventListener('understudy:mapchange', f)
  }, [])
  const prog = window.Understudy.getProgress?.() ?? []
  if (prog.length === 0)
    return <div className="demo-strip">🎬 Demo mode — run a playbook and the role relay appears here.</div>
  const personaOf = (role?: string) =>
    role ? state.users.find((u) => u.role === role)?.name ?? role : 'anyone'
  const ready = prog.find((p) => p.status === 'ready')
  const doneCount = prog.filter((p) => p.done).length
  return (
    <div className="demo-strip">
      <span className="demo-title">🎬 Role relay</span>
      {prog.map((p) => (
        <span
          key={p.id}
          className={`relay-chip ${p.done ? 'r-done' : p.status === 'ready' ? 'r-now' : p.status === 'not_applicable' ? 'r-na' : ''}`}
          title={p.label}
        >
          {personaOf(p.role)}
        </span>
      ))}
      <span className="demo-cue">
        {ready
          ? ready.role && state.users.find((u) => u.username === state.actingAs)?.role !== ready.role
            ? `→ switch persona to ${personaOf(ready.role)} (${ready.role}): ${ready.label}`
            : `→ now: ${ready.label}`
          : doneCount === prog.filter((p) => p.status !== 'not_applicable').length
            ? '✓ process complete'
            : '→ awaiting a decision (ask the agent)'}
      </span>
    </div>
  )
}

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [tab, setTab] = useState<'incidents' | 'tasks' | 'approvals' | 'playbooks'>('incidents')
  const [demoMode, setDemoMode] = useState(false)
  const [resetFlash, setResetFlash] = useState(false)

  useEffect(() => {
    void store.refresh()
  }, [])

  if (!state.authChecked) return null
  if (!state.me) return <Login />

  const acting = state.users.find((u) => u.username === state.actingAs)
  const pendingForMe = state.approvals.filter(
    (a) => a.approver === state.actingAs && a.status === 'PENDING',
  ).length

  return (
    <div className="app">
      {state.runStarted && <RunStartedModal info={state.runStarted} />}
      {demoMode && <DemoStrip state={state} />}
      <header className="topbar">
        <h1>
          🎭 Understudy{' '}
          <span className="sub">
            turn work into living playbooks · demo workspace <span className="buildid">build {__BUILD__}</span>
          </span>
        </h1>
        <div className="userbox">
          <span>
            Signed in: {state.me.name} · acting as {acting?.name ?? state.actingAs}
          </span>
          <select value={state.actingAs} onChange={(e) => store.switchActingAs(e.target.value)}>
            {state.users
              .filter((u) => u.username !== 'judge')
              .map((u) => (
                <option key={u.username} value={u.username}>
                  {u.name} ({u.role})
                </option>
              ))}
          </select>
          <button
            className="ghost"
            data-flow-ignore
            title="Presenter aid: shows the role relay and whose turn it is"
            onClick={() => setDemoMode((d) => !d)}
          >
            {demoMode ? '🎬 Demo mode on' : 'Demo mode'}
          </button>
          <button
            className="ghost"
            data-flow-ignore
            title="Clear incident logs, reviews and run records so you start from a clean slate (playbooks are kept)"
            onClick={() => {
              void store.resetDemoData('worklogs').then(() => {
                setResetFlash(true)
                setTimeout(() => setResetFlash(false), 2000)
              })
            }}
          >
            {resetFlash ? '✓ Cleared' : 'Start fresh demo'}
          </button>
          <button className="ghost" onClick={() => store.logout()} data-flow-ignore>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'incidents' ? 'active' : ''} onClick={() => setTab('incidents')}>
          Work log
        </button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
          My tasks
        </button>
        <button className={tab === 'approvals' ? 'active' : ''} onClick={() => setTab('approvals')}>
          Reviews{pendingForMe > 0 && <span className="pill">{pendingForMe}</span>}
        </button>
        <button className={tab === 'playbooks' ? 'active' : ''} onClick={() => setTab('playbooks')}>
          Playbooks{state.processes.length > 0 && (
            <span className="pill blue">{latestPerTitle(state.processes).length}</span>
          )}
        </button>
      </nav>

      <main>
        {tab === 'tasks' && <MyTasks state={state} goReviews={() => setTab('approvals')} />}
        {tab === 'incidents' && (
          <>
            <SuggestionCard />
            <IncidentForm />
            <IncidentList state={state} />
          </>
        )}
        {tab === 'approvals' && <ApprovalsInbox state={state} />}
        {tab === 'playbooks' && <PlaybookList state={state} />}
      </main>
    </div>
  )
}
