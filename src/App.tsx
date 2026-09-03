import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import * as store from './store'
import Overview, { type WorkspaceTab } from './Overview'
import SuggestionCard from './SuggestionCard'
import { AgentInvite, ErrorNotice, useAction, useWorkspaceUpdates } from './ui'

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
      <section className="login-intro">
        <div className="brand"><span className="brand-mark">u</span>Understudy</div>
        <div className="eyebrow">A SHARED WORKSPACE FOR YOU AND YOUR AGENT</div>
        <h1>Describe your work.<br /><span>Build a process your team can follow.</span></h1>
        <p>Your AI agent asks what happens before and after your task, and who does each part. Your answers become a playbook: a process the team can follow and reuse.</p>
        <ol><li>Describe one task. Answer the first question.</li><li>Build and correct the process with your agent.</li><li>Hand work to the next owner. Reuse the process next time.</li></ol>
        <span className="tech-tag">Powered by WebMCP</span>
      </section>
      <form className="card login" onSubmit={submit}>
        <div className="eyebrow">EXPLORE THE WORKSPACE</div>
        <h2>Start with one task.</h2>
        <p className="hint">The demo account is filled in. Try a delivery example or describe your own work. Start here, then continue the interview in your WebMCP agent’s chat.</p>
        <label>
          Username
          <input value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <ErrorNotice message={error} />
        <button className="primary" disabled={busy}>
          {busy ? 'Opening workspace…' : 'Enter demo workspace →'}
        </button>
        <p className="login-disclaimer">Shared demo data. Switch between contributor, operations and reviewer roles inside.</p>
      </form>
    </div>
  )
}


function IncidentForm() {
  const action = useAction()
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
      // A finished run's contract is its own paperwork — new entries are new
      // work and must not inherit its fields (or its runId).
      const active = m?.fields?.length && window.Understudy.isRunComplete?.() !== true
      setPlaybookFields(active ? m!.fields! : [])
      setPlaybookTitle(active ? m!.title : '')
    }
    read()
    window.addEventListener('understudy:mapchange', read)
    return () => window.removeEventListener('understudy:mapchange', read)
  }, [])

  // Keep the live draft context in the store so playbook matching (and the
  // agent, via find_relevant_processes) sees what is being entered right now.
  useEffect(() => {
    if (!task.trim() && !urgent && kind === 'routine work') return
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
    const saved = await action.run(() => store.createWorklog({
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
              if (f.type === 'boolean') return [f.key, v === undefined ? undefined : Boolean(v)]
              if (v === undefined || String(v).trim() === '') return [f.key, undefined]
              return [f.key, f.type === 'number' ? Number(v) : String(v).trim()]
            })
            .filter(([, v]) => v !== undefined),
        ),
      },
    }))
    if (!saved) return
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
                ) : f.type === 'select' ? (
                  <label key={f.key}>
                    {f.label ?? f.key}{f.required ? ' *' : ''}
                    <select value={String(fieldValues[f.key] ?? '')}
                      onChange={(e) => setFieldValues({...fieldValues, [f.key]: e.target.value})}>
                      <option value="">— choose an option —</option>
                      {(f.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
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
      <button type="submit" className="primary" disabled={action.busy}>
        {action.busy ? 'Saving…' : 'Save work log'}
      </button>
      <ErrorNotice message={action.error} />
    </form>
  )
}

function CorrectiveInput({ worklogId }: { worklogId: string }) {
  const [text, setText] = useState('')
  const action = useAction()
  return (
    <div><div className="decide">
      <input
        placeholder="Corrective action taken, e.g. reduced viscosity to 17s…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        onClick={() => {
          if (!text.trim()) return
          void action.run(async () => {
            await store.recordCorrectiveAction(worklogId, { actionTaken: text.trim() })
            setText('')
          })
        }}
        disabled={action.busy || !text.trim()}
      >
        Save action
      </button>
    </div><ErrorNotice message={action.error} /></div>
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
  const escalation = route?.label ? /re-?plan|escalat|redesign/i.test(route.label) : false
  const verdict = !route
    ? '\u{1F4CA} Measurements recorded'
    : route.pass
      ? escalation
        ? `\u{1F4CB} Approval requested: ${route.label} \u2014 the underlying checks did NOT pass; this approves the plan, not the work`
        : route.checked
          ? `\u2705 Criteria met \u2014 routed to sign-off${route.label ? `: ${route.label}` : ''}`
          : '\u2611\uFE0F Routed to sign-off \u2014 this branch has no machine criteria saved (agent judgment)'
      : `\u26A0\uFE0F Verification failed \u2014 playbook rerouted to: ${route.label ?? 'remediation'}`
  return (
    <div
      className={`note verify-note ${route ? (route.pass ? (escalation ? 'reroute' : route.checked ? '' : 'neutral') : 'reroute') : 'neutral'}`}
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
  const action = useAction()
  const mine = state.worklogs.filter((w) => w.createdBy === state.actingAs)
  if (mine.length === 0) return <p className="empty">No entries yet. Log an incident or routine work above.</p>
  return (
    <div className="list">
      <ErrorNotice message={action.error} />
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
            if (best.length > 0) void action.run(() => store.followPlaybook(best[0].processId))
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
          {(w.status === 'draft' || w.status === 'rejected') && (
            <button
              onClick={() =>
                void action.run(() => store.requestApproval(w.id, 'lee'))
              }
              disabled={action.busy}
            >
              {w.status === 'rejected' ? 'Resubmit to Lee for review' : 'Send to Lee for review'}
            </button>
          )}
          {w.status === 'rejected' && (
            <CorrectiveInput worklogId={w.id} />
          )}
        </div>
      ))}
    </div>
  )
}

