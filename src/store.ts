export interface Worklog {
  id: string
  date: string
  line: string
  task: string
  progressPct: number
  hours: number
  note: string
  urgent: boolean
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  createdBy: string
}

export interface Approval {
  id: string
  worklogId: string
  requestedBy: string
  approver: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  comment?: string
  ts: number
}

export interface AppState {
  currentUser: string
  worklogs: Worklog[]
  approvals: Approval[]
}

export const USERS = [
  { id: 'kim', name: 'Kim', role: 'Line worker' },
  { id: 'lee', name: 'Lee', role: 'Team lead' },
] as const

const KEY = 'linepulse-state-v1'

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as AppState
  } catch {
    /* corrupted or unavailable storage — start fresh */
  }
  return { currentUser: 'kim', worklogs: [], approvals: [] }
}

let state: AppState = load()
const listeners = new Set<() => void>()

function commit(next: AppState) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn())
}

export function getState(): AppState {
  return state
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let seq = Date.now() % 100000
const nextId = (prefix: string) => `${prefix}-${(seq++).toString(36)}`

export function switchUser(userId: string): void {
  if (!USERS.some((u) => u.id === userId)) return
  commit({ ...state, currentUser: userId })
  window.FlowCatch.log(`switched user to ${userId}`)
}

export interface WorklogInput {
  date: string
  line: string
  task: string
  progressPct: number
  hours: number
  note: string
  urgent: boolean
}

export function createWorklog(input: WorklogInput): Worklog {
  const wl: Worklog = {
    id: nextId('wl'),
    ...input,
    status: 'draft',
    createdBy: state.currentUser,
  }
  commit({ ...state, worklogs: [wl, ...state.worklogs] })
  window.FlowCatch.log(
    `created worklog "${wl.task}" (line ${wl.line}, ${wl.progressPct}%, ${wl.hours}h${wl.urgent ? ', URGENT' : ''})`,
    { worklogId: wl.id },
  )
  return wl
}

export function requestApproval(worklogId: string, approver: string): Approval | { error: string } {
  const wl = state.worklogs.find((w) => w.id === worklogId)
  if (!wl) return { error: `worklog ${worklogId} not found` }
  if (wl.status !== 'draft') return { error: `worklog is already ${wl.status}` }
  const approval: Approval = {
    id: nextId('ap'),
    worklogId,
    requestedBy: state.currentUser,
    approver,
    status: 'PENDING',
    ts: Date.now(),
  }
  commit({
    ...state,
    worklogs: state.worklogs.map((w) => (w.id === worklogId ? { ...w, status: 'submitted' } : w)),
    approvals: [approval, ...state.approvals],
  })
  window.FlowCatch.log(`requested approval for "${wl.task}" from ${approver}`, {
    approvalId: approval.id,
  })
  return approval
}

export function decideApproval(
  approvalId: string,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string,
): Approval | { error: string } {
  const ap = state.approvals.find((a) => a.id === approvalId)
  if (!ap) return { error: `approval ${approvalId} not found` }
  if (ap.status !== 'PENDING') return { error: `approval is already ${ap.status}` }
  const decided: Approval = { ...ap, status: decision, comment }
  commit({
    ...state,
    approvals: state.approvals.map((a) => (a.id === approvalId ? decided : a)),
    worklogs: state.worklogs.map((w) =>
      w.id === ap.worklogId
        ? { ...w, status: decision === 'APPROVED' ? 'approved' : 'rejected' }
        : w,
    ),
  })
  const wl = state.worklogs.find((w) => w.id === ap.worklogId)
  window.FlowCatch.log(
    `${decision.toLowerCase()} worklog "${wl?.task ?? ap.worklogId}"${comment ? ` — "${comment}"` : ''}`,
    { approvalId },
  )
  return decided
}

export function resetDemo(): void {
  commit({ currentUser: 'kim', worklogs: [], approvals: [] })
  window.FlowCatch.log('reset demo data')
}
