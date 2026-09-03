import * as store from './store'
import { STARTER_QUESTION, discoveryInvite } from '../sdk/discovery'
import { AgentInvite, ErrorNotice, useAction } from './ui'

export default function DiscoveryStart({state}: {state: store.AppState}) {
  const action = useAction()
  const captured = state.captureContext!
  const work = state.worklogs.find(w => w.id === captured.id)
  const before = work?.data.discovery?.before
  const interaction = window.Understudy.getInteractionState?.()
  const questions = interaction?.questions ?? 0
  const interviewStarted = (interaction?.interview?.asked ?? 0) > 0
  const prompt = discoveryInvite({worklogId: captured.id, task: captured.task, discovery: work?.data.discovery}, window.location.href)
  const askStarter = !before && !captured.starterSkipped && !questions && !interviewStarted

  return <section className="card current-work discovery-start">
    <div className="eyebrow">{askStarter ? 'WORK SAVED · FIRST QUESTION' : questions ? 'YOUR AGENT HAS A QUESTION' : interviewStarted ? 'ANSWER RECEIVED' : 'NEXT · CONTINUE IN YOUR AI CHAT'}</div>
    <h2>{askStarter ? STARTER_QUESTION : questions ? 'Answer your agent beside the process.' : interviewStarted ? 'Your answers are ready for the next step.' : before ? 'Let your agent build on your answer.' : 'Build the process with your agent.'}</h2>
    <blockquote>{captured.task}</blockquote>
    {askStarter ? <>
      <p>This starter question helps uncover the work around your task. Name a preparation step and who does it, if you know.</p>
      <form onSubmit={e => { e.preventDefault(); void action.run(() => store.saveStarterAnswer(captured.id, captured.answerDraft ?? '')) }}>
        <label htmlFor="starter-answer">What must happen first?</label>
        <textarea id="starter-answer" autoFocus rows={3} maxLength={4000} disabled={action.busy}
          value={captured.answerDraft ?? ''} onChange={e => store.setStarterDraft(e.target.value)}
          placeholder="For example: Sales confirms the order quantity and delivery date." required />
        <button className="primary" disabled={action.busy || !captured.answerDraft?.trim()}>{action.busy ? 'Saving answer…' : 'Save answer & continue →'}</button>
        <button type="button" className="ghost" disabled={action.busy} onClick={store.skipStarterQuestion}>Discuss this with my agent instead</button>
        <ErrorNotice message={action.error} />
      </form>
    </> : <>
      {before && <div className="saved-answer"><span>YOUR ANSWER · SAVED</span><p>{before.answer}</p></div>}
      {questions ? <><p>Your agent’s question is in the right panel. Your saved answer is available for it to read.</p>
        <button className="primary" onClick={() => window.Understudy.openPanel?.()}>Answer the question →</button></>
        : interviewStarted ? <><p role="status">Your agent can read your answer and continue drafting. Watch your AI chat for its response; the draft will appear on the right.</p>
          <details className="intro-help"><summary>Need to resume in your AI chat?</summary><AgentInvite prompt={prompt} /></details></>
          : <AgentInvite prompt={prompt} label="Copy request for my agent" hint="Your work is saved. Send this request in your browser agent’s chat to continue with questions about the next steps and owners." />}
    </>}
  </section>
}
