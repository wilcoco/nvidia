import { record } from './journal'

type Listener = () => void

export interface PendingAsk {
  id: number
  question: string
  options?: string[]
  allowText: boolean
  resolve: (answer: string) => void
}

export interface PendingApproval {
  id: number
  actionName: string
  params: Record<string, unknown>
  resolve: (approved: boolean) => void
}

let nextId = 1
export const asks: PendingAsk[] = []
export const approvals: PendingApproval[] = []
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const ANSWER_TIMEOUT_MS = 110_000

/** Agent asks the human a question; resolves with the answer, or a timeout marker. */
export function askUser(question: string, options?: string[], allowText = true): Promise<string> {
  record('agent', 'app', `asked: ${question}`)
  return new Promise((resolve) => {
    const ask: PendingAsk = {
      id: nextId++,
      question,
      options,
      allowText,
      resolve: (answer) => {
        remove()
        record('user', 'answer', answer, { question })
        resolve(answer)
      },
    }
    const timer = setTimeout(() => {
      remove()
      resolve('[no answer yet — the question is still shown to the user; call get_recent_actions later to see their answer]')
    }, ANSWER_TIMEOUT_MS)
    const remove = () => {
      clearTimeout(timer)
      const i = asks.indexOf(ask)
      if (i >= 0) asks.splice(i, 1)
      notify()
    }
    asks.push(ask)
    notify()
  })
}

/** Ask the human to approve an agent-initiated action. */
export function requestApproval(
  actionName: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req: PendingApproval = {
      id: nextId++,
      actionName,
      params,
      resolve: (approved) => {
        remove()
        record('user', 'answer', approved ? `approved agent action ${actionName}` : `denied agent action ${actionName}`)
        resolve(approved)
      },
    }
    const timer = setTimeout(() => {
      remove()
      resolve(false)
    }, ANSWER_TIMEOUT_MS)
    const remove = () => {
      clearTimeout(timer)
      const i = approvals.indexOf(req)
      if (i >= 0) approvals.splice(i, 1)
      notify()
    }
    approvals.push(req)
    notify()
  })
}
