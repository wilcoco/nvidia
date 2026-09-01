import { useEffect, useState, useSyncExternalStore } from 'react'
import * as store from './store'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
          LinePulse <span className="sub">shift worklog &amp; approvals</span>
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

function WorklogForm() {
  const [date, setDate] = useState(today())
  const [line, setLine] = useState('A')
  const [task, setTask] = useState('')
  const [progress, setProgress] = useState(100)
  const [hours, setHours] = useState(1)
  const [note, setNote] = useState('')
  const [urgent, setUrgent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!task.trim()) return
    await store.createWorklog({
      date,
      line,
      task: task.trim(),
      progressPct: progress,
      hours,
      note: note.trim(),
      urgent,
    })
    setTask('')
    setNote('')
    setUrgent(false)
    setProgress(100)
    setHours(1)
  }

  return (
    <form className="card form" onSubmit={submit} data-flow-label="new worklog">
      <h3>New worklog</h3>
      <div className="grid">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Line
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option>A</option>
            <option>B</option>
          </select>
        </label>
        <label className="wide">
          Task
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="e.g. Bumper primer batch #204"
          />
        </label>
        <label>
          Progress %
          <input
            type="number"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
          />
        </label>
        <label>
          Hours
          <input
            type="number"
            min={0}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
        </label>
        <label className="wide">
          Issues / remarks
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Nozzle clogging on booth 2"
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          Urgent — needs immediate attention
        </label>
      </div>
      <button type="submit" className="primary">
        Save worklog
      </button>
    </form>
  )
}

function WorklogList({ state }: { state: store.AppState }) {
  const mine = state.worklogs.filter((w) => w.createdBy === state.actingAs)
  if (mine.length === 0) return <p className="empty">No worklogs yet. Write your first entry above.</p>
  return (
    <div className="list">
      {mine.map((w) => (
        <div key={w.id} className={`card entry ${w.urgent ? 'urgent' : ''}`}>
          <div className="entry-head">
            <span className="task">{w.task}</span>
            <span className={`status ${w.status}`}>{w.status}</span>
          </div>
          <div className="meta">
            {w.date} · Line {w.line} · {w.progressPct}% · {w.hours}h
            {w.urgent && <span className="flag"> · URGENT</span>}
          </div>
          {w.note && <div className="note">{w.note}</div>}
          {w.status === 'draft' && (
            <button onClick={() => void store.requestApproval(w.id, 'lee')}>
              Request approval from Lee
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function ApprovalsInbox({ state }: { state: store.AppState }) {
  const [comments, setComments] = useState<Record<string, string>>({})
  const inbox = state.approvals.filter((a) => a.approver === state.actingAs)
  if (inbox.length === 0) return <p className="empty">No approval requests for {state.actingAs}.</p>
  return (
    <div className="list">
      {inbox.map((a) => {
        const wl = state.worklogs.find((w) => w.id === a.worklogId)
        return (
          <div key={a.id} className="card entry">
            <div className="entry-head">
              <span className="task">{wl?.task ?? a.worklogId}</span>
              <span className={`status ${a.status.toLowerCase()}`}>{a.status}</span>
            </div>
            <div className="meta">
              from {state.users.find((u) => u.username === a.requestedBy)?.name ?? a.requestedBy}
              {wl ? ` · ${wl.date} · Line ${wl.line} · ${wl.progressPct}% · ${wl.hours}h` : ''}
              {wl?.urgent && <span className="flag"> · URGENT</span>}
            </div>
            {wl?.note && <div className="note">{wl.note}</div>}
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
  map: FlowCatchProcessMap
}

function ProcessList({ state }: { state: store.AppState }) {
  const [selected, setSelected] = useState<LoadedProcess | null>(null)

  const open = async (id: string) => {
    const p = await store.getProcess(id)
    setSelected({ id: p.id, title: p.title, createdBy: p.createdBy, map: p.map as FlowCatchProcessMap })
  }

  const follow = (p: LoadedProcess) => {
    window.FlowCatch.loadProcess(p.map, { id: p.id, createdBy: p.createdBy })
    window.FlowCatch.log(`opened process "${p.title}" to work along it`, { processId: p.id })
  }

  if (state.processes.length === 0) {
    return (
      <p className="empty">
        No saved processes yet. Work in the app, let the agent draft a process, then press
        “Confirm &amp; save to library” in the FlowCatch panel.
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
            <span className="task">{p.title}</span>
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
            <button className="primary" onClick={() => follow(selected)}>
              Follow this process
            </button>
          </div>
          <p className="meta">
            Loads into the FlowCatch panel — work along it yourself, or ask the agent to run it for
            you.
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
        </div>
      )}
    </div>
  )
}

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [tab, setTab] = useState<'worklogs' | 'approvals' | 'processes'>('worklogs')

  useEffect(() => {
    // Ensure auth state resolves even before polling kicks in.
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
          LinePulse <span className="sub">shift worklog &amp; approvals</span>
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
          <button className="ghost" onClick={() => store.logout()} data-flow-ignore>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'worklogs' ? 'active' : ''} onClick={() => setTab('worklogs')}>
          My worklogs
        </button>
        <button className={tab === 'approvals' ? 'active' : ''} onClick={() => setTab('approvals')}>
          Approvals{pendingForMe > 0 && <span className="pill">{pendingForMe}</span>}
        </button>
        <button className={tab === 'processes' ? 'active' : ''} onClick={() => setTab('processes')}>
          Processes{state.processes.length > 0 && <span className="pill blue">{state.processes.length}</span>}
        </button>
      </nav>

      <main>
        {tab === 'worklogs' && (
          <>
            <WorklogForm />
            <WorklogList state={state} />
          </>
        )}
        {tab === 'approvals' && <ApprovalsInbox state={state} />}
        {tab === 'processes' && <ProcessList state={state} />}
      </main>
    </div>
  )
}
