import { useEffect, useState } from 'react'
import * as store from './store'
import { AgentInvite, ErrorNotice, useAction } from './ui'
import SuggestionCard from './SuggestionCard'
import DiscoveryStart from './DiscoveryStart'
import { EXAMPLE_WORK } from '../sdk/discovery'
import RunPicker from './RunPicker'

export type WorkspaceTab = 'overview' | 'incidents' | 'tasks' | 'approvals' | 'playbooks'

export default function Overview({ state, navigate }: { state: store.AppState; navigate: (tab: WorkspaceTab) => void }) {
  const [editing, setEditing] = useState(true)
  const {task: note, sample} = state.captureDraft
  const setNote = (task: string) => store.setCaptureDraft(task, sample)
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
  const captureKind = state.worklogs.find((work) => work.id === captured?.id)?.kind ?? (sample ? 'operations' : 'routine work')
  useEffect(() => {
    if (editing && !proc) store.setDraftContext({kind: captureKind, task: captured?.task ?? note, hasInput: Boolean((captured?.task ?? note).trim())})
  }, [editing, captureKind, note, proc, captured])

  const capture = () => action.run(async () => {
    if (!note.trim()) return
    if (window.Understudy.currentRunId?.() && !window.Understudy.isRunComplete?.()) {
      throw new Error('An execution is in progress. Finish it before starting a new teaching session.')
    }
    const work = await store.createWorklog({
      date: new Date().toISOString().slice(0, 10), line: 'A', kind: sample ? 'operations' : 'routine work',
      task: note.trim(), hours: 0, note: '', urgent: false, data: sample ? { example: true } : {},
    })
    store.requestPlaybookCreation(work)
    setEditing(false)
    window.Understudy.openPanel?.()
  })

  return (
    <div className="overview">
      <section className={`hero${proc || captured ? ' compact' : ''}`}>
        <div className="eyebrow">FROM YOUR WORK TO A TEAM PROCESS · WEBMCP</div>
        <h1>{proc ? done ? 'Good work. Ready to reuse.' : 'One step at a time.' : captured ? 'Build the process around your work.' : <>Your work, <span>turned into a team process.</span></>}</h1>
        <p className="hero-description">Your AI agent asks what comes before and after, and who does each part. You correct the process, your team follows it, and the next person can reuse it.</p>
        {!proc && !captured ? <div className="chat-entry">
          <div><span>NEW HERE? ASK IN THE AI CHAT THAT OPENED THIS TAB</span>
            <b>“What is this, and how do I use it?”</b><p>Your agent explains and opens the guide on this page.</p></div>
          <button className="secondary" onClick={() => window.Understudy.openUsageGuide?.()}>Open usage guide</button>
        </div> : <button className="ghost" onClick={() => window.Understudy.openUsageGuide?.()}>How to use Understudy</button>}
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
      ) : captured?.creationRequested ? <DiscoveryStart state={state} /> : captured ? (
        <section className="card current-work">
          <div className="eyebrow">YOUR STARTING POINT IS SAVED</div>
          <h2>What belongs before and after this work?</h2>
          <blockquote>{captured.task}</blockquote>
          <p>Choose a related playbook to run, or build a new one from this work.</p>
          <SuggestionCard includeCandidates />
          <button className="primary" onClick={() => store.requestPlaybookCreation(captured)}>Make a new playbook · start with a question →</button>
        </section>
      ) : (
        <section className="start-grid">
          <div className="card capture-card">
            <div className="eyebrow">MAKE A NEW PLAYBOOK</div>
            <h2>What are you working on?</h2>
            <p>One sentence is enough. We’ll start with what needs to happen before it.</p>
            {editing ? <form onSubmit={(e) => { e.preventDefault(); void capture() }}>
              <div className="capture-label-row"><label htmlFor="capture-note">{sample ? 'Delivery example · fictional sample' : 'Describe your work'}</label>
                <button type="button" className="ghost example-link" onClick={() => { store.setCaptureDraft(EXAMPLE_WORK, true); setEditing(true) }}>Use the delivery example</button></div>
              <textarea id="capture-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: I am preparing a customer order for delivery." required />
              {acting?.role !== 'Contributor' ? <button type="button" className="primary" disabled={!contributor} onClick={() => contributor && store.switchActingAs(contributor.username)}>Continue as {contributor?.name ?? 'Contributor'}</button>
                : <button className="primary" disabled={action.busy || !note.trim()}>{action.busy ? 'Saving your starting point…' : 'Start with the first question →'}</button>}
              <p className="meta">Answer a starter question here, then continue with your browser’s AI agent.</p>
              <ErrorNotice message={action.error} />
            </form> : <div className="button-row"><button className="primary" onClick={() => { setEditing(true); store.setCaptureDraft(note, false) }}>Teach from my work →</button></div>}
            {editing && note.trim() && <SuggestionCard includeCandidates />}
          </div>
          <div className="reuse-entry">
            <div><b>Doing work your team has done before?</b><p>Describe it above to find related playbooks, or choose one from the library.</p></div>
            <button className="secondary" onClick={() => navigate('playbooks')}>Use an existing playbook →</button>
          </div>
        </section>
      )}

      <RunPicker onOpened={() => navigate('tasks')} />
      {(proc || captured) && <section className="overview-bottom">
        <div><b>Discover the work around the work.</b><p>Answer questions about preparation, next steps and who takes over. Correct the process together.</p></div>
        <div><b>Follow it. Find it again.</b><p>Each owner gets their next step. Related playbooks are suggested when similar work comes up — you choose what to use.</p></div>
        <button className="library-link" onClick={() => navigate('playbooks')}>Browse {store.latestPerTitle(state.processes).length || ''} saved playbooks <span>→</span></button>
      </section>}
      <p className="workspace-footnote">Demo workspace · sample accounts and data · {interaction?.connected ? 'WebMCP tools available' : 'Use a browser with WebMCP and an AI agent to continue the interview'}</p>
    </div>
  )
}
