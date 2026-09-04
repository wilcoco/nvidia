import { useEffect } from 'react'
import * as store from './store'
import { FOLLOWUP_QUESTION, STARTER_QUESTION, discoveryInvite } from '../sdk/discovery'
import { AgentInvite, ErrorNotice, useAction } from './ui'

export default function DiscoveryStart({state}: {state: store.AppState}) {
  const action = useAction()
  const captured = state.captureContext!
  const work = state.worklogs.find(w => w.id === captured.id)
  const before = work?.data.discovery?.before
  const after = work?.data.discovery?.after
  const interaction = window.Understudy.getInteractionState?.()
  const questions = interaction?.questions ?? 0
  const interviewStarted = (interaction?.interview?.asked ?? 0) > 0
  const prompt = discoveryInvite({worklogId: captured.id, task: captured.task, discovery: work?.data.discovery}, window.location.href)
  const askStarter = !before && !captured.starterSkipped && !questions && !interviewStarted
  const askFollowup = Boolean(before && !after && !captured.afterSkipped)
  useEffect(() => {
    if (!askFollowup) return
    const frame = requestAnimationFrame(() => {
      const input = document.getElementById('followup-answer')
      input?.focus()
      input?.scrollIntoView({block: 'center', behavior: 'smooth'})
    })
    return () => cancelAnimationFrame(frame)
  }, [askFollowup, captured.id])
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
    <div className="eyebrow">{askStarter ? 'WORK SAVED · QUESTION 1 OF 2' : askFollowup ? '1 OF 2 ANSWERED · QUESTION 2' : questions ? 'YOUR AGENT HAS A QUESTION' : interaction?.active ? 'AGENT CONNECTED · WAITING FOR THE NEXT QUESTION' : interviewStarted ? 'ANSWER RECEIVED' : 'STARTING CONTEXT SAVED'}</div>
    <h2>{askStarter ? STARTER_QUESTION : askFollowup ? FOLLOWUP_QUESTION : questions ? 'Answer your agent beside the process.' : interaction?.active ? 'Your agent is reading the saved context.' : interviewStarted ? 'Your answers are ready for the next step.' : before ? 'Continue discovering the process.' : 'Build the process with your agent.'}</h2>
    <blockquote>{captured.task}</blockquote>
    <p className="discovery-progress" role="status" aria-live="polite">{askStarter ? 'Question 1 of 2 · preparation' : askFollowup ? '1 of 2 answered · next: handoff' : after ? '2 of 2 starting questions answered' : 'Starting context saved'}</p>
    {before && <details className="saved-answer"><summary>✓ 1. What must happen first? · SAVED</summary><p>{before.answer}</p></details>}
    {after && <details className="saved-answer"><summary>✓ 2. What happens next? · SAVED</summary><p>{after.answer}</p></details>}
    {askStarter ? <>
      <p>This starter question helps uncover the work around your task. Name a preparation step and who does it, if you know.</p>
      <form onSubmit={e => { e.preventDefault(); void action.run(() => store.saveStarterAnswer(captured.id, captured.answerDraft ?? '', 'before')) }}>
        <label htmlFor="starter-answer">What must happen first?</label>
        <textarea id="starter-answer" autoFocus rows={3} maxLength={4000} disabled={action.busy}
          value={captured.answerDraft ?? ''} onChange={e => store.setStarterDraft(e.target.value)}
          placeholder="For example: Sales confirms the order quantity and delivery date." required />
        <button className="primary" disabled={action.busy || !captured.answerDraft?.trim()}>{action.busy ? 'Saving answer…' : 'Save answer & continue →'}</button>
        <button type="button" className="ghost" disabled={action.busy} onClick={() => store.skipStarterQuestion('before')}>Discuss this with my agent instead</button>
        <ErrorNotice message={action.error} />
      </form>
    </> : askFollowup ? <>
      <p>Name the next meaningful step and its owner. Your agent can ask about detailed rules and exceptions afterwards.</p>
      <form onSubmit={e => { e.preventDefault(); void action.run(() => store.saveStarterAnswer(captured.id, captured.answerDraft ?? '', 'after')) }}>
        <label htmlFor="followup-answer">What happens next, and who takes over?</label>
        <textarea id="followup-answer" autoFocus rows={3} maxLength={4000} disabled={action.busy}
          value={captured.answerDraft ?? ''} onChange={e => store.setStarterDraft(e.target.value)}
          placeholder="For example: Logistics books the courier, then Lee reviews the handoff evidence." required />
        <button className="primary" disabled={action.busy || !captured.answerDraft?.trim()}>{action.busy ? 'Saving answer…' : 'Save answer & continue →'}</button>
        <button type="button" className="ghost" disabled={action.busy} onClick={() => store.skipStarterQuestion('after')}>Continue this question with my agent instead</button>
        <ErrorNotice message={action.error} />
      </form>
      <details className="intro-help"><summary>Continue in my AI chat instead</summary><AgentInvite prompt={prompt} /></details>
    </> : <>
      {questions ? <><p>Your agent’s question is in the right panel. Your saved answer is available for it to read.</p>
        <button className="primary" onClick={() => window.Understudy.openPanel?.()}>Answer the question →</button></>
        : interaction?.active ? <p className="waiting-agent" role="status">Connected. Keep this page open; the next question will appear in the panel. You can continue in the chat while it works.</p>
        : interviewStarted ? <><p role="status">Your agent can read your answer and continue drafting. Watch your AI chat for its response; the draft will appear on the right.</p>
          <details className="intro-help"><summary>Need to resume in your AI chat?</summary><AgentInvite prompt={prompt} /></details></>
          : <><AgentInvite prompt={prompt} label="Copy request for my agent" hint="Your work is saved. Send this request in your browser agent’s chat to continue with questions about the next steps and owners." />
            {!interaction?.active && <div className="manual-fallback"><b>No connected agent?</b><p>Capture source evidence one question at a time on this page. It stays an evidence-only starter and cannot be saved as a runnable playbook until an agent structures it for your review.</p><button className="secondary" onClick={openStarterDraft}>Continue interview on this page →</button></div>}</>}
    </>}
  </section>
}
