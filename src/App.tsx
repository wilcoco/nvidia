import { useState, useSyncExternalStore } from 'react'
import * as store from './store'
import { USERS } from './store'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function WorklogForm() {
  const [date, setDate] = useState(today())
  const [line, setLine] = useState('A')
  const [task, setTask] = useState('')
  const [progress, setProgress] = useState(100)
  const [hours, setHours] = useState(1)
  const [note, setNote] = useState('')
  const [urgent, setUrgent] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!task.trim()) return
    store.createWorklog({ date, line, task: task.trim(), progressPct: progress, hours, note: note.trim(), urgent })
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
  const mine = state.worklogs.filter((w) => w.createdBy === state.currentUser)
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
            <button onClick={() => store.requestApproval(w.id, 'lee')}>
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
  const inbox = state.approvals.filter((a) => a.approver === state.currentUser)
  if (inbox.length === 0) return <p className="empty">No approval requests.</p>
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
              from {USERS.find((u) => u.id === a.requestedBy)?.name ?? a.requestedBy} ·{' '}
              {wl ? `${wl.date} · Line ${wl.line} · ${wl.progressPct}% · ${wl.hours}h` : ''}
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
                  onClick={() => store.decideApproval(a.id, 'APPROVED', comments[a.id] || undefined)}
                >
                  Approve
                </button>
                <button
                  className="danger"
                  onClick={() => store.decideApproval(a.id, 'REJECTED', comments[a.id] || 'rejected')}
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

export default function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [tab, setTab] = useState<'worklogs' | 'approvals'>('worklogs')
  const user = USERS.find((u) => u.id === state.currentUser)!
  const pendingForMe = state.approvals.filter(
    (a) => a.approver === state.currentUser && a.status === 'PENDING',
  ).length

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          LinePulse <span className="sub">shift worklog &amp; approvals</span>
        </h1>
        <div className="userbox">
          <span>
            {user.name} · {user.role}
          </span>
          <select value={state.currentUser} onChange={(e) => store.switchUser(e.target.value)}>
            {USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
          <button className="ghost" onClick={() => store.resetDemo()} data-flow-ignore>
            Reset demo
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
      </nav>

      <main>
        {tab === 'worklogs' ? (
          <>
            <WorklogForm />
            <WorklogList state={state} />
          </>
        ) : (
          <ApprovalsInbox state={state} />
        )}
      </main>
    </div>
  )
}
