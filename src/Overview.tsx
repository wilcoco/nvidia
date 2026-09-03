import { useEffect, useState } from 'react'
import * as store from './store'
import { AgentInvite, ErrorNotice, useAction } from './ui'
import SuggestionCard from './SuggestionCard'

export type WorkspaceTab = 'overview' | 'incidents' | 'tasks' | 'approvals' | 'playbooks'
const EXAMPLE = 'I ran a customer-table migration on staging. Before release, we need to compare row counts, fix any differences, and get a reviewer’s sign-off.'
const JOURNEY = ['Describe your work', 'Ask what comes before & after', 'Agree on the process', 'Follow it by role', 'Reuse it next time']

export default function Overview({ state, navigate }: { state: store.AppState; navigate: (tab: WorkspaceTab) => void }) {
  const [editing, setEditing] = useState(true)
  const [note, setNote] = useState('')
  const [sample, setSample] = useState(false)
  const captured = state.captureContext
  const action = useAction()
  const proc = window.Understudy.getLoadedProcess()
  const runId = window.Understudy.currentRunId?.()
  const done = window.Understudy.isRunComplete?.() === true
  const interaction = window.Understudy.getInteractionState?.()
  const decision = window.Understudy.getPendingDecision?.()
  const progress = window.Understudy.getProgress?.() ?? []
  const ready = progress.find((p) => p.status === 'ready' || p.status === 'blocked')
  const saved = proc ? store.latestPerTitle(state.processes).find((p) => p.title === proc.title) : undefined
  const contributor = state.users.find((u) => u.role === 'Contributor')
  const acting = state.users.find((u) => u.username === state.actingAs)
  useEffect(() => {
    if (editing && !proc && !captured) store.setDraftContext({kind: sample ? 'development' : undefined, task: note, hasInput: Boolean(note.trim())})
  }, [editing, sample, note, proc, captured])

  const capture = () => action.run(async () => {
    if (!note.trim()) return
    if (window.Understudy.currentRunId?.() && !window.Understudy.isRunComplete?.()) {
      throw new Error('An execution is in progress. Finish it before starting a new teaching session.')
    }
    const work = await store.createWorklog({
      date: new Date().toISOString().slice(0, 10), line: 'A', kind: sample ? 'development' : 'routine work',
      task: note.trim(), hours: 0, note: '', urgent: false, data: sample ? { example: true } : {},
    })
    store.requestPlaybookCreation(work)
    setEditing(false)
    window.Understudy.openPanel?.()
  })

  return (
    <div className="overview">
      <section className={`hero${proc || captured ? ' compact' : ''}`}>
        <div className="eyebrow">HUMAN + AGENT · POWERED BY WEBMCP</div>
        <h1>{proc ? done ? 'Good work. Ready to reuse.' : 'One step at a time.' : captured ? 'Your work, made repeatable.' : <>One task.<br /><span>The whole workflow.</span></>}</h1>
        <p className="hero-description">Start with what you’re working on. Your agent asks what should happen before and after, learns the rules, and builds a process with you. Each person follows their steps. When similar work comes up, choose a relevant playbook and use it again.</p>
        <div className="chat-first"><span>New here? Ask in your agent’s chat:</span><strong>“What is this, and how do I use it?”</strong><p>No special prompt needed. Your agent can read this page through WebMCP and help you choose where to start.</p></div>
        <ol className="journey" aria-label="How Understudy works">
          {JOURNEY.map((label, i) => <li key={label}><span>{i + 1}</span>{label}</li>)}
        </ol>
      </section>

      {interaction && (interaction.questions > 0 || interaction.approvals > 0) && (
        <button className="attention-banner" onClick={() => window.Understudy.openPanel?.()}>
          <span><b>Your input is needed</b> · {interaction.questions > 0 ? `${interaction.questions} question(s) from your agent` : `${interaction.approvals} action(s) awaiting permission`}</span>
          <span>Open conversation →</span>
        </button>
      )}

      {proc ? (
        <section className="card current-work">
          <div className="eyebrow">{done ? 'COMPLETED RUN' : !proc.confirmed ? 'TEACH & REFINE' : !runId ? 'READY TO PUT TO WORK' : decision ? 'CHECK THE EVIDENCE' : ready?.type === 'approval' ? 'REVIEW & SIGN OFF' : 'WORK IN PROGRESS'}</div>
          <h2>{proc.title}</h2>
          <p>{done ? 'The required work is complete. Your submitted evidence and approval are saved with this run.'
            : !proc.confirmed ? 'Your agent has drafted the process. Open the playbook, correct a step, and confirm it when it reflects how you work.'
              : !runId ? 'Your playbook is confirmed. Start an execution to collect evidence and put its rules into practice.'
                : decision ? `“${decision.label}” needs a decision. Ask your agent to check the submitted values and take the matching branch. Failed evidence should lead to rework.`
                  : ready ? `Next: ${ready.label}${ready.role ? ` · ${ready.role}` : ''}. Open your tasks to see the required inputs and who acts next.`
                    : 'Open your tasks to see what this execution is waiting for.'}</p>
          <div className="button-row">
            {!proc.confirmed ? <button className="primary" onClick={() => window.Understudy.openPanel?.()}>Review the draft →</button>
              : !runId && saved ? <button className="primary" disabled={action.busy} onClick={() => void action.run(() => store.followPlaybook(saved.id))}>{action.busy ? 'Starting…' : 'Run this playbook →'}</button>
                : runId ? <button className="primary" onClick={() => navigate('tasks')}>{done ? 'View the completed run' : 'Continue to my tasks →'}</button>
                  : <span className="meta">Saving the playbook…</span>}
            <button className="secondary" onClick={() => window.Understudy.openPanel?.()}>Open playbook</button>
            {done && <button className="ghost" onClick={() => { window.Understudy.unloadProcess?.(); store.clearCaptureContext(); setEditing(true) }}>Teach another process</button>}
          </div>
          {decision && <AgentInvite hint="Ask your agent: “Do these results meet the rules? What should we do next?” It can check the evidence and explain the next step." label="Copy evidence-check request" prompt={`Use Understudy on this page. Read get_process_progress and the submitted evidence for “${decision.label}”. Check the recorded criteria with resolve_decision. If the evidence fails, take the rework branch and explain the next task. Do not replace submitted measurements with an assumed passing value.`} />}
          <ErrorNotice message={action.error || window.Understudy.getRunStartError?.() || ''} />
          {done && <p className="hint">Found a missing step or exception? Open the playbook and choose “Propose changes”. Tell your agent what you learned, review the changes, and save a new version for the next person.</p>}
        </section>
      ) : captured ? (
        <section className="card current-work">
          <div className="eyebrow">{captured.creationRequested ? 'NEW PLAYBOOK · WORK CAPTURED' : 'YOUR STARTING POINT IS SAVED'}</div>
          <h2>What belongs before and after this work?</h2>
          <blockquote>{captured.task}</blockquote>
          {captured.creationRequested ? <p>Your work is saved and your request is available to your agent. Next: answer its questions, review the draft, and save your new playbook.</p> : <><SuggestionCard includeCandidates /><button className="primary" onClick={() => store.requestPlaybookCreation(captured)}>Create a new playbook from this work →</button></>}
          <AgentInvite hint="In your agent’s chat, ask “Help me build the process around this work.” It can read your starting point and ask about the missing steps here." prompt={`Work with me in Understudy. Read work log #${captured.id}: “${captured.task}”. ${captured.creationRequested ? 'I chose to create a NEW playbook from this work.' : 'Check for relevant existing playbooks and let me choose between reuse and a new one.'} Ask me one question at a time with ask_user: what must happen before this work, what must follow, who owns each step, and what rules, exceptions and sign-off apply? Draft a process from my answers, encode stated thresholds as criteria, and let me correct and confirm it. Then guide the assigned people through execution. Do not invent answers or mark steps complete for me.`} />
          <button className="ghost" onClick={() => window.Understudy.openPanel?.()}>Open the conversation panel</button>
        </section>
      ) : (
        <section className="start-grid">
          <div className="card capture-card">
            <div className="eyebrow">START WITH ONE PIECE OF WORK</div>
            <h2>What did you do?<br />What should happen next?</h2>
            <p>A sentence is enough. Discover the preparation, next steps and owners around your work, or choose a related playbook to follow.</p>
            {editing ? <form onSubmit={(e) => { e.preventDefault(); void capture() }}>
              <label htmlFor="capture-note">{sample ? 'Release example · fictional sample' : 'Describe your work'}</label>
              <textarea id="capture-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="We finished… Before someone signs off, we need to…" required />
              {acting?.role !== 'Contributor' ? <button type="button" className="primary" disabled={!contributor} onClick={() => contributor && store.switchActingAs(contributor.username)}>Continue as {contributor?.name ?? 'Contributor'}</button>
                : <button className="primary" disabled={action.busy || !note.trim()}>{action.busy ? 'Saving your starting point…' : 'Create a new playbook →'}</button>}
              <p className="meta">Work → questions & answers → draft → your confirmation.</p>
              <ErrorNotice message={action.error} />
            </form> : <div className="button-row"><button className="primary" onClick={() => { setEditing(true); setSample(false) }}>Teach from my work →</button></div>}
            {editing && note.trim() && <SuggestionCard includeCandidates />}
          </div>
          <div className="example-card">
            <div className="eyebrow">TRY ONE CONCRETE EXAMPLE</div>
            <h2>Ready for release?</h2>
            <p>A staging migration looks finished. A row-count mismatch says otherwise.</p>
            <div className="example-proof" aria-label="Illustrative release check">
              <div><span>Release rule</span><b>0 mismatched rows</b></div>
              <div className="example-failure"><span>Example measurement</span><b>12 mismatches</b></div>
              <div><span>Next step</span><b>Fix → recheck → review</b></div>
            </div>
            <p className="example-caption">Illustrative scenario. You and your agent define and run the actual playbook.</p>
            <button className="secondary" onClick={() => { setNote(EXAMPLE); setSample(true); setEditing(true) }}>Use this example →</button>
          </div>
        </section>
      )}

      <section className="overview-bottom">
        <div><b>Discover the work around the work.</b><p>Answer questions about preparation, next steps and who takes over. Correct the process together.</p></div>
        <div><b>Follow it. Find it again.</b><p>Each owner gets their next step. Related playbooks are suggested when similar work comes up — you choose what to use.</p></div>
        <button className="library-link" onClick={() => navigate('playbooks')}>Browse {store.latestPerTitle(state.processes).length || ''} saved playbooks <span>→</span></button>
      </section>
      <p className="workspace-footnote">Demo workspace · sample accounts and data · {interaction?.connected ? 'WebMCP ready for your agent' : 'Connect a WebMCP-capable agent to teach and resolve decisions'}</p>
    </div>
  )
}
