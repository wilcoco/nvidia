import { api, ApiError, setToken, getToken } from './api'

export interface UserInfo {
  username: string
  name: string
  role: string
}

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

export interface ProcessSummary {
  id: string
  title: string
  createdBy: string
  createdAt: number
}

export interface AppState {
  me: UserInfo | null
  authChecked: boolean
  actingAs: string
  users: UserInfo[]
  worklogs: Worklog[]
  approvals: Approval[]
  processes: ProcessSummary[]
}

let state: AppState = {
  me: null,
  authChecked: false,
  actingAs: '',
  users: [],
  worklogs: [],
  approvals: [],
  processes: [],
}

const listeners = new Set<() => void>()

function commit(patch: Partial<AppState>) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function getState(): AppState {
  return state
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

interface ServerState {
  me: UserInfo
  users: UserInfo[]
  worklogs: Worklog[]
  approvals: Approval[]
  processes: ProcessSummary[]
}

export async function refresh(): Promise<void> {
  if (!getToken()) {
    commit({ authChecked: true, me: null })
    return
  }
  try {
    const s = await api<ServerState>('/api/state')
    commit({
      authChecked: true,
      me: s.me,
      // The judge account is a reviewer identity; it acts through the demo personas.
      actingAs: state.actingAs || (s.me.username === 'judge' ? 'kim' : s.me.username),
      users: s.users,
      worklogs: s.worklogs,
      approvals: s.approvals,
      processes: s.processes,
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setToken(null)
      commit({ authChecked: true, me: null })
    }
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null

export function startPolling(): void {
  void refresh()
  if (!pollTimer) pollTimer = setInterval(() => void refresh(), 5000)
}

export async function login(username: string, password: string): Promise<void> {
  const res = await api<{ token: string; user: UserInfo }>('/api/auth/login', { username, password })
  setToken(res.token)
  // The judge account is a reviewer identity with no persona of its own —
  // start it as Kim so the UI selector and the acting state always agree.
  commit({ me: res.user, actingAs: res.user.username === 'judge' ? 'kim' : res.user.username })
  window.Understudy.log(`logged in as ${res.user.name} (${res.user.role})`)
  await refresh()
}

export function logout(): void {
  setToken(null)
  commit({ me: null })
}

export function switchActingAs(username: string): void {
  commit({ actingAs: username })
  window.Understudy.log(`switched active persona to ${username}`)
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

export async function createWorklog(input: WorklogInput): Promise<Worklog> {
  const wl = await api<Worklog>('/api/worklogs', { ...input, actingAs: state.actingAs })
  window.Understudy.log(
    `created worklog "${wl.task}" (line ${wl.line}, ${wl.progressPct}%, ${wl.hours}h${wl.urgent ? ', URGENT' : ''})`,
    { worklogId: wl.id },
  )
  await refresh()
  return wl
}

export async function requestApproval(worklogId: string, approver: string): Promise<Approval> {
  const approval = await api<Approval>(`/api/worklogs/${worklogId}/submit`, {
    approver,
    actingAs: state.actingAs,
  })
  const wl = state.worklogs.find((w) => w.id === worklogId)
  window.Understudy.log(`requested approval for "${wl?.task ?? worklogId}" from ${approver}`, {
    approvalId: approval.id,
  })
  await refresh()
  return approval
}

export async function decideApproval(
  approvalId: string,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string,
): Promise<Approval> {
  const decided = await api<Approval>(`/api/approvals/${approvalId}/decide`, {
    decision,
    comment,
    actingAs: state.actingAs,
  })
  const wl = state.worklogs.find((w) => w.id === decided.worklogId)
  window.Understudy.log(
    `${decision.toLowerCase()} worklog "${wl?.task ?? decided.worklogId}"${comment ? ` — "${comment}"` : ''}`,
    { approvalId },
  )
  await refresh()
  return decided
}

/* Process library (shared across users via the server) */

export async function saveProcess(map: { title: string; steps: unknown[] }): Promise<ProcessSummary> {
  const saved = await api<ProcessSummary>('/api/processes', {
    title: map.title,
    map,
    actingAs: state.actingAs,
  })
  window.Understudy.log(`saved process "${saved.title}" to the shared library`, { processId: saved.id })
  await refresh()
  return saved
}

export async function listProcesses(): Promise<ProcessSummary[]> {
  return api<ProcessSummary[]>('/api/processes')
}

export async function getProcess(id: string): Promise<{ id: string; title: string; map: unknown; createdBy: string }> {
  return api(`/api/processes/${id}`)
}
