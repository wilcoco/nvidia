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
            store.setDraftContext({ kind: w.kind, urgent: w.urgent, task: w.task, hasInput: true })
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
        return (
          <div key={a.id} className="card entry">
            <div className="entry-head">
              <span className="task">
                {wl && <span className="kind-tag">{wl.kind}</span>} {wl?.task ?? a.worklogId}
              </span>
              <span className={`status ${a.status.toLowerCase()}`}>{a.status}</span>
            </div>
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
            {r.steps.map((s) => (
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
              </button>{' '}
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
  const detailOf = (id: string) => proc.steps.find((s) => s.id === id)?.detail
  const actionOf = (id: string) => proc.steps.find((s) => s.id === id)?.action
  const ready = prog.filter((p) => p.status === 'ready')
  const mine = ready.filter((p) => !p.role || !myRole || p.role === myRole)
  const theirs = ready.filter((p) => p.role && myRole && p.role !== myRole)
  const done = prog.filter((p) => p.done).length
  return (
    <div className="list">
      <div className="meta">
        {proc.title}
        {runId ? ` · run #${runId}` : ''} · {done}/{prog.length} steps done
      </div>
      {mine.length === 0 && theirs.length === 0 && (
        <p className="empty">Nothing is waiting on anyone — the run may be complete or awaiting a decision (ask the agent).</p>
      )}
      {mine.map((p) => (
        <div key={p.id} className="card entry task-card">
          <div className="entry-head">
            <span className="task">
              <span className="kind-tag">{p.type}</span> {p.label}
            </span>
            <span className="status draft">assigned to you{p.role ? ` (${p.role})` : ''}</span>
          </div>
          {detailOf(p.id) && <div className="meta">{detailOf(p.id)}</div>}
          {p.type === 'approval' ? (
            <button className="primary" onClick={goReviews}>
              Open Reviews to decide
            </button>
          ) : p.type === 'decision' ? (
            <div className="meta">Decision point — resolve it with the agent (measurements required).</div>
          ) : (
            <div className="decide">
              {actionOf(p.id) === 'log_work_item' && (
                <span className="meta">Saving a work log completes this step — or:</span>
              )}
              <button className="primary" onClick={() => window.Understudy.completeStep?.(p.id)}>
                Mark complete
              </button>
            </div>
          )}
        </div>
      ))}
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
    </div>
  )
}

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [tab, setTab] = useState<'incidents' | 'tasks' | 'approvals' | 'playbooks'>('incidents')
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
      <header className="topbar">
        <h1>
          🎭 Understudy{' '}
          <span className="sub">turn work into living playbooks · demo workspace</span>
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