function ApprovalsInbox({ state }: { state: store.AppState }) {
  const [comments, setComments] = useState<Record<string, string>>({})
  const [showHistory, setShowHistory] = useState(false)
  const action = useAction()
  const all = state.approvals.filter((a) => a.approver === state.actingAs)
  const inbox = all.filter((a) => showHistory || a.status === 'PENDING')
  const reviewer = state.users.find((u) => u.role === 'Reviewer')
  return (
    <div className="list">
      <div className="page-intro"><h1>Review the evidence.</h1><p>Check the submitted results before signing off. Changed evidence requires a new review.</p></div>
      {reviewer && state.actingAs !== reviewer.username && <div className="empty-card"><p>Reviews are assigned to {reviewer.name}, the demo reviewer.</p><button className="secondary" onClick={() => store.switchActingAs(reviewer.username)}>Switch to {reviewer.name} · Reviewer</button></div>}
      <label className="history-toggle"><input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />Include completed and cancelled reviews</label>
      <ErrorNotice message={action.error} />
      {inbox.length === 0 && <p className="empty">No {showHistory ? '' : 'pending '}reviews for this role. New requests appear here when the required work is complete.</p>}
      {inbox.map((a) => {
        const wl = state.worklogs.find((w) => w.id === a.worklogId)
        const evidence = wl
          ? Object.entries(wl.data).filter(
              ([k, v]) =>
                !['runId', 'systemGenerated', 'approvalStepId', 'verification', 'verifiedAt', 'verifiedRoute'].includes(k) &&
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
                  aria-label={`Review comment for request ${a.id}`}
                  value={comments[a.id] ?? ''}
                  onChange={(e) => setComments({ ...comments, [a.id]: e.target.value })}
                />
                <button
                  className="primary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(() => store.decideApproval(a.id, 'APPROVED', comments[a.id] || undefined))
                  }
                >
                  Approve
                </button>
                <button
                  className="danger"
                  disabled={action.busy || !(comments[a.id] ?? '').trim()}
                  title={(comments[a.id] ?? '').trim() ? undefined : 'A rejection needs a reason — write a comment first'}
                  onClick={() => void action.run(() => store.decideApproval(a.id, 'REJECTED', comments[a.id].trim()))}
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
  const action = useAction()
  if (runs.length === 0) return <p className="empty">Not run yet.</p>
  return (
    <div className="run-history">
      <ErrorNotice message={action.error} />
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
          <details><summary>View evidence and reported problems</summary>
            {(r.events ?? []).map((e) => <div key={e.id} className="history-event"><b>{e.kind} · {e.label}</b><span>{e.actor} · {new Date(e.ts).toLocaleString()}</span>
              {e.note && <p>{e.note}</p>}{e.values && <p>{Object.entries(e.values).map(([k,v]) => `${k}: ${v}`).join(', ')}</p>}
              {e.kind === 'problem' && <button disabled={action.busy} onClick={() => void action.run(() => store.reviseFromProblem(r, e))}>Use this problem in a draft revision</button>}
            </div>)}
            {!r.events?.length && <p className="meta">No detailed events were recorded for this older run.</p>}
          </details>
        </div>
      ))}
    </div>
  )
}

const latestPerTitle = store.latestPerTitle

function VersionDiffView({ proc }: { proc: LoadedProcess }) {
  const [diff, setDiff] = useState<store.VersionDiff | null | 'loading'>(null)
  const action = useAction()
  if ((proc.map.version ?? 1) <= 1) return null
  if (diff === null)
    return (
      <span><ErrorNotice message={action.error} /><button
        className="ghost"
        data-flow-ignore
        onClick={() => {
          setDiff('loading')
          void action.run(async () => {
            try { setDiff(await store.diffWithPrevious(proc)) } catch (err) { setDiff(null); throw err }
          })
        }}
      >
        Compare with v{(proc.map.version ?? 2) - 1}
      </button></span>
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
  const [armCancel, setArmCancel] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [cancelCount, setCancelCount] = useState(0)
  const [query, setQuery] = useState('')
  const action = useAction()
  const visible = latestPerTitle(state.processes).filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
  const historyCount = (title: string) => state.processes.filter((p) => p.title === title).length - 1

  const open = (id: string) => action.run(async () => {
    const [p, history] = await Promise.all([store.getProcess(id), store.listRuns(id)])
    setSelected({ id: p.id, title: p.title, createdBy: p.createdBy, map: p.map as UnderstudyProcessMap })
    setRuns(history)
    setArmCancel(false)
    setDeleteArmed(false)
  })
  const follow = (p: LoadedProcess) => action.run(async () => {
    if (!armCancel) {
      const count = await store.cancellableReviewCount()
      if (count > 0) { setCancelCount(count); setArmCancel(true); return }
    }
    setArmCancel(false)
    await store.followPlaybook(p.id)
  })

  if (state.processes.length === 0) {
    return (
      <div className="empty-card"><h1>Your team’s playbooks start here.</h1><p>Describe one task on Start here, then let your agent ask about its rules. The playbook appears here after you review and save the draft.</p><AgentInvite prompt="What is Understudy and how do I use it? Help me turn one of my tasks into a playbook, asking me one question at a time." /></div>
    )
  }

  return (
    <div className="proc-layout">
      <div className="page-intro"><h1>Choose a playbook. Start a run.</h1><p>Each run collects its own evidence and approval. Earlier revisions stay in the history.</p></div>
      <label className="library-search">Find a playbook<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name…" /></label>
      <ErrorNotice message={action.error} />
      {visible.length === 0 && <p className="empty">No playbooks match “{query}”. Try another name.</p>}
      <div className="list">
        {visible.map((p) => (
          <button
            key={p.id}
            className={`card proc-item ${selected?.id === p.id ? 'selected' : ''}`}
            onClick={() => void open(p.id)}
            disabled={action.busy}
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
              <button className={armCancel ? 'danger' : 'primary'} disabled={action.busy} onClick={() => void follow(selected)}>
                {action.busy ? 'Loading…' : armCancel
                  ? `Confirm new run — cancels ${cancelCount} pending review(s)`
                  : 'Run this playbook →'}
              </button>
              {armCancel && <button className="ghost" onClick={() => setArmCancel(false)}>Keep current work</button>}
              <VersionDiffView key={selected.id} proc={selected} />{' '}
              <button
                className="ghost"
                data-flow-ignore
                onClick={() => {
                  if (!deleteArmed) { setDeleteArmed(true); return }
                  void action.run(async () => { await store.deleteProcess(selected.id); setSelected(null); setDeleteArmed(false) })
                }}
              >
                {deleteArmed ? 'Confirm delete of this revision' : 'Delete revision…'}
              </button>
              {deleteArmed && <button className="ghost" onClick={() => setDeleteArmed(false)}>Keep revision</button>}
            </span>
          </div>
          <label className="version-picker">Version and execution history
            <select aria-label="Playbook version" value={selected.id} onChange={(e) => void open(e.target.value)}>
              {state.processes.filter((p) => p.title === selected.title).sort((a,b) => b.version - a.version).map((p) => <option key={p.id} value={p.id}>v{p.version} · {p.createdBy}</option>)}
            </select>
          </label>
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

function RunStartedNotice({ info }: { info: NonNullable<store.AppState['runStarted']> }) {
  useEffect(() => {
    const timer = setTimeout(() => store.dismissRunStarted(), 7000)
    return () => clearTimeout(timer)
  }, [info])
  return (
    <div className="run-notice" role="status">
      <span><b>{info.resumed ? 'Saved run opened.' : window.Understudy.getRunStartError?.() ? 'Run could not start.' : window.Understudy.currentRunId?.() ? 'Run started.' : 'Starting run…'}</b> {info.title}</span>
      <button className="ghost" aria-label="Dismiss run notification" onClick={() => store.dismissRunStarted()}>×</button>
    </div>
  )
}

function MyTasks({ state, goReviews }: { state: store.AppState; goReviews: () => void }) {
  const [, setTick] = useState(0)
  const [taskValues, setTaskValues] = useState<Record<string, Record<string, string | boolean>>>({})
  const [problemFor, setProblemFor] = useState<string | null>(null)
  const [problemText, setProblemText] = useState('')
  const [taskError, setTaskError] = useState('')
  const [cancelReviews, setCancelReviews] = useState(0)
  const action = useAction()
  const inputScope = useRef<{ map: UnderstudyProcessMap | null; runId?: string | null }>({ map: null })
  useEffect(() => {
    const f = () => {
      const map = window.Understudy.getLoadedProcess()
      const runId = window.Understudy.currentRunId?.()
      if (map !== inputScope.current.map || runId !== inputScope.current.runId) {
        setTaskValues({}); setTaskError(''); setProblemFor(null); setProblemText('')
        inputScope.current = { map, runId }
      }
      setTick((t) => t + 1)
    }
    f()
    window.addEventListener('understudy:mapchange', f)
    window.addEventListener('understudy:run-state', f)
    return () => {
      window.removeEventListener('understudy:mapchange', f)
      window.removeEventListener('understudy:run-state', f)
    }
  }, [])
  const proc = window.Understudy.getLoadedProcess?.()
  const prog = window.Understudy.getProgress?.() ?? []
  const runId = window.Understudy.currentRunId?.()
  const runError = window.Understudy.getRunStartError?.()
  const myRole = state.users.find((u) => u.username === state.actingAs)?.role
  if (!proc || prog.length === 0)
    return (
      <div className="empty-card"><h1>Your next step lives here.</h1><p>Teach a process from Start here, or run a saved playbook. Tasks will appear with their required evidence and owner.</p><button onClick={() => window.Understudy.openPanel?.()}>Open playbook</button></div>
    )
  if (!runId) {
    const starting = window.Understudy.isRunStarting?.()
    const start = () => action.run(async () => {
      if (!proc.sourceProcessId) return
      if (!cancelReviews) {
        const count = await store.cancellableReviewCount()
        if (count) { setCancelReviews(count); return }
      }
      setCancelReviews(0)
      await store.followPlaybook(proc.sourceProcessId)
    })
    return <div className="empty-card"><div className="eyebrow">SAVED PLAYBOOK</div><h1>{proc.title}</h1>
      <p>{starting ? 'Starting your run…' : 'Start a run to give each owner their task form. This execution will have its own results and review.'}</p>
      <ErrorNotice message={runError || action.error} />
      {proc.sourceProcessId && <button className="primary" disabled={action.busy || starting} onClick={() => void start()}>
        {starting ? 'Starting…' : cancelReviews ? `Confirm — start a new run and cancel ${cancelReviews} pending review(s)` : runError ? 'Retry starting this run' : 'Run this playbook →'}
      </button>}
    </div>
  }
  const stepOf = (id: string) => proc.steps.find((s) => s.id === id)
  const fieldDefs = proc.fields ?? []
  const attention = prog.filter((p) => p.status === 'ready' || p.status === 'blocked' || p.status === 'skipped')
  const mine = attention.filter((p) => !p.role || !myRole || p.role === myRole)
  const theirs = attention.filter((p) => p.role && myRole && p.role !== myRole)
  const work = prog.filter((p) => p.type !== 'decision')
  const done = work.filter((p) => p.done).length
  const required = work.filter(
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
  const complete = async (p: { id: string; fields?: string[] }) => {
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
          if (v === undefined || String(v).trim() === '') return [d.key, undefined]
          return [d.key, d.type === 'number' ? Number(v) : String(v).trim()]
        })
        .filter(([, v]) => v !== undefined),
    )
    const outcome = window.Understudy.completeStep?.(p.id, values)
    if (!outcome?.ok) { setTaskError(outcome?.error ?? 'Could not complete this task.'); return }
    await window.Understudy.flushRun?.()
    setTaskError('')
    rememberValues(values)
    setTaskValues((prev) => ({ ...prev, [p.id]: {} }))
  }
  return (
    <div className="list">
      <div className="page-intro"><div className="eyebrow">{myRole ?? 'YOUR WORK'}</div><h1>{proc.title}</h1><p>{done} of {required} required tasks complete · run #{runId}</p><progress value={done} max={Math.max(1, required)} aria-label="Required tasks complete" /></div>
      <ErrorNotice message={action.error || window.Understudy.getRunSyncError?.() || ''} />
      {window.Understudy.getRunSyncError?.() && <button disabled={action.busy} onClick={() => void action.run(() => window.Understudy.flushRun?.())}>Retry saving progress</button>}
      {state.reviewSync && state.reviewSync.runId === runId && <div className="card review-sync" role="status">
        {state.reviewSync.status === 'requesting' ? 'Preparing the review request…' : state.reviewSync.status === 'ready' ? 'Review requested — waiting for the assigned reviewer.' : <>
          <strong>Review request could not be sent.</strong><ErrorNotice message={state.reviewSync.message} />
          <button onClick={() => store.retryReview()}>Retry review request</button>
        </>}
      </div>}
      {(() => {
        const rejected = state.approvals.find(
          (a) =>
            a.status === 'REJECTED' &&
            state.worklogs.some(
              (w) => w.id === a.worklogId && w.status === 'rejected' && String(w.data.runId ?? '') === String(runId ?? ''),
            ),
        )
        if (!rejected) return null
        return (
          <div className="card entry task-card">
            <div className="entry-head">
              <span className="task">✏️ Review rejected — rework needed</span>
              <span className="status rejected">rejected</span>
            </div>
            {rejected.comment && <div className="meta">Reviewer: {rejected.comment}</div>}
            <div className="meta">
              Revise the entry on the Work log tab (add what changed), or resubmit directly:
            </div>
            <button
              className="primary"
              onClick={() =>
                void action.run(() => store.requestApproval(rejected.worklogId, 'lee'))
              }
              disabled={action.busy}
            >
              Resubmit for review
            </button>
          </div>
        )
      })()}
      {mine.length === 0 && theirs.length === 0 && (
        <div className="empty-card"><p>
          {window.Understudy.isRunComplete?.()
            ? '✅ Run complete — every required step is handled and signed off.'
            : 'The next route needs the desktop WebMCP agent. Your submitted evidence is ready to check.'}
        </p>{!window.Understudy.isRunComplete?.() && <AgentInvite hint="Ask your agent: “Do these results meet the rules? What should we do next?” It can check the evidence and explain the next step." label="Copy request to check the evidence" prompt="Read get_process_progress in Understudy. Use the submitted measurements and resolve_decision to choose the valid route. Explain any failed check and guide the assigned person through rework before requesting approval." />}</div>
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
          const value = raw[d.key]
          if (value === undefined || String(value).trim() === '') return Boolean(d.required)
          return (d.type === 'number' && !Number.isFinite(Number(value))) ||
            (d.type === 'select' && !d.options?.includes(String(value)))
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
                  ) : f.type === 'select' ? (
                    <label key={f.key}>
                      {f.label ?? f.key}{f.required ? '*' : ''}
                      <select required={f.required} value={String(raw[f.key] ?? '')}
                        onChange={(e) => setTaskValues({...taskValues, [p.id]: {...raw, [f.key]: e.target.value}})}>
                        <option value="">— choose an option —</option>
                        {(f.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label key={f.key}>
                      {f.label ?? f.key}
                      {f.unit ? ` (${f.unit})` : ''}
                      {f.required ? '*' : ''}
                      <input
                        type={f.type === 'number' ? 'number' : 'text'}
                        step={f.type === 'number' ? 'any' : undefined}
                        required={f.required}
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
            <ErrorNotice message={taskError} />
            {p.type === 'approval' ? (
              <button className="primary" onClick={goReviews} disabled={!state.approvals.some((a) => a.status === 'PENDING' && state.worklogs.some((w) => w.id === a.worklogId && String(w.data.runId) === String(runId)))}>
                Open Reviews to decide
              </button>
            ) : p.type === 'decision' ? (
              <div className="meta">Decision point — ask the desktop WebMCP agent to check the submitted evidence and choose the route.</div>
            ) : (
              <div className="decide">
                <button className="primary" disabled={action.busy || missingRequired || p.status !== 'ready' || !runId} onClick={() => void action.run(() => complete(p))}>
                  {p.status !== 'ready' ? 'Resolve the blocker first' : missingRequired ? 'Fill required fields…' : 'Complete & submit'}
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
                  disabled={action.busy || !problemText.trim()}
                  onClick={() => void action.run(async () => {
                    window.Understudy.reportProblem?.(p.id, problemText.trim())
                    await window.Understudy.flushRun?.()
                    setProblemText('')
                    setProblemFor(null)
                  })}
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
            <span className="task">{p.type === 'approval' && state.reviewSync && state.reviewSync.runId === runId && state.reviewSync.status !== 'ready'
              ? 'Review request needs attention' : `⏳ Waiting on ${p.role}`}</span>
          </div>
          <div className="meta">
            {p.label}
          </div>
          {state.users.find((u) => u.role === p.role) && <button className="secondary" onClick={() => store.switchActingAs(state.users.find((u) => u.role === p.role)!.username)}>Continue as {state.users.find((u) => u.role === p.role)!.name} · {p.role}</button>}
        </div>
      ))}
      <RunTimeline proc={proc} />
    </div>
  )
}

function RunTimeline({ proc }: { proc: UnderstudyProcessMap }) {
  const events: Array<{ ts: number; text: string; kind: 'step' | 'decision' }> = []
  for (const s of proc.steps) {
    if (!proc.events?.length && s.done && s.completedAt)
      events.push({ ts: s.completedAt, kind: 'step', text: `✓ ${s.label}${s.completedBy ? ` — ${s.completedBy}` : ''}` })
  }
  for (const e of proc.events ?? []) events.push({ts: e.ts, kind: 'step', text: `${e.kind === 'problem' ? '⚑ Problem' : e.kind === 'reopened' ? '↻ Retry' : '✓ Completed'}: ${e.label}${e.actor ? ` — ${e.actor}` : ''}${e.note ? ` · ${e.note}` : ''}${e.values && Object.keys(e.values).length ? ` · ${Object.entries(e.values).map(([k,v]) => `${k}: ${v}`).join(', ')}` : ''}`})
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
  const [tab, setTab] = useState<WorkspaceTab>('overview')
  const [demoMode, setDemoMode] = useState(false)
  const [resetArmed, setResetArmed] = useState(false)
  const reset = useAction()
  useWorkspaceUpdates()

  useEffect(() => { void store.refresh() }, [])
  // The evolving process beside the work is the desktop's primary experience.
  useEffect(() => {
    if (state.me && window.innerWidth >= 560) window.Understudy.openPanel?.()
  }, [state.me?.username])
  useEffect(() => {
    if (state.runStarted) {
      setTab('tasks')
      if (window.innerWidth >= 1000) window.Understudy.openPanel?.()
    }
  }, [state.runStarted])
  useEffect(() => { if (!state.me) { setTab('overview'); setResetArmed(false) } }, [state.me?.username])

  if (!state.authChecked) return <div className="loading-screen" role="status">Opening Understudy…</div>
  if (!state.me) return <Login />

  const pendingForMe = state.approvals.filter((a) => a.approver === state.actingAs && a.status === 'PENDING').length
  const interaction = window.Understudy.getInteractionState?.()
  const tabs: Array<[WorkspaceTab, string]> = [['overview', 'Start here'], ['tasks', 'My tasks'], ['approvals', 'Reviews'], ['playbooks', 'Playbooks'], ['incidents', 'Work log']]

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setTab('overview')} aria-label="Understudy home"><span className="brand-mark">u</span>Understudy</button>
        <div className="userbox">
          <label className="persona-label">Working as
            <select aria-label="Working as" value={state.actingAs} onChange={(e) => store.switchActingAs(e.target.value)}>
              {state.users.filter((u) => u.username !== 'judge').map((u) => <option key={u.username} value={u.username}>{u.name} · {u.role}</option>)}
            </select>
          </label>
          <details className="workspace-menu">
            <summary aria-label="Workspace settings">···</summary>
            <div className="workspace-menu-content">
              <p className="meta">Signed in as {state.me.name} · build {__BUILD__}</p>
              <label className="check"><input type="checkbox" checked={demoMode} onChange={(e) => setDemoMode(e.target.checked)} />Show role relay</label>
              <button className="secondary" onClick={() => store.logout()}>Sign out</button>
              <details className="reset-settings"><summary>Start a new work item</summary>
                <p className="meta">Clears the unsaved work and process draft in this tab. Saved records and other reviewers’ work stay available.</p>
                <button className="danger" disabled={reset.busy} onClick={() => {
                  if (!resetArmed) { setResetArmed(true); return }
                  void reset.run(async () => { await store.startFreshWorkspace(); setResetArmed(false); setTab('overview') })
                }}>{reset.busy ? 'Saving progress…' : resetArmed ? 'Confirm — start fresh in this tab' : 'Start fresh in this tab…'}</button>
                {resetArmed && <button className="ghost" onClick={() => setResetArmed(false)}>Cancel</button>}
                <ErrorNotice message={reset.error} />
              </details>
            </div>
          </details>
        </div>
      </header>
      <nav className="tabs" aria-label="Workspace">
        {tabs.map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}{id === 'approvals' && pendingForMe > 0 && <span className="pill">{pendingForMe}</span>}</button>)}
      </nav>
      <p className="mobile-scope">On mobile: enter your assigned task results and review requests. Use your desktop WebMCP agent to build processes and resolve decision branches.</p>
      {state.runStarted && <RunStartedNotice info={state.runStarted} />}
      {demoMode && <DemoStrip state={state} />}
      {tab !== 'overview' && interaction && (interaction.questions > 0 || interaction.approvals > 0) && <button className="attention-banner" onClick={() => window.Understudy.openPanel?.()}>Your agent needs your input <span>Open conversation →</span></button>}
      <main id="workspace-main">
        {tab === 'overview' && <Overview state={state} navigate={setTab} />}
        {tab === 'tasks' && <MyTasks state={state} goReviews={() => setTab('approvals')} />}
        {tab === 'incidents' && <><div className="page-intro"><h1>Work log</h1><p>Record work and results. To teach a new process, start with the guided capture on <button className="text-button" onClick={() => setTab('overview')}>Start here</button>.</p></div><SuggestionCard /><IncidentForm /><IncidentList state={state} /></>}
        {tab === 'approvals' && <ApprovalsInbox state={state} />}
        {tab === 'playbooks' && <PlaybookList state={state} />}
      </main>
    </div>
  )
}
