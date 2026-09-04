import { useEffect, useState } from 'react'
import * as store from './store'
import { AgentInvite, ErrorNotice, useAction } from './ui'
import SuggestionCard from './SuggestionCard'
import DiscoveryStart from './DiscoveryStart'
import { EXAMPLE_WORK } from '../sdk/discovery'
import RunPicker from './RunPicker'

export type WorkspaceTab = 'overview' | 'incidents' | 'tasks' | 'approvals' | 'playbooks'

function PausedDrafts({state}: {state: store.AppState}) {
  const loaded = window.Understudy.getLoadedProcess?.()
  const loadedKey = loaded?.sourceWorklogId ? `worklog:${loaded.sourceWorklogId}` : loaded ? `draft:${loaded.title}` : ''
  const activeCaptureKey = state.captureContext?.id ? `worklog:${state.captureContext.id}` : ''
  const drafts = state.pausedDrafts.filter(draft => draft.key !== loadedKey && draft.key !== activeCaptureKey)
  if (!drafts.length) return null
  return <section className="card paused-drafts">
    <div className="eyebrow">CONTINUE WHERE YOU LEFT OFF</div>
    <h2>Paused process drafts · {drafts.length}</h2>
    <p>These drafts and their interview answers are kept in this browser tab. They are not saved team playbooks yet.</p>
    <div className="paused-draft-list">{drafts.map(draft => {
      const answers = draft.map?.steps.reduce((total, step) => total + (step.elicitation?.answers.length ?? 0), 0) ?? 0
      return <div className="paused-draft" key={draft.key}>
        <div><b>{draft.map?.sourceWorklogId ?? draft.captureContext?.id ? `Work log #${draft.map?.sourceWorklogId ?? draft.captureContext?.id}` : 'Unsaved draft'} · {draft.title}</b>
          <blockquote>{draft.task}</blockquote>
          <span>{answers ? `${answers} expert answer${answers === 1 ? '' : 's'} captured` : 'Draft started'} · paused {new Date(draft.pausedAt).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})}</span></div>
        <button className="secondary" onClick={() => { if (store.resumePausedDraft(draft.key)) window.Understudy.openPanel?.() }}>Continue editing →</button>
      </div>
    })}</div>
  </section>
}

