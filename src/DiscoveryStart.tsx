import * as store from './store'
import { FOLLOWUP_QUESTION, STARTER_QUESTION, discoveryInvite } from '../sdk/discovery'
import { AgentInvite, ErrorNotice, useAction } from './ui'

export default function DiscoveryStart({state, onStartSeparate}: {state: store.AppState; onStartSeparate: () => void}) {
  const action = useAction()
  const captured = state.captureContext!
  const work = state.worklogs.find(w => w.id === captured.id)
  const before = work?.data.discovery?.before
  const after = work?.data.discovery?.after
  const interaction = window.Understudy.getInteractionState?.()
  const questions = interaction?.questions ?? 0
  const interviewStarted = (interaction?.interview?.asked ?? 0) > 0
  const prompt = discoveryInvite({worklogId: captured.id, task: captured.task, discovery: work?.data.discovery}, window.location.href)
  const offerBeforeHelp = !before && !captured.starterSkipped && !questions && !interviewStarted
  const offerAfterHelp = Boolean(before && !after && !captured.afterSkipped && !questions && !interviewStarted)
  const openStarterDraft = () => window.Understudy.draftProcess?.({
    title: `Evidence-only starter · work log #${captured.id}`,
    sourceWorklogId: captured.id,
    elicitationVersion: 1,
    draftMode: 'evidence-only',
    steps: [
      {id: 'prepare', label: 'Prepare the work', type: 'task', humanOnly: true,
        detail: before?.answer || 'Preparation still needs to be described.', next: [{to: 'work'}]},
      {id: 'work', label: 'Perform the recorded work', type: 'task', humanOnly: true,
        detail: captured.task, next: [{to: 'handoff'}]},
      {id: 'handoff', label: 'Define the next handoff', type: 'task', humanOnly: true, next: []},
    ],
  })

  return <section className="card current-work discovery-start">
    <div className="eyebrow">{questions ? 'YOUR AGENT HAS A QUESTION' : interaction?.active ? 'CONTINUE IN YOUR AI CHAT' : interviewStarted ? 'DRAFT EVIDENCE SAVED' : 'WORK SAVED · CHAT IS THE MAIN PATH'}</div>
    <h2>{questions ? 'Your agent needs one answer.' : 'Keep building this process in your AI chat.'}</h2>
    <blockquote>{captured.task}</blockquote>
    <p className="chat-primary-status" role="status" aria-live="polite">{questions
      ? 'This question came from your agent. Use the page card to preserve the answer with the playbook, or tell your agent to skip it.'
      : 'Your starting point is saved. Continue normally in the AI chat that opened this page; the process will grow on the right. The page prompts below are optional helpers.'}</p>

    {questions ? <button className="primary" onClick={() => window.Understudy.openPanel?.()}>Open your agent’s question →</button>
      : interaction?.active ? <><p className="waiting-agent">Connected. Keep talking in your AI chat. Understudy will show the agent’s next question or draft beside the page.</p>
        <button type="button" className="ghost" onClick={onStartSeparate}>Start a separate work entry</button></>
        : interviewStarted ? <details className="intro-help"><summary>Resume this process in your AI chat</summary><AgentInvite prompt={prompt} /></details>
          : <AgentInvite prompt={prompt} label="Copy request for my AI chat" hint="Continue in the AI chat that opened this page. Ask your agent to read this saved work, fill in only what is missing, and grow the process for your review." />}

    {(before || after) && <div className="optional-saved-context">
      <p className="optional-label">OPTIONAL PAGE CONTEXT</p>
      {before && <details className="saved-answer"><summary>✓ What happens before · SAVED</summary><p>{before.answer}</p></details>}
      {after && <details className="saved-answer"><summary>✓ What happens after · SAVED</summary><p>{after.answer}</p></details>}
    </div>}

    {offerBeforeHelp && <details className="optional-page-help">
      <summary>Optional page help · add what happens before</summary>
      <p>You can ignore this and keep going in chat. Use it only if answering a structured prompt on this page would help.</p>
      <form onSubmit={e => { e.preventDefault(); void action.run(() => store.saveStarterAnswer(captured.id, captured.answerDraft ?? '', 'before')) }}>
        <label htmlFor="starter-answer">Add preparation context (optional)</label>
        <p className="prompt-question">{STARTER_QUESTION}</p>
        <textarea id="starter-answer" rows={3} maxLength={4000} disabled={action.busy}
          value={captured.answerDraft ?? ''} onChange={e => store.setStarterDraft(e.target.value)}
          placeholder="For example: Sales confirms the order quantity and delivery date." required />
        <button className="secondary" disabled={action.busy || !captured.answerDraft?.trim()}>{action.busy ? 'Saving note…' : 'Save optional note'}</button>
        <ErrorNotice message={action.error} />
      </form>
    </details>}

    {offerAfterHelp && <details className="optional-page-help">
      <summary>Optional page help · add what happens after</summary>
      <p>You can ignore this and keep going in chat. Use it only if a structured handoff prompt would help.</p>
      <form onSubmit={e => { e.preventDefault(); void action.run(() => store.saveStarterAnswer(captured.id, captured.answerDraft ?? '', 'after')) }}>
        <label htmlFor="followup-answer">Add handoff context (optional)</label>
        <p className="prompt-question">{FOLLOWUP_QUESTION}</p>
        <textarea id="followup-answer" rows={3} maxLength={4000} disabled={action.busy}
          value={captured.answerDraft ?? ''} onChange={e => store.setStarterDraft(e.target.value)}
          placeholder="For example: Logistics books the courier, then Lee reviews the handoff evidence." required />
        <button className="secondary" disabled={action.busy || !captured.answerDraft?.trim()}>{action.busy ? 'Saving note…' : 'Save optional note'}</button>
        <ErrorNotice message={action.error} />
      </form>
    </details>}

    {!interaction?.active && !questions && !interviewStarted && <details className="manual-fallback optional-page-help">
      <summary>No connected AI chat? Use the page-only fallback</summary>
      <p>This preserves source evidence one question at a time. It cannot become a runnable playbook until an agent structures it for your review.</p>
      <button className="secondary" onClick={openStarterDraft}>Continue interview on this page →</button>
    </details>}
  </section>
}
