import { api, ApiError, setToken, getToken } from './api'

export interface UserInfo {
  username: string
  name: string
  role: string
}

export interface IncidentData {
  viscosity?: number
  boothTemp?: number
  sprayPressure?: number
  colorChange?: boolean
  actionTaken?: string
  correctiveResult?: string
  testPanelResult?: string
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
  kind: string
  data: IncidentData
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
  appliesWhen?: Record<string, unknown>
  priorityWhen?: Record<string, unknown>
  version: number
}

/** What the human is entering in the incident form right now. */
export interface DraftContext {
  kind?: string
  colorChange?: boolean
  urgent?: boolean
  /** Live "what happened" text — matched against playbook keywords. */
  task?: string
  /** True once the human actually started describing the incident. */
  hasInput?: boolean
}

export interface PlaybookMatch {
  processId: string
  title: string
  createdBy: string
  confidence: number
  /** 'strong' shows as a suggestion card; 'candidate' is agent-visible only. */
  tier: 'strong' | 'candidate'
  reasons: string[]
  version: number
}

export interface AppState {
  me: UserInfo | null
  authChecked: boolean
  actingAs: string
  users: UserInfo[]
  worklogs: Worklog[]
  approvals: Approval[]
  processes: ProcessSummary[]
  draft: DraftContext
  dismissedSuggestions: string[]
}

let state: AppState = {
  me: null,
  authChecked: false,
  actingAs: '',
  users: [],
  worklogs: [],
  approvals: [],
  processes: [],
  draft: {},
  dismissedSuggestions: [],
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
  hours: number
  note: string
  urgent: boolean
  kind: string
  data: IncidentData
}

export async function createWorklog(input: WorklogInput): Promise<Worklog> {
  const wl = await api<Worklog>('/api/worklogs', { ...input, progressPct: 100, actingAs: state.actingAs })
  const cond = [
    wl.data.colorChange ? 'after color change' : null,
    wl.data.viscosity != null ? `viscosity ${wl.data.viscosity}s` : null,
    wl.data.boothTemp != null ? `booth ${wl.data.boothTemp}°C` : null,
    wl.data.sprayPressure != null ? `spray ${wl.data.sprayPressure}bar` : null,
  ]
    .filter(Boolean)
    .join(', ')
  window.Understudy.log(
    `logged ${wl.kind} "${wl.task}" (line ${wl.line}${cond ? `, ${cond}` : ''}${wl.urgent ? ', URGENT' : ''})`,
    { worklogId: wl.id },
  )
  window.Understudy.notifyAction('log_incident', wl.id)
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
  window.Understudy.notifyAction('request_review', approval.id)
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
  window.Understudy.notifyAction(decision === 'APPROVED' ? 'approve_review' : 'reject_review', decided.id)
  await refresh()
  return decided
}

export async function recordCorrectiveAction(
  worklogId: string,
  input: { actionTaken: string; result?: string; viscosity?: number; testPanelResult?: string },
): Promise<Worklog> {
  const wl = await api<Worklog>(`/api/worklogs/${worklogId}/corrective`, { ...input, actingAs: state.actingAs })
  window.Understudy.log(
    `recorded corrective action on incident #${worklogId} — "${input.actionTaken}"`,
    { worklogId },
  )
  window.Understudy.notifyAction('record_corrective_action', worklogId)
  await refresh()
  return wl
}

/* Contextual playbook matching (condition-based, no LLM) */

export function setDraftContext(draft: DraftContext): void {
  commit({ draft })
}

export function dismissSuggestion(processId: string, reason?: string): void {
  commit({ dismissedSuggestions: [...state.dismissedSuggestions, processId] })
  window.Understudy.log(
    `dismissed suggested playbook ${processId} as not relevant${reason ? ` — ${reason}` : ''}`,
  )
}

const FIELD_LABEL: Record<string, (v: unknown) => string> = {
  kind: (v) => `incident type: ${v}`,
  colorChange: () => 'right after a color change',
  urgent: () => 'urgent line-stop condition',
}

export function computeMatches(includeDismissed = false): PlaybookMatch[] {
  const draft = state.draft
  // Don't suggest off pristine form defaults — wait until the human starts
  // actually describing the incident.
  if (!draft.hasInput) return []
  const matches: PlaybookMatch[] = []
  // Only the latest version of each playbook title competes.
  const latest = new Map<string, ProcessSummary>()
  for (const p of state.processes) {
    const cur = latest.get(p.title)
    if (!cur || (p.version || 1) > (cur.version || 1)) latest.set(p.title, p)
  }
  for (const p of latest.values()) {
    if (!p.appliesWhen || Object.keys(p.appliesWhen).length === 0) continue
    if (!includeDismissed && state.dismissedSuggestions.includes(p.id)) continue
    const aw = { ...p.appliesWhen } as Record<string, unknown>
    const keywords = Array.isArray(aw.keywords) ? (aw.keywords as string[]) : null
    delete aw.keywords
    const d = draft as Record<string, unknown>
    // Keys the form knows about must hold; finer agent-authored keys the form
    // cannot supply (equipment, subsystem, processFamily, …) are tolerated.
    const entries = Object.entries(aw)
    const knowable = entries.filter(([k]) => d[k] !== undefined)
    const matched = knowable.filter(([k, v]) => d[k] === v)
    if (matched.length < knowable.length) continue
    const reasons = matched.map(([k, v]) => FIELD_LABEL[k]?.(v) ?? `${k} = ${v}`)

    // Tiered confidence: a shared work-log KIND alone is only a weak hint
    // ('routine log' covers cleaning, stocktaking, handovers, …). Specific
    // defect kinds carry more signal; keywords in the live text and extra
    // structured conditions are what raise a match into suggestion territory.
    let confidence = 0
    const kindMatched = matched.some(([k]) => k === 'kind')
    if (kindMatched) confidence += draft.kind === 'routine log' ? 0.3 : 0.55
    confidence += matched.filter(([k]) => k !== 'kind').length * 0.2
    if (keywords && keywords.length) {
      const text = (draft.task ?? '').toLowerCase()
      const hit = keywords.filter((w) => text.includes(String(w).toLowerCase()))
      if (hit.length > 0) {
        confidence += 0.35 * (hit.length / keywords.length)
        reasons.push(`mentions: ${hit.join(', ')}`)
      }
    }
    if (matched.length === 0 && !(keywords && (draft.task ?? '').length)) continue
    for (const [k, v] of Object.entries(p.priorityWhen ?? {})) {
      if (d[k] === v) {
        confidence += 0.1
        reasons.push(FIELD_LABEL[k]?.(v) ?? `${k} = ${v}`)
      }
    }
    if (confidence < 0.25) continue
    matches.push({
      processId: p.id,
      title: p.title,
      createdBy: p.createdBy,
      confidence: Math.min(0.95, Number(confidence.toFixed(2))),
      tier: confidence >= 0.5 ? 'strong' : 'candidate',
      reasons,
      version: p.version || 1,
    })
  }
  return matches.sort((a, b) => b.confidence - a.confidence)
}