export default function Overview({ state, navigate }: { state: store.AppState; navigate: (tab: WorkspaceTab) => void }) {
  const [editing, setEditing] = useState(() => !window.Understudy.getLoadedProcess?.() && !state.captureContext)
  const {task: note, sample} = state.captureDraft
  const setNote = (task: string) => store.setCaptureDraft(task, sample)
  const captured = state.captureContext
  const action = useAction()
  const proc = window.Understudy.getLoadedProcess()
  const evidenceOnly = proc?.draftMode === 'evidence-only'
  const runId = window.Understudy.currentRunId?.()
  const runNotice = window.Understudy.getRunStartError?.() || ''
  const retired = runNotice.startsWith('This run was retired by a newer execution.')
  const done = window.Understudy.isRunComplete?.() === true
  const interaction = window.Understudy.getInteractionState?.()
  const decision = window.Understudy.getPendingDecision?.()
  const progress = window.Understudy.getProgress?.() ?? []
  const ready = progress.find((p) => p.status === 'ready' || p.status === 'blocked')
  const saved = proc ? store.latestPerTitle(state.processes).find((p) => p.title === proc.title) : undefined
  const contributor = state.users.find((u) => u.role === 'Contributor')
  const acting = state.users.find((u) => u.username === state.actingAs)
  const captureKind = state.worklogs.find((work) => work.id === captured?.id)?.kind ?? (sample ? 'operations' : 'routine work')
  const sourceWork = state.worklogs.find(work => work.id === proc?.sourceWorklogId)
  const sourceAnswers = proc?.steps.reduce((total, step) => total + (step.elicitation?.answers.length ?? 0), 0) ?? 0
  const activeRunBlocksCapture = Boolean(runId && !done)
  useEffect(() => {
    // Restored, selected and newly drafted processes own the workspace until
    // the visitor explicitly chooses to teach separate work.
    if (proc || captured) setEditing(false)
  }, [proc, captured])
  useEffect(() => {
    if (editing && !proc) store.setDraftContext({kind: captureKind, task: captured?.task ?? note, hasInput: Boolean((captured?.task ?? note).trim())})
  }, [editing, captureKind, note, proc, captured])

  const beginNewWork = () => {
    store.pauseCurrentDraft()
    // Detach the work-log context before clearMap emits its synchronous event;
    // otherwise that event can overwrite the just-paused map with an empty one.
    store.clearCaptureContext()
    window.Understudy.unloadProcess?.()
    setEditing(true)
    window.Understudy.openPanel?.()
  }

  const capture = () => action.run(async () => {
    if (!note.trim()) return
    if (activeRunBlocksCapture) {
      throw new Error('An execution is in progress. Finish it before starting a new teaching session.')
    }
    store.pauseCurrentDraft()
    const work = await store.createWorklog({
      date: new Date().toISOString().slice(0, 10), line: 'A', kind: sample ? 'operations' : 'routine work',
      task: note.trim(), hours: 0, note: '', urgent: false, data: sample ? { example: true } : {},
    })
    if (proc) window.Understudy.unloadProcess?.()
    store.requestPlaybookCreation(work)
    store.resetCaptureDraft()
    setEditing(false)
    window.Understudy.openPanel?.()
  })

  const newWorkEntry = <section className="card capture-card start-primary">
    <div className="eyebrow">START A NEW WORK ENTRY</div>
    <h2>What are you working on?</h2>
    <p>One sentence is enough. It is also saved in Work records as the source for this process. Any unfinished draft below is paused with its captured answers, not deleted.</p>
    <form onSubmit={(e) => { e.preventDefault(); void capture() }}>
      <div className="capture-label-row"><label htmlFor="capture-note">{sample ? 'Delivery example · fictional sample' : 'Describe your work'}</label>
        <button type="button" className="ghost example-link" onClick={() => { store.setCaptureDraft(EXAMPLE_WORK, true); setEditing(true) }}>Use the delivery example</button></div>
      <textarea id="capture-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: I am preparing a customer order for delivery." required />
      {acting?.role !== 'Contributor' ? <button type="button" className="primary" disabled={!contributor} onClick={() => contributor && store.switchActingAs(contributor.username)}>Continue as {contributor?.name ?? 'Contributor'}</button>
        : <button className="primary" disabled={action.busy || !note.trim() || activeRunBlocksCapture}>{action.busy ? 'Saving your starting point…' : activeRunBlocksCapture ? 'Finish the active run before teaching new work' : 'Start with the first question →'}</button>}
      <p className="meta">Answer a starter question here, then continue with your browser’s AI agent.</p>
      <ErrorNotice message={action.error} />
    </form>
  </section>

  return (
    <div className="overview">
      <section className="hero">
        <div className="eyebrow">FROM YOUR WORK TO A TEAM PROCESS · WEBMCP</div>
        <h1>Your work, <span>turned into a team process.</span></h1>
        <p className="hero-description">Your AI agent asks what comes before and after, and who does each part. You correct the process, your team follows it, and the next person can reuse it.</p>
        {!proc && !captured ? <div className="chat-entry">
          <div><span>WELCOME · START HERE OR ASK IN YOUR AI CHAT</span>
            <b>Hi — what would you like to do?</b><p>Start from one task, run a saved playbook, or ask “What is this?” in the AI chat that opened this tab.</p></div>
          <div className="first-actions">
            <button className="primary" onClick={() => document.getElementById('capture-note')?.focus()}>Describe a task</button>
            <button className="secondary" onClick={() => navigate('playbooks')}>Use a playbook</button>
            <button className="ghost" onClick={() => window.Understudy.openUsageGuide?.()}>Show me around</button>
          </div>
        </div> : <button className="ghost" onClick={() => window.Understudy.openUsageGuide?.()}>How to use Understudy</button>}
      </section>

      {interaction && (interaction.questions > 0 || interaction.approvals > 0) && (
        <button className="attention-banner" onClick={() => window.Understudy.openPanel?.()}>
          <span><b>Your input is needed</b> · {interaction.questions > 0 ? `${interaction.questions} question(s) from your agent` : `${interaction.approvals} action(s) awaiting permission`}</span>
          <span>Open conversation →</span>
        </button>
      )}

      {!proc && !captured && newWorkEntry}
      <PausedDrafts state={state} />

      {proc ? (
        <section className="card current-work">
          {!proc.confirmed && <div className="continue-context"><b>{sourceWork ? `Continue draft from work log #${sourceWork.id}` : 'Continue this unfinished draft'}</b>
            {sourceWork && <blockquote>{sourceWork.task}</blockquote>}
            <span>{sourceAnswers ? `${sourceAnswers} expert answer${sourceAnswers === 1 ? '' : 's'} captured` : 'Draft in progress'} · Continue editing below, or start a separate entry above.</span></div>}
          <div className="eyebrow">{evidenceOnly ? 'EVIDENCE-ONLY STARTER · NOT RUNNABLE' : retired ? 'ARCHIVED RUN' : done ? 'COMPLETED RUN' : !proc.confirmed ? 'TEACH & REFINE' : !runId ? 'READY TO PUT TO WORK' : decision ? 'CHECK THE EVIDENCE' : ready?.type === 'approval' ? 'REVIEW & SIGN OFF' : 'WORK IN PROGRESS'}</div>
          <h2>{proc.title}</h2>
          <p>{evidenceOnly ? 'A starter draft was created only from your work and answers. It preserves evidence but does not infer runnable steps, owners, fields, branches or approvals.'
            : retired ? 'A newer execution replaced this unfinished run. Its history is preserved; start a fresh run or open an active run below.'
            : done ? 'The required work is complete. Your submitted evidence and approval are saved with this run.'
            : !proc.confirmed ? 'Your agent has drafted the process. Open the playbook, correct a step, and confirm it when it reflects how you work.'
              : !runId ? 'Your playbook is confirmed. Start an execution to collect evidence and put its rules into practice.'
                : decision ? `“${decision.label}” needs a decision. Ask your agent to check the submitted values and take the matching branch. Failed evidence should lead to rework.`
                  : ready ? `Next: ${ready.label}${ready.role ? ` · ${ready.role}` : ''}. Open your tasks to see the required inputs and who acts next.`
                    : 'Open your tasks to see what this execution is waiting for.'}</p>
          <div className="button-row">
            {!proc.confirmed ? <button className="primary" onClick={() => window.Understudy.openPanel?.()}>{evidenceOnly ? 'Review captured evidence →' : 'Review the draft →'}</button>
              : !runId && saved ? <button className="primary" disabled={action.busy} onClick={() => void action.run(() => store.followPlaybook(saved.id))}>{action.busy ? 'Starting…' : retired ? 'Start a new run →' : 'Run this playbook →'}</button>
                : runId ? <button className="primary" onClick={() => navigate('tasks')}>{done ? 'View the completed run' : 'Continue to my tasks →'}</button>
                  : <span className="meta">Saving the playbook…</span>}
            <button className="secondary" onClick={() => window.Understudy.openPanel?.()}>Open playbook</button>
            {!activeRunBlocksCapture && <button className="ghost" onClick={beginNewWork}>{done ? 'Teach another process' : 'Start a separate work entry'}</button>}
          </div>
          {evidenceOnly && <AgentInvite label="Copy request to structure this evidence" hint="Connect a WebMCP agent to turn the captured source into a concrete process. You will still review and save the result." prompt="Use Understudy on this page. Read get_process_map and get_map_gaps. This is an evidence-only starter: preserve its source answers, then replace the placeholder map with specific steps, owners, required inputs, decisions, recovery routes and human sign-off supported by those answers. Keep any existing step id that carries elicitation evidence on the corresponding replacement step so its provenance remains attached. Ask one question at a time for anything missing. Do not invent rules or start execution. Leave the runnable draft for my review and one Save." />}
          {decision && <AgentInvite hint="Ask your agent: “Do these results meet the rules? What should we do next?” It can check the evidence and explain the next step." label="Copy evidence-check request" prompt={`Use Understudy on this page. Read get_process_progress and the submitted evidence for “${decision.label}”. Check the recorded criteria with resolve_decision. If the evidence fails, take the rework branch and explain the next task. Do not replace submitted measurements with an assumed passing value.`} />}
          <ErrorNotice message={action.error || (retired ? '' : runNotice)} />
          {retired && <p className="hint">Archived executions are read-only. Choose an active run below to continue existing work.</p>}
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
        <div className="reuse-entry">
          <div><b>Doing work your team has done before?</b><p>Describe it above to find related playbooks, or choose one from the library.</p></div>
          <button className="secondary" onClick={() => navigate('playbooks')}>Use an existing playbook →</button>
        </div>
      )}

      {note.trim() && <SuggestionCard includeCandidates />}

      {!captured?.creationRequested && <RunPicker onOpened={() => navigate('tasks')} />}
      {(proc || (captured && !captured.creationRequested)) && <section className="overview-bottom">
        <div><b>Discover the work around the work.</b><p>Answer questions about preparation, next steps and who takes over. Correct the process together.</p></div>
        <div><b>Follow it. Find it again.</b><p>Each owner gets their next step. Related playbooks are suggested when similar work comes up — you choose what to use.</p></div>
        <button className="library-link" onClick={() => navigate('playbooks')}>Browse {store.latestPerTitle(state.processes).length || ''} saved playbooks <span>→</span></button>
      </section>}
      <p className="workspace-footnote">Demo workspace · sample accounts and data · {interaction?.active ? 'WebMCP agent connected'
        : interaction?.registered ? 'WebMCP tools registered · awaiting an agent call'
          : 'On-page starter draft available without an agent'} · SDK {interaction?.sdkBuild ?? 'unversioned'}</p>
    </div>
  )
}
