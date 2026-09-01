import { useEffect, useState, useSyncExternalStore } from 'react'
import * as store from './store'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const INCIDENT_TYPES = [
  'orange peel',
  'sagging / runs',
  'dust inclusion',
  'color mismatch',
  'equipment fault',
  'routine log',
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
          LinePulse{' '}
          <span className="sub">demo workspace powered by 🎭 Understudy</span>
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
  const matches = store.computeMatches().slice(0, 2)
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
            <button className="primary" onClick={() => void store.followPlaybook(m.processId)}>
              Follow this playbook
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
  const [kind, setKind] = useState('orange peel')
  const [task, setTask] = useState('')
  const [viscosity, setViscosity] = useState('')
  const [boothTemp, setBoothTemp] = useState('')
  const [sprayPressure, setSprayPressure] = useState('')
  const [colorChange, setColorChange] = useState(false)
  const [actionTaken, setActionTaken] = useState('')
  const [hours, setHours] = useState(0.5)
  const [urgent, setUrgent] = useState(false)

  // Keep the live draft context in the store so playbook matching (and the
  // agent, via find_relevant_processes) sees what is being entered right now.
  useEffect(() => {
    store.setDraftContext({
      kind,
      colorChange,
      urgent,
      hasInput: task.trim().length > 0 || colorChange || urgent,
    })
  }, [kind, colorChange, urgent, task])

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
        viscosity: viscosity === '' ? undefined : Number(viscosity),
        boothTemp: boothTemp === '' ? undefined : Number(boothTemp),
        sprayPressure: sprayPressure === '' ? undefined : Number(sprayPressure),
        colorChange,
        actionTaken: actionTaken.trim() || undefined,
      },
    })
    setTask('')
    setActionTaken('')
    setUrgent(false)
    setColorChange(false)
    setViscosity('')
    setBoothTemp('')
    setSprayPressure('')
  }

  return (
    <form className="card form" onSubmit={submit} data-flow-label="incident report">
      <h3>Log an incident</h3>
      <div className="grid">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Booth
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option>A</option>
            <option>B</option>
          </select>
        </label>
        <label className="wide">
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {INCIDENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="wide wide4">
          What happened
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="e.g. Orange peel on hoods after switching to matte gray"
          />
        </label>
        <label>
          Viscosity (s)
          <input type="number" step={0.1} value={viscosity} onChange={(e) => setViscosity(e.target.value)} placeholder="18.5" />
        </label>
        <label>
          Booth temp (°C)
          <input type="number" step={0.5} value={boothTemp} onChange={(e) => setBoothTemp(e.target.value)} placeholder="23" />
        </label>
        <label>
          Spray (bar)
          <input type="number" step={0.1} value={sprayPressure} onChange={(e) => setSprayPressure(e.target.value)} placeholder="2.4" />
        </label>
        <label>
          Hours
          <input type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </label>
        <label className="wide wide4">
          Action taken
          <input
            value={actionTaken}
            onChange={(e) => setActionTaken(e.target.value)}
            placeholder="e.g. Reduced viscosity to 17s, test panel sprayed"
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={colorChange} onChange={(e) => setColorChange(e.target.checked)} />
          Right after a color change
        </label>
        <label className="check">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          Urgent — line stopped / needs lead now
        </label>
      </div>
      <button type="submit" className="primary">
        Save incident log
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
  if (mine.length === 0) return <p className="empty">No incident logs yet. Log your first one above.</p>
  return (
    <div className="list">
      {mine.map((w) => (
        <div key={w.id} className={`card entry ${w.urgent ? 'urgent' : ''}`}>
          <div className="entry-head">
            <span className="task">
              <span className="kind-tag">{w.kind}</span> {w.task}
            </span>
            <span className={`status ${w.status}`}>{w.status}</span>
          </div>
          <div className="meta">
            {w.date} · Booth {w.line} · {w.hours}h
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
          {w.status === 'draft' && (
            <button onClick={() => void store.requestApproval(w.id, 'lee')}>
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
              {wl ? ` · ${wl.date} · Booth ${wl.line}` : ''}
              {wl && conditions(wl) && <> · {conditions(wl)}</>}
              {wl?.urgent && <span className="flag"> · URGENT</span>}
            </div>
            {wl?.data.actionTaken && <div className="note">Action: {wl.data.actionTaken}</div>}
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
                  onClick={() => void store.decideApproval(a.id, 'APPROVED', comments[a.id] || undefined)}
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
            Run #{r.id} · by {r.startedBy} · {new Date(r.startedAt).toLocaleString()} ·{' '}
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

function PlaybookList({ state }: { state: store.AppState }) {
  const [selected, setSelected] = useState<LoadedProcess | null>(null)
  const [runs, setRuns] = useState<store.ProcessRun[]>([])

  const open = async (id: string) => {
    const p = await store.getProcess(id)
    setSelected({ id: p.id, title: p.title, createdBy: p.createdBy, map: p.map as UnderstudyProcessMap })
    setRuns(await store.listRuns(id))
  }

  const follow = (p: LoadedProcess) => void store.followPlaybook(p.id)

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
        {state.processes.map((p) => (
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
              {new Date(p.createdAt).toLocaleDateString()}
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
                Follow this playbook
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

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [tab, setTab] = useState<'incidents' | 'approvals' | 'playbooks'>('incidents')

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
      <header className="topbar">
        <h1>
          LinePulse{' '}
          <span className="sub">paint shop incident log — demo workspace powered by 🎭 Understudy</span>
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
            onClick={() => void store.resetDemoData('worklogs')}
          >
            Start fresh demo
          </button>
          <button className="ghost" onClick={() => store.logout()} data-flow-ignore>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'incidents' ? 'active' : ''} onClick={() => setTab('incidents')}>
          Incidents
        </button>
        <button className={tab === 'approvals' ? 'active' : ''} onClick={() => setTab('approvals')}>
          Reviews{pendingForMe > 0 && <span className="pill">{pendingForMe}</span>}
        </button>
        <button className={tab === 'playbooks' ? 'active' : ''} onClick={() => setTab('playbooks')}>
          Playbooks{state.processes.length > 0 && <span className="pill blue">{state.processes.length}</span>}
        </button>
      </nav>

      <main>
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
