// Agent→human questions and action-approval gates.
// Async by design: agent tool calls must return IMMEDIATELY (agent runtimes
// time tool calls out in ~20s), so cards return a pending id and the agent
// polls get_question_result / get_action_result.
import { record } from './journal'
import * as host from './host'

type Listener = () => void

export interface AskOption {
  label: string
  /** When set, choosing this option also executes the host action (through the
   *  normal validation pipeline) and the agent receives the outcome. */
  run?: { name: string; params?: Record<string, unknown> }
}

export interface PendingAsk {
  id: string
  question: string
  options?: AskOption[]
  allowText: boolean
  /** Gap this question resolves once answered (kind[:stepId]). */
  resolvesGap?: string
}

export interface PendingApproval {
  id: string
  actionName: string
  params: Record<string, unknown>
  /** Runs the action once the human approves; produces the stored outcome. */
  continuation: () => Promise<unknown>
  /** The persona active when the agent requested this — only they may decide. */
  persona?: string
}

export type QuestionResult =
  | { status: 'pending'; question: string }
  | { status: 'answered'; question: string; answer: string }
export type ActionResult =
  | { status: 'pending_approval'; action: string }
  | { status: 'denied'; action: string }
  | { status: 'complete'; action: string; outcome: unknown }

let seq = 1
export const asks: PendingAsk[] = []
export const approvals: PendingApproval[] = []
const questionResults = new Map<string, QuestionResult>()
const questionWorklogs = new Map<string, string>()
const actionResults = new Map<string, ActionResult>()
const listeners = new Set<Listener>()
export interface GapAnswerEvidence {
  questionId: string
  question: string
  answer: string
  answeredAt: number
}

const gapResolvers = new Set<(gapKey: string, evidence: GapAnswerEvidence) => void>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** mapstore hooks in to mark gaps resolved without an import cycle. */
export function onGapResolved(fn: (gapKey: string, evidence: GapAnswerEvidence) => void): void {
  gapResolvers.add(fn)
}

/** Show a question card; returns immediately with the question id. */
export function askUser(
  question: string,
  options?: AskOption[],
  allowText = true,
  resolvesGap?: string,
): string {
  const id = `q${seq++}`
  asks.push({ id, question, options, allowText, resolvesGap })
  questionResults.set(id, { status: 'pending', question })
  const state = host.getState() as {playbookRequest?: {worklogId?: string}} | null
  if (state?.playbookRequest?.worklogId) questionWorklogs.set(id, state.playbookRequest.worklogId)
  record('agent', 'app', `asked: ${question}`, { questionId: id })
  notify()
  return id
}

/** Panel calls this when the human answers (option label, run outcome, or free text). */
export function answerAsk(id: string, answer: string): void {
  const idx = asks.findIndex((a) => a.id === id)
  if (idx < 0) return
  const ask = asks[idx]
  asks.splice(idx, 1)
  const answeredAt = Date.now()
  questionResults.set(id, { status: 'answered', question: ask.question, answer })
  record('user', 'answer', answer, { question: ask.question, questionId: id })
  if (ask.resolvesGap) {
    const evidence = {questionId: id, question: ask.question, answer, answeredAt}
    gapResolvers.forEach((fn) => fn(ask.resolvesGap!, evidence))
  }
  notify()
}

export function getQuestionResult(id: string): QuestionResult | { status: 'unknown' } {
  return questionResults.get(id) ?? { status: 'unknown' }
}

/** Only activity for the current capture counts as an interview in progress. */
export function getInterviewProgress(): {asked: number; answered: number} {
  const state = host.getState() as {playbookRequest?: {worklogId?: string}} | null
  const worklogId = state?.playbookRequest?.worklogId
  const results = worklogId ? [...questionWorklogs].filter(([, id]) => id === worklogId).map(([id]) => questionResults.get(id)) : []
  return {asked: results.length, answered: results.filter(r => r?.status === 'answered').length}
}

/** Show an approval card for an agent-initiated action; returns the approval id. */
function currentPersona(): string | undefined {
  try {
    const s = host.getState() as { actingAs?: unknown } | null
    return typeof s?.actingAs === 'string' ? s.actingAs : undefined
  } catch {
    return undefined
  }
}

export function requestApproval(
  actionName: string,
  params: Record<string, unknown>,
  continuation: () => Promise<unknown>,
): string {
  const id = `a${seq++}`
  approvals.push({ id, actionName, params, continuation, persona: currentPersona() })
  actionResults.set(id, { status: 'pending_approval', action: actionName })
  notify()
  return id
}

/** Panel calls this on Approve/Deny. Approve executes the action and stores its outcome. */
export async function decideApprovalCard(id: string, approved: boolean): Promise<void> {
  const idx = approvals.findIndex((a) => a.id === id)
  if (idx < 0) return
  const req = approvals[idx]
  approvals.splice(idx, 1)
  notify()
  if (!approved) {
    actionResults.set(id, { status: 'denied', action: req.actionName })
    record('user', 'answer', `denied agent action ${req.actionName}`, { actionId: id })
    notify()
    return
  }
  record('user', 'answer', `approved agent action ${req.actionName}`, { actionId: id })
  const outcome = await req.continuation()
  actionResults.set(id, { status: 'complete', action: req.actionName, outcome })
  notify()
}

export function getActionResult(id: string): ActionResult | { status: 'unknown' } {
  return actionResults.get(id) ?? { status: 'unknown' }
}