export async function followPlaybook(processId: string): Promise<void> {
  const p = await getProcess(processId)
  window.Understudy.loadProcess(p.map as never, { id: p.id, createdBy: p.createdBy })
  window.Understudy.log(`opened playbook "${p.title}" to work along it`, { processId: p.id })
}

/* Process library (shared across users via the server) */

export async function saveProcess(map: { title: string; steps: unknown[]; version?: number }): Promise<ProcessSummary> {
  // Saving a map under an existing title creates the next version of that playbook.
  const prior = state.processes.filter((p) => p.title === map.title)
  const version = prior.length ? Math.max(...prior.map((p) => p.version || 1)) + 1 : 1
  // Applicability conditions: agent-provided > inherited from prior version >
  // derived from the entry that triggered this playbook — a playbook without
  // appliesWhen can never be auto-suggested, so never save one silently.
  const donor = prior
    .filter((p) => p.appliesWhen)
    .sort((a, b) => (b.version || 1) - (a.version || 1))[0]
  const latest = state.worklogs[0]
  const STOP = new Set(['the','and','with','from','after','before','during','this','that','have','has','was','were','been','still','while','when','onto','into','over'])
  const derivedKeywords = latest
    ? [...new Set(latest.task.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
        .filter((w) => w.length > 3 && !STOP.has(w)))].slice(0, 6)
    : []
  const derivedApplies = latest
    ? {
        kind: latest.kind,
        ...(latest.data.colorChange ? { colorChange: true } : {}),
        ...(derivedKeywords.length ? { keywords: derivedKeywords } : {}),
      }
    : undefined
  const derivedPriority = latest?.urgent ? { urgent: true } : undefined
  const mapWithMeta = map as Record<string, unknown>
  const saved = await api<ProcessSummary>('/api/processes', {
    title: map.title,
    map: {
      ...map,
      version,
      appliesWhen: mapWithMeta.appliesWhen ?? donor?.appliesWhen ?? derivedApplies,
      priorityWhen: mapWithMeta.priorityWhen ?? donor?.priorityWhen ?? derivedPriority,
      sourceWorklogId: mapWithMeta.sourceWorklogId ?? latest?.id,
    },
    actingAs: state.actingAs,
  })
  window.Understudy.log(
    `saved process "${saved.title}" v${version} to the shared library${version > 1 ? ' (new revision)' : ''}`,
    { processId: saved.id },
  )
  await refresh()
  return saved
}

export async function listProcesses(): Promise<ProcessSummary[]> {
  return api<ProcessSummary[]>('/api/processes')
}

export async function getProcess(id: string): Promise<{ id: string; title: string; map: unknown; createdBy: string }> {
  return api(`/api/processes/${id}`)
}

/* Run records: one per execution of a playbook */

export interface RunStep {
  id: string
  label: string
  type: string
  action?: string
  status?: string
  resultId?: string
  naReason?: string
}

export interface ProcessRun {
  id: string
  processId: string
  title: string
  startedBy: string
  startedAt: number
  updatedAt: number
  status: 'active' | 'completed'
  steps: RunStep[]
  deviations: number
}

export async function startRun(processId: string, map: { title: string }): Promise<{ id: string }> {
  return api<ProcessRun>('/api/runs', { processId, title: map.title, actingAs: state.actingAs })
}

export async function updateRun(
  runId: string,
  payload: { steps: unknown[]; status?: string; deviations?: number },
): Promise<void> {
  await api(`/api/runs/${runId}`, payload)
}

export async function listRuns(processId?: string): Promise<ProcessRun[]> {
  return api<ProcessRun[]>(`/api/runs${processId ? `?processId=${processId}` : ''}`)
}

export async function deleteProcess(id: string): Promise<void> {
  await fetch(`/api/processes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  window.Understudy.log(`deleted process ${id} from the library`)
  await refresh()
}

export async function resetDemoData(scope: 'worklogs' | 'all'): Promise<void> {
  await api('/api/admin/reset', { scope })
  window.Understudy.log(`reset demo data (${scope})`)
  await refresh()
}
