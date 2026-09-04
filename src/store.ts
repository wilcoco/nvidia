import { api, ApiError, setToken, getToken } from './api'
import { FOLLOWUP_QUESTION, STARTER_QUESTION, type DiscoveryAnswer } from '../sdk/discovery'

export interface UserInfo {
  username: string
  name: string
  role: string
}

export interface IncidentData {
  discovery?: { before?: DiscoveryAnswer; after?: DiscoveryAnswer }
  viscosity?: number
  boothTemp?: number
  sprayPressure?: number
  colorChange?: boolean
  actionTaken?: string
  correctiveResult?: string
  testPanelResult?: string
  /** Measurements that passed the decision criteria (post-adjustment values). */
  verification?: Record<string, number | string | boolean>
  verifiedAt?: string
  reviewContext?: {
    approvalStepId: string
    approvalLabel: string
    purpose: 'work' | 'plan' | 'unspecified'
    purposeSource: 'declared' | 'legacy-label' | 'unspecified'
    workChecks: 'failed' | 'passed' | 'unverified'
    decisions: Array<{stepId: string; label: string; targetLabel: string; reason?: string; measurements: Record<string, unknown>; measurementSources?: Record<string, 'task-submitted' | 'decision-provided'>; criteriaMet: boolean | null}>
  } | null
  [key: string]: unknown
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
  /** Immutable values captured by the server when this review was requested. */
  evidence?: IncidentData
  stepId?: string
  id: string
  worklogId: string
  requestedBy: string
  approver: string
  decidedBySession?: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
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
  sourceProcessId?: string
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
  restoration: 'pending' | 'loading' | 'ready' | 'error'
  captureDraft: { task: string; sample: boolean }
  recentRuns: ProcessRun[]
  reviewSync: { runId: string; stepId: string; status: 'requesting' | 'ready' | 'error'; message?: string } | null
  me: UserInfo | null
  authChecked: boolean
  actingAs: string
  users: UserInfo[]
  worklogs: Worklog[]
  approvals: Approval[]
  processes: ProcessSummary[]
  draft: DraftContext
  dismissedSuggestions: string[]
  runStarted: { title: string; version?: number; next?: string; resumed?: boolean } | null
  captureContext: { id: string; task: string; creationRequested?: boolean; answerDraft?: string; starterSkipped?: boolean; afterSkipped?: boolean } | null
  pausedDrafts: Array<{
    key: string
    task: string
    title: string
    map?: UnderstudyProcessMap
    captureContext: AppState['captureContext']
    pausedAt: number
  }>
}

let state: AppState = {
  restoration: 'pending',
  captureDraft: {task: '', sample: false},
  recentRuns: [],
  reviewSync: null,
  me: null,
  authChecked: false,
  actingAs: '',
  users: [],
  worklogs: [],
  approvals: [],
  processes: [],
  draft: {},
  dismissedSuggestions: [],
  runStarted: null,
  captureContext: null,
  pausedDrafts: [],
}

const listeners = new Set<() => void>()

function commit(patch: Partial<AppState>) {
  state = { ...state, ...patch }
  if ('captureDraft' in patch || 'captureContext' in patch || 'draft' in patch || 'pausedDrafts' in patch) {
    try { sessionStorage.setItem('understudy.workspace', JSON.stringify({username: state.me?.username,
      captureDraft: state.captureDraft, captureContext: state.captureContext, draft: state.draft,
      pausedDrafts: state.pausedDrafts})) } catch { /* memory remains usable */ }
  }
  try {
    window.dispatchEvent(new CustomEvent('understudy:host-state'))
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

interface ServerState {
  me: UserInfo
  users: UserInfo[]
  worklogs: Worklog[]
  approvals: Approval[]
  processes: ProcessSummary[]
}

let sessionGen = 0

export async function refresh(): Promise<void> {
  if (!getToken()) {
    commit({ authChecked: true, me: null })
    return
  }
  const gen = sessionGen
  try {
    const s = await api<ServerState>('/api/state')
    if (gen !== sessionGen) return // logged out while in flight — drop the stale state
    // Reconcile execution before publishing cancelled reviews/draft records.
    // Otherwise another tab can see a new draft with an old approval-ready map
    // and immediately try to resubmit evidence that the assignee just reopened.
    await window.Understudy.refreshRunState?.()
    if (gen !== sessionGen) return
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
    if (!workspaceRestored) {
      workspaceRestored = true
      try {
        const saved = JSON.parse(sessionStorage.getItem('understudy.workspace') ?? 'null')
        if (saved?.username === s.me.username && typeof saved.captureDraft?.task === 'string') {
          commit({captureDraft: saved.captureDraft, captureContext: saved.captureContext ?? null, draft: saved.draft ?? {},
            pausedDrafts: Array.isArray(saved.pausedDrafts) ? saved.pausedDrafts : []})
          const key = saved.captureContext?.id ? `worklog:${saved.captureContext.id}` : ''
          const activeDraft = state.pausedDrafts.find(draft => draft.key === key && draft.map)
          if (activeDraft?.map && !window.Understudy.getLoadedProcess?.())
            window.Understudy.draftProcess?.(structuredClone(activeDraft.map))
        }
      } catch { /* Ignore stale or unavailable browser storage. */ }
    }
    resumeLastPlaybook()
  } catch (err) {
    if (gen !== sessionGen) return
    if (err instanceof ApiError && err.status === 401) {
      setToken(null)
      commit({ authChecked: true, me: null })
    }
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null

export function startPolling(): void {
  void refresh()
  if (!pollTimer) {
    pollTimer = setInterval(() => void refresh(), 5000)
    window.addEventListener('focus', () => void refresh())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refresh()
    })
  }
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
  sessionGen++
  setToken(null)
  try {
    localStorage.removeItem('understudy.lastPlaybook')
    sessionStorage.removeItem('understudy.workspace')
  } catch {
    /* ignore */
  }
  window.Understudy.unloadProcess?.()
  window.Understudy.closePanel?.()
  resumeAttempted = false
  workspaceRestored = false
  commit({ restoration: 'pending', me: null, actingAs: '', worklogs: [], approvals: [], processes: [], runStarted: null, captureContext: null, captureDraft: {task:'',sample:false}, draft: {}, pausedDrafts: [], recentRuns: [], reviewSync: null })
}

export function switchActingAs(username: string): void {
  if (!state.users.some((u) => u.username === username)) {
    window.Understudy.log(`refused persona switch: unknown user "${username}"`)
    return
  }
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
  // Stamp the active playbook run on the entry so the server can gate its
  // review/approval against that run's live state, deterministically.
  // A finished run stamps nothing — new entries are new work, not its paperwork.
  const runComplete = window.Understudy.isRunComplete?.() === true
  const runId = runComplete ? undefined : (window.Understudy.currentRunId?.() ?? undefined)
  const wl = await api<Worklog>('/api/worklogs', {
    ...input,
    data: { ...(input.data ?? {}), ...(runId ? { runId } : {}) },
    progressPct: 100,
    actingAs: state.actingAs,
  })
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
  if (runId && window.Understudy.currentRunId?.() === runId) window.Understudy.notifyAction('log_work_item', wl.id)
  if (!runId) commit({ captureContext: { id: wl.id, task: wl.task }, draft: {kind: wl.kind, urgent: wl.urgent, task: wl.task, hasInput: true} })
  await refresh()
  return wl
}

export async function requestApproval(
  worklogId: string,
  approver: string,
  asPersona?: string,
  stepId?: string,
): Promise<Approval> {
  const wl = state.worklogs.find((w) => w.id === worklogId)
  const runId = window.Understudy.currentRunId?.()
  const linked = Boolean(runId && String(wl?.data.runId ?? '') === String(runId))
  if (linked) {
    await window.Understudy.flushRun?.()
    if (window.Understudy.currentRunId?.() !== runId) throw new Error('The active run changed. Request review again from the current task.')
  }
  const approval = await api<Approval>(`/api/worklogs/${worklogId}/submit`, {
    approver,
    stepId,
    actingAs: asPersona ?? state.actingAs,
  })
  window.Understudy.log(`requested approval for "${wl?.task ?? worklogId}" from ${approver}`, {
    approvalId: approval.id,
  })
  if (linked && window.Understudy.currentRunId?.() === runId) {
    // The response may arrive after rework, rejection or another submission.
    // Persist intervening edits and confirm which request is still current.
    await window.Understudy.flushRun?.()
    await refresh()
    if (window.Understudy.currentRunId?.() !== runId) return approval
    const current = state.approvals.find(a => a.id === approval.id && a.status === 'PENDING')
    if (!current) return approval
    window.Understudy.notifyAction('request_review', current.id)
    // Publish the completed request step before handing the review to another tab.
    await window.Understudy.flushRun?.()
  }
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
  // An approval advances the loaded run ONLY when it belongs to that run —
  // approving unrelated work must never tick another run's sign-off step.
  const runId = window.Understudy.currentRunId?.()
  const targetRunId = decided.evidence?.runId != null ? String(decided.evidence.runId) : wl?.data.runId != null ? String(wl.data.runId) : null
  const liveApproval = window.Understudy.getProgress?.().find((s) => s.type === 'approval' && ['ready', 'blocked'].includes(s.status ?? ''))
  if (runId && targetRunId === String(runId) && (!decided.stepId || liveApproval?.id === decided.stepId)) {
    if (decision === 'APPROVED') {
      // The locked approval transaction has already applied the sign-off to
      // this run. Pull that authoritative state instead of echoing an
      // approve_review completion back through updateRun, which the server
      // correctly rejects after sign-off.
      await window.Understudy.refreshRunState?.(true)
    } else {
      window.Understudy.notifyAction('reject_review', decided.id)
    }
  }
  await refresh()
  if (targetRunId) {
    const target = await getRun(targetRunId).catch(() => null)
    window.Understudy.log(`Review #${approvalId} ${decision.toLowerCase()} for run #${targetRunId}${target ? ` — run is ${target.status}` : ' — decision saved; run status could not be refreshed'}.`,
      {approvalId, runId: targetRunId, status: target?.status})
  } else window.Understudy.log(`Review #${approvalId} ${decision.toLowerCase()} for a standalone work log.`, {approvalId})
  return decided
}

export async function recordCorrectiveAction(
  worklogId: string,
  input: { actionTaken: string; result?: string; viscosity?: number; testPanelResult?: string },
): Promise<Worklog> {
  const runId = window.Understudy.currentRunId?.()
  const wl = await api<Worklog>(`/api/worklogs/${worklogId}/corrective`, { ...input, actingAs: state.actingAs })
  window.Understudy.log(
    `recorded corrective action on incident #${worklogId} — "${input.actionTaken}"`,
    { worklogId },
  )
  if (runId && String(wl.data.runId ?? '') === runId && window.Understudy.currentRunId?.() === runId)
    window.Understudy.notifyAction('record_step_result', worklogId)
  await refresh()
  return wl
}

export async function saveVerification(
  worklogId: string,
  measurements: Record<string, unknown>,
  route?: { label?: string; pass?: boolean; checked?: boolean },
): Promise<void> {
  await api(`/api/worklogs/${worklogId}/verification`, { measurements, route, actingAs: state.actingAs })
  window.Understudy.log(
    `verified measurements saved on incident #${worklogId}: ${Object.entries(measurements)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
    { worklogId },
  )
  await refresh()
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
  kind: (v) => `work category: ${v}`,
  colorChange: () => 'right after a color change',
  urgent: () => 'urgent line-stop condition',
}

export function computeMatches(includeDismissed = false): PlaybookMatch[] {
  const draft = state.draft
  // Don't suggest off pristine form defaults — wait until the human starts
  // actually describing the incident.
  if (!draft.hasInput) return []
  // A run's own completion record is an output, not new work — feeding its
  // title back in must not re-trigger the playbook that produced it.
  if (/completion record|—\s*run\s*#\d+/i.test(state.draft.task ?? '')) return []
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
    // A shared generic kind alone is a hint, never a page-level suggestion.
    const kindOnly = kindMatched && matched.length === 1 && !reasons.some((r) => r.startsWith('mentions:'))
    matches.push({
      processId: p.id,
      title: p.title,
      createdBy: p.createdBy,
      confidence: Math.min(0.95, Number(confidence.toFixed(2))),
      tier: confidence >= 0.5 && !kindOnly ? 'strong' : 'candidate',
      reasons,
      version: p.version || 1,
    })
  }
  // A renamed revision carries sourceProcessId; never recommend an ancestor
  // next to its own successor.
  const parentOf = new Map(state.processes.map((p) => [p.id, p.sourceProcessId]))
  const superseded = new Set<string>()
  for (const m of matches) {
    let cur = parentOf.get(m.processId)
    let hops = 0
    while (cur && hops++ < 10) {
      superseded.add(cur)
      cur = parentOf.get(cur)
    }
  }
  return matches
    .filter((m) => !superseded.has(m.processId))
    .sort((a, b) => b.confidence - a.confidence)
}

/** How many pending reviews a new run would actually cancel: only reviews of
 *  runs that still have open work — runs merely awaiting sign-off keep theirs.
 *  Used for a two-click arm instead of a native confirm (which freezes agent
 *  runtimes). */
export async function cancellableReviewCount(): Promise<number> {
  const pending = state.approvals.filter((a) => a.status === 'PENDING')
  if (pending.length === 0) return 0
  try {
    const runs = await listRuns()
    const openRunIds = new Set(
      runs
        .filter(
          (r) =>
            r.status === 'active' &&
            Array.isArray(r.steps) &&
            r.steps.some(
              (s) =>
                s.type !== 'approval' &&
                ['ready', 'blocked', 'skipped', 'pending'].includes(String(s.status ?? '')),
            ),
        )
        .map((r) => String(r.id)),
    )
    return pending.filter((a) => {
      const wl = state.worklogs.find((w) => w.id === a.worklogId)
      return wl?.data.runId != null && openRunIds.has(String(wl.data.runId))
    }).length
  } catch {
    return pending.length
  }
}

export async function followPlaybook(
  processId: string,
  opts?: { silent?: boolean; resume?: boolean; run?: ProcessRun },
): Promise<void> {
  // Opening a saved process replaces the panel map. Snapshot the current
  // teaching session first; otherwise a fully answered draft can disappear
  // when the visitor switches through Playbooks, a suggestion, or RunPicker.
  if (!(opts?.silent && window.Understudy.getLoadedProcess?.())) pauseCurrentDraft()
  await window.Understudy.flushRun?.()
  const p = await getProcess(processId)
  let resume: { runId: string; steps?: unknown[]; decisions?: unknown[]; events?: ProcessRun['events'] } | undefined
  if (opts?.run) {
    const fresh = await getRun(opts.run.id)
    if (fresh.processId !== processId || fresh.status === 'abandoned') throw new Error('This execution is no longer available to resume. Refresh the run list.')
    resume = {runId: fresh.id, steps: fresh.steps, decisions: fresh.decisions, events: fresh.events}
  }
  if (opts?.resume && !resume) {
    try {
      const runs = await listRuns(processId)
      // Active first; a completed run only when nothing is in progress.
      const usable = runs.filter(
        (r) => r.status !== 'abandoned' && Array.isArray(r.steps) && r.steps.length > 0,
      )
      const target = usable.find((r) => r.status === 'active') ?? usable[0]
      if (target) resume = { runId: target.id, steps: target.steps, decisions: target.decisions, events: target.events }
    } catch {
      /* no runs — fresh start */
    }
    if (!resume && opts.silent) {
      // Reload with nothing to resume: do NOT silently mint a new run.
      try {
        localStorage.removeItem('understudy.lastPlaybook')
      } catch {
        /* ignore */
      }
      return
    }
  }
  if (opts?.silent && window.Understudy.getLoadedProcess?.()) return
  // Detach the teaching context before loadProcess emits its synchronous map
  // change. Otherwise the incoming confirmed map can be mistaken for the
  // draft that belonged to the previous work log and remove that snapshot.
  commit({ reviewSync: null, captureContext: null })
  window.Understudy.loadProcess(p.map as never, {
    id: p.id,
    createdBy: p.createdBy,
    ...(resume ? { resume } : {}),
  })
  // The map lives in the SDK rather than React state. A second host signal is
  // required after replacement so an in-place suggestion click recalculates
  // which registry row is active instead of hiding the previous draft.
  commit({ reviewSync: null })
  if (!opts?.silent)
    window.Understudy.log(`opened playbook "${p.title}" to work along it`, { processId: p.id })
  try {
    localStorage.setItem('understudy.lastPlaybook', processId)
  } catch {
    /* storage may be unavailable */
  }
  if (opts?.silent) return
  const loaded = window.Understudy.getLoadedProcess?.()
  const next = loaded?.steps?.find((st) => !st.done)
  commit({
    runStarted: {
      title: p.title,
      resumed: Boolean(resume),
      version: (p as { version?: number }).version,
      next: next?.label,
    },
  })
}

/** When the run reaches its approval step, the linked entry's review request
 *  is created automatically and routed to a persona of the step's role. */
let approvalSyncInFlight = false
const reviewAttempts = new Map<string, number>()
function contributorPersonaFor(): string | undefined {
  const me = state.users.find((u) => u.username === state.actingAs)
  return me?.role === 'Contributor' ? me.username : state.users.find((u) => u.role === 'Contributor')?.username
}

export function retryReview(): Promise<void> {
  if (state.reviewSync) reviewAttempts.delete(`${state.reviewSync.runId}:${state.reviewSync.stepId}`)
  commit({reviewSync: null})
  return autoSyncApproval()
}

export async function autoSyncApproval(): Promise<void> {
  if (approvalSyncInFlight) return
  const runId = window.Understudy.currentRunId?.()
  const proc = window.Understudy.getLoadedProcess?.()
  if (!runId || !proc) return
  const prog = window.Understudy.getProgress?.() ?? []
  const ready = prog.find((p) => p.type === 'approval' && ['ready', 'blocked'].includes(p.status ?? ''))
  if (!ready) {
    if (state.reviewSync?.runId === runId) commit({reviewSync: null})
    return
  }
  const before = prog.slice(0, prog.findIndex((p) => p.id === ready.id))
  if (before.some((p) => !p.done && !['not_applicable', 'conditional'].includes(p.status ?? '') && p.type !== 'decision')) {
    if (state.reviewSync?.runId === runId) commit({reviewSync: null})
    return
  }
  const key = `${runId}:${ready.id}`
  const isCurrent = () => window.Understudy.currentRunId?.() === runId && window.Understudy.getLoadedProcess?.() === proc
  const canRequest = () => {
    if (!isCurrent()) return false
    const latest = window.Understudy.getProgress?.() ?? []
    const index = latest.findIndex(p => p.id === ready.id && ['ready', 'blocked'].includes(p.status ?? ''))
    return index >= 0 && !latest.slice(0, index).some(p => !p.done &&
      !['not_applicable', 'conditional'].includes(p.status ?? '') && p.type !== 'decision')
  }
  if (state.reviewSync?.runId === runId && state.reviewSync.stepId === ready.id && state.reviewSync.status === 'error') return
  const firstApproval = !before.some((p) => p.type === 'approval' && p.done)
  let wl = state.worklogs.find((w) => String(w.data.runId ?? '') === String(runId) &&
    (w.data.approvalStepId === ready.id || (firstApproval && !w.data.approvalStepId)))
  if (wl && wl.status !== 'draft') {
    if (wl.status === 'submitted') {
      const review = state.approvals.find(a => a.worklogId === wl!.id && a.status === 'PENDING' && a.stepId === ready.id)
      if (review) window.Understudy.notifyAction('request_review', review.id)
    }
    if (wl.status === 'submitted' && state.reviewSync?.status !== 'ready') {
      commit({reviewSync: {runId, stepId: ready.id, status: 'ready'}})
      window.Understudy.log(`Review request for "${ready.label}" confirmed from the server.`, {runId, stepId: ready.id})
    }
    return
  }
  const contributor = contributorPersonaFor()
  if (!contributor) return
  approvalSyncInFlight = true
  commit({reviewSync: {runId, stepId: ready.id, status: 'requesting'}})
  try {
    // Flush before submitting, so the server checks the same completed work.
    await window.Understudy.flushRun?.()
    if (!canRequest()) return
    if (!wl) {
      const evidence: Record<string, unknown> = {}
      for (const s of proc.steps.slice(0, proc.steps.findIndex((s) => s.id === ready.id)))
        if (s.done && s.resultData) Object.assign(evidence, s.resultData)
      wl = await api<Worklog>('/api/worklogs', {
        date: new Date().toISOString().slice(0, 10), line: 'A',
        task: `${proc.title} — ${ready.label} — run #${runId} review record`,
        hours: 0, note: '', urgent: false,
        kind: String(proc.appliesWhen?.kind ?? 'routine work'),
        data: {...evidence, runId, approvalStepId: ready.id, systemGenerated: true},
        progressPct: 100, actingAs: contributor,
      })
      await refresh()
    }
    if (!canRequest()) return
    const role = proc.steps.find((s) => s.id === ready.id)?.role ?? 'Reviewer'
    const approver = state.users.find((u) => u.role === role && u.username !== wl!.createdBy)?.username ?? 'lee'
    await requestApproval(wl.id, approver, contributor, ready.id)
    if (canRequest()) commit({reviewSync: {runId, stepId: ready.id, status: 'ready'}})
    reviewAttempts.delete(key)
  } catch (err) {
    if (!canRequest()) return
    // A request can commit even when the response is lost. Reconcile before
    // retrying; record creation is also idempotent for this run/approval step.
    await refresh()
    if (!canRequest()) return
    const saved = state.worklogs.find(w => String(w.data.runId ?? '') === String(runId) &&
      (w.data.approvalStepId === ready.id || (firstApproval && !w.data.approvalStepId)))
    if (saved?.status === 'submitted' && state.approvals.some(a => a.worklogId === saved.id && a.status === 'PENDING')) {
      const review = state.approvals.find(a => a.worklogId === saved.id && a.status === 'PENDING' && a.stepId === ready.id)
      if (review) window.Understudy.notifyAction('request_review', review.id)
      commit({reviewSync: {runId, stepId: ready.id, status: 'ready'}})
      reviewAttempts.delete(key)
      window.Understudy.log(`Review request for "${ready.label}" confirmed from the server after reconnecting.`, {runId, stepId: ready.id})
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    const attempts = (reviewAttempts.get(key) ?? 0) + 1
    reviewAttempts.set(key, attempts)
    commit({reviewSync: {runId, stepId: ready.id, status: 'error', message}})
    window.Understudy.log(`Review request failed for "${ready.label}": ${message}`)
    // Permanent validation failures need a correction, not an endless retry.
    if ((!(err instanceof ApiError) || err.status >= 500) && attempts < 3)
      setTimeout(() => {
        if (canRequest() && state.reviewSync?.status === 'error') {
          commit({reviewSync: null}); void autoSyncApproval()
        }
      }, 1500 * attempts)
  } finally {
    approvalSyncInFlight = false
    if (isCurrent() && !canRequest()) commit({reviewSync: null})
  }
}

let resumeAttempted = false
let workspaceRestored = false
export function rememberActiveRun(): void {
  if (!state.me) return
  // Completed work is history. Keep it available in the run picker, but do
  // not make a finished graph the next visit's default starting point.
  const runId = window.Understudy.isRunComplete?.() ? null : window.Understudy.currentRunId?.() ?? null
  const processId = window.Understudy.getLoadedProcess?.()?.sourceProcessId
  try {
    // A null selection records an explicit unload. It must not fall back to
    // another tab's playbook after reload.
    sessionStorage.setItem('understudy.selectedRun', JSON.stringify({username: state.me.username, runId, processId}))
  } catch { /* optional browser persistence */ }
}

export function resumeLastPlaybook(): void {
  if (resumeAttempted) return
  resumeAttempted = true
  const gen = sessionGen
  commit({restoration: 'loading'})
  void (async () => {
    try {
      const runs = await listRuns()
      if (gen !== sessionGen) return
      commit({recentRuns: runs.filter((r) => r.status !== 'abandoned')})
      let selected: {username?: string; runId?: string; processId?: string} | null = null
      try { selected = JSON.parse(sessionStorage.getItem('understudy.selectedRun') ?? 'null') } catch { /* optional */ }
      if (selected) {
        if (selected.username === state.me?.username && selected.runId && !window.Understudy.getLoadedProcess?.()) {
          const run = await getRun(selected.runId)
          if (gen === sessionGen && run.status === 'active' && !window.Understudy.getLoadedProcess?.())
            await followPlaybook(run.processId, {silent: true, run})
        }
        return
      }
      // Compatibility for browsers that predate the exact, tab-scoped selection.
      let id: string | null = null
      try { id = localStorage.getItem('understudy.lastPlaybook') } catch { /* optional */ }
      if (id && runs.some((r) => r.processId === id && r.status === 'active') && !window.Understudy.getLoadedProcess?.())
        await followPlaybook(id, {silent: true, resume: true})
    } catch {
      if (gen === sessionGen) commit({restoration: 'error'})
    } finally {
      if (gen === sessionGen && state.restoration === 'loading') commit({restoration: 'ready'})
    }
  })()
}

export function retryRestoration(): void {
  resumeAttempted = false
  resumeLastPlaybook()
}

export function setCaptureDraft(task: string, sample = false): void {
  commit({captureDraft: {task, sample}, draft: {task, hasInput: Boolean(task.trim()), kind: sample ? 'operations' : 'routine work'}})
}

export function resetCaptureDraft(): void {
  commit({captureDraft: {task: '', sample: false}})
}

export function dismissRunStarted(): void {
  commit({ runStarted: null })
}

export function clearCaptureContext(): void {
  commit({ captureContext: null, draft: {}, captureDraft: {task:'',sample:false} })
  try { localStorage.removeItem('understudy.lastPlaybook') } catch { /* optional */ }
}

/** Keep every unfinished teaching session in a worklog-keyed tab registry.
 * The active draft remains in the registry too, so switching work never
 * depends on a later "pause" operation to put it back. */
export function rememberCurrentDraft(): boolean {
  const current = window.Understudy.getLoadedProcess?.()
  if (current?.confirmed) {
    const sourceId = current.sourceWorklogId ?? state.captureContext?.id
    const key = sourceId ? `worklog:${sourceId}` : `draft:${current.title}`
    if (state.pausedDrafts.some(draft => draft.key === key))
      commit({pausedDrafts: state.pausedDrafts.filter(draft => draft.key !== key)})
    return false
  }
  if (!current && !state.captureContext) return false
  const sourceId = current?.sourceWorklogId ?? state.captureContext?.id
  const task = state.worklogs.find(work => work.id === sourceId)?.task
    ?? state.captureContext?.task
    ?? current?.title
    ?? 'Unfinished work entry'
  const title = current?.title ?? (sourceId ? `Process draft from work log #${sourceId}` : 'Unfinished process draft')
  const key = sourceId ? `worklog:${sourceId}` : `draft:${title}`
  const existing = state.pausedDrafts.find(draft => draft.key === key)
  const captureContext = sourceId && String(state.captureContext?.id) === String(sourceId)
    ? state.captureContext ? structuredClone(state.captureContext) : null
    : existing?.captureContext ?? null
  const paused = {
    key,
    task,
    title,
    ...(current ? {map: structuredClone(current)} : {}),
    captureContext,
    pausedAt: Date.now(),
  }
  commit({pausedDrafts: [paused, ...state.pausedDrafts.filter(draft => draft.key !== key)]})
  return true
}

/** Preserve an unfinished page draft before the visitor starts a different
 * work entry. This is tab-scoped working state, not a saved team playbook. */
export function pauseCurrentDraft(): boolean {
  const current = window.Understudy.getLoadedProcess?.()
  const remembered = rememberCurrentDraft()
  if (remembered) window.Understudy.log(`paused unfinished draft "${current?.title ?? state.captureContext?.task ?? 'work entry'}" before starting or continuing a separate work entry`,
    {sourceWorklogId: current?.sourceWorklogId ?? state.captureContext?.id})
  return remembered
}

export function resumePausedDraft(key: string): boolean {
  rememberCurrentDraft()
  const target = state.pausedDrafts.find(draft => draft.key === key)
  if (!target) return false
  commit({captureContext: target.captureContext, captureDraft: {task: '', sample: false},
    draft: {task: target.task, hasInput: true}})
  if (target.map) window.Understudy.draftProcess?.(structuredClone(target.map))
  else window.Understudy.unloadProcess?.()
  window.Understudy.log(`continued paused draft "${target.title}"`,
    {sourceWorklogId: target.map?.sourceWorklogId ?? target.captureContext?.id})
  return true
}

/** Explicit page intent for the visitor's WebMCP agent to pick up. */
export function requestPlaybookCreation(work: Pick<Worklog, 'id' | 'task'>): void {
  commit({captureContext: {id: work.id, task: work.task, creationRequested: true}})
  window.Understudy.log(`requested a NEW playbook from work log #${work.id}: “${work.task}”. Ask about the work before and after it, owners and rules, then draft from the answers for human review.`, {worklogId: work.id, intent: 'create_playbook'})
}

export function setStarterDraft(answerDraft: string): void {
  if (state.captureContext) commit({captureContext: {...state.captureContext, answerDraft}})
}

export function skipStarterQuestion(slot: 'before' | 'after' = 'before'): void {
  if (state.captureContext) commit({captureContext: {...state.captureContext, answerDraft: '',
    ...(slot === 'after' ? {afterSkipped: true} : {starterSkipped: true})}})
}

export async function saveStarterAnswer(worklogId: string, answer: string, slot: 'before' | 'after' = 'before'): Promise<void> {
  if (!answer.trim()) throw new Error('Write an answer, or choose to discuss it with your agent.')
  const gen = sessionGen
  const wl = await api<Worklog>(`/api/worklogs/${worklogId}/discovery`, {slot, answer: answer.trim(), actingAs: state.actingAs})
  if (gen !== sessionGen) return
  commit({worklogs: state.worklogs.map(w => w.id === wl.id ? wl : w),
    ...(state.captureContext?.id === worklogId ? {captureContext: {...state.captureContext, answerDraft: ''}} : {})})
  window.Understudy.log(`answered the starter question for work log #${worklogId}: “${answer.trim()}”`,
    {worklogId, question: slot === 'after' ? FOLLOWUP_QUESTION : STARTER_QUESTION, discovery: wl.data.discovery})
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
  const mapWithMeta = map as Record<string, unknown>
  const sourceId = mapWithMeta.sourceWorklogId ?? state.captureContext?.id
  const latest = state.worklogs.find((w) => w.id === sourceId) ?? state.worklogs.find((w) => w.data.systemGenerated !== true)
  const STOP = new Set(['the','and','with','from','after','before','during','this','that','have','has','was','were','been','still','while','when','onto','into','over'])
  const derivedKeywords = latest
    ? [...new Set(latest.task.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)
        .filter((w) => (w.length > 3 || (w.length > 1 && /[^a-z0-9-]/.test(w))) && !STOP.has(w)))].slice(0, 6)
    : []
  const derivedApplies = latest
    ? {
        kind: latest.kind,
        ...(latest.data.colorChange ? { colorChange: true } : {}),
        ...(derivedKeywords.length ? { keywords: derivedKeywords } : {}),
      }
    : undefined
  const derivedPriority = latest?.urgent ? { urgent: true } : undefined
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
  // The save endpoint does not include a top-level version in either adapter.
  // Return the version we persisted so the panel's next revision is accurate.
  return { ...saved, version }
}

export async function listProcesses(): Promise<ProcessSummary[]> {
  // The agent (and the UI) only ever deal with the latest version per title —
  // older versions may carry outdated action bindings.
  return latestPerTitle(await api<ProcessSummary[]>('/api/processes'))
}

const LEGACY_ACTION_NAMES: Record<string, string> = {
  log_incident: 'log_work_item',
  record_corrective_action: 'record_step_result',
}

/** Playbooks saved before the action rename keep working: bindings are
 *  migrated to the current names whenever a map is loaded. */
function migrateMapActions<T>(map: T): T {
  const m = map as { steps?: Array<{ action?: string }> }
  for (const s of m?.steps ?? []) {
    if (s.action && LEGACY_ACTION_NAMES[s.action]) s.action = LEGACY_ACTION_NAMES[s.action]
  }
  return map
}

export function latestPerTitle(processes: ProcessSummary[]): ProcessSummary[] {
  const latest = new Map<string, ProcessSummary>()
  for (const p of processes) {
    const cur = latest.get(p.title)
    if (!cur || (p.version || 1) > (cur.version || 1)) latest.set(p.title, p)
  }
  return [...latest.values()].sort((a, b) => Number(b.id) - Number(a.id))
}

export async function getProcess(id: string): Promise<{ id: string; title: string; map: unknown; createdBy: string }> {
  const p = await api<{ id: string; title: string; map: unknown; createdBy: string }>(`/api/processes/${id}`)
  p.map = migrateMapActions(p.map)
  return p
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
  events?: import('../sdk/types').RunEvent[]
  id: string
  processId: string
  title: string
  startedBy: string
  startedAt: number
  updatedAt: number
  status: 'active' | 'completed' | 'abandoned'
  steps: RunStep[]
  decisions?: unknown[]
  deviations: number
}

export async function startRun(processId: string, map: { title: string }): Promise<{ id: string }> {
  return api<ProcessRun>('/api/runs', { processId, title: map.title, actingAs: state.actingAs })
}

export async function updateRun(
  runId: string,
  payload: { steps: unknown[]; status?: string; deviations?: number },
): Promise<void> {
  await api(`/api/runs/${runId}`, { ...payload, actingAs: state.actingAs })
}

export async function listRuns(processId?: string, page?: {before?: string; limit?: number}): Promise<ProcessRun[]> {
  const params = [processId ? `processId=${encodeURIComponent(processId)}` : '', page?.before ? `before=${encodeURIComponent(page.before)}` : '', page?.limit ? `limit=${page.limit}` : ''].filter(Boolean)
  return api<ProcessRun[]>(`/api/runs${params.length ? `?${params.join('&')}` : ''}`)
}

export async function getRun(runId: string): Promise<ProcessRun> {
  return api<ProcessRun>(`/api/runs/${runId}`)
}

export async function reviseFromProblem(run: ProcessRun, event: NonNullable<ProcessRun['events']>[number]): Promise<void> {
  await window.Understudy.flushRun?.()
  const latest = latestPerTitle(state.processes).find((p) => p.title === run.title)
  const p = await getProcess(latest?.id ?? run.processId)
  window.Understudy.draftRevision?.({...p.map as UnderstudyProcessMap,
    ...{revisionContext: {runId: run.id, stepId: event.stepId, problem: event.note}}}, p.id)
  try { localStorage.removeItem('understudy.lastPlaybook') } catch { /* optional */ }
  window.Understudy.log(`Draft revision from run #${run.id}: ${event.note}. Ask the human how to improve the procedure, then show the change for confirmation.`, {problem: event})
}

export async function listProcessesRaw(): Promise<ProcessSummary[]> {
  return api<ProcessSummary[]>('/api/processes')
}

export interface VersionDiff {
  prevVersion: number
  added: string[]
  removed: string[]
  changed: Array<{ label: string; changes: string[] }>
}

function describeCriteria(criteria: Record<string, Record<string, unknown>> = {}, fields: UnderstudyFieldDef[] = []): string {
  const operators: Record<string, string> = {eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤'}
  return Object.entries(criteria).flatMap(([key, rule]) => {
    const field = fields.find(f => f.key === key)
    return Object.entries(rule).map(([op, value]) => `${field?.label ?? key} ${operators[op] ?? op} ${String(value)}${field?.unit ? ` ${field.unit}` : ''}`)
  }).join(' and ') || 'no recorded condition'
}

function describeField(field: UnderstudyFieldDef): string {
  return [field.type === 'select' ? `dropdown: ${(field.options ?? []).join(' / ')}` : field.type,
    field.unit ? `unit: ${field.unit}` : '', field.required || field.confirm ? 'required' : 'optional',
    field.confirm ? 'must be confirmed' : ''].filter(Boolean).join(' · ')
}

/** Human-readable structural diff of a playbook vs its previous version. */
export async function diffWithPrevious(p: {
  title: string
  map: UnderstudyProcessMap
}): Promise<VersionDiff | null> {
  const all = await listProcessesRaw()
  const prior = all
    .filter((x) => x.title === p.title && (x.version || 1) < (p.map.version || 1))
    .sort((a, b) => (b.version || 1) - (a.version || 1))[0]
  if (!prior) return null
  const prev = await getProcess(prior.id)
  const prevMap = prev.map as UnderstudyProcessMap
  const cur = new Map(p.map.steps.map((s) => [s.id, s]))
  const old = new Map(prevMap.steps.map((s) => [s.id, s]))
  const added = p.map.steps.filter((s) => !old.has(s.id)).map((s) => s.label)
  const removed = prevMap.steps.filter((s) => !cur.has(s.id)).map((s) => s.label)
  const changed: Array<{ label: string; changes: string[] }> = []
  for (const s of p.map.steps) {
    const o = old.get(s.id)
    if (!o) continue
    const c: string[] = []
    if (o.label !== s.label) c.push(`renamed from “${o.label}”`)
    if (o.type !== s.type) c.push(`type ${o.type} → ${s.type}`)
    if ((o.detail ?? '') !== (s.detail ?? '')) c.push(`instructions: “${o.detail ?? '—'}” → “${s.detail ?? '—'}”`)
    if ((o.action ?? '') !== (s.action ?? '')) c.push(`action ${o.action ?? 'manual'} → ${s.action ?? 'manual'}`)
    if ((o.role ?? '') !== (s.role ?? '')) c.push(`owner ${o.role ?? 'anyone'} → ${s.role ?? 'anyone'}`)
    if (o.approvalPurpose !== s.approvalPurpose) c.push(`approval purpose: ${o.approvalPurpose ?? 'unspecified'} → ${s.approvalPurpose ?? 'unspecified'}`)
    const of_ = (o.fields ?? []).join(','), nf = (s.fields ?? []).join(',')
    if (of_ !== nf) c.push(`captures [${nf || '—'}] (was [${of_ || '—'}])`)
    const oe = (o.next ?? []).length, ne = (s.next ?? []).length
    if (oe !== ne) c.push(`${ne} outgoing branch(es) (was ${oe})`)
    if (JSON.stringify((o.next ?? []).map((e) => e.to)) !== JSON.stringify((s.next ?? []).map((e) => e.to)))
      c.push(`next steps: ${(o.next ?? []).map((e) => e.to).join(', ') || 'end'} → ${(s.next ?? []).map((e) => e.to).join(', ') || 'end'}`)
    for (const edge of s.next ?? []) {
      const oldEdge = (o.next ?? []).find((x) => x.to === edge.to)
      const target = cur.get(edge.to)?.label ?? edge.to
      if (!oldEdge) {
        c.push(`new route to “${target}”: ${describeCriteria(edge.criteria, p.map.fields)}${edge.condition ? ` (${edge.condition})` : ''}`)
        continue
      }
      if ((oldEdge.condition ?? '') !== (edge.condition ?? ''))
        c.push(`condition → ${edge.to}: “${edge.condition ?? '—'}” (was “${oldEdge.condition ?? '—'}”)`)
      const oc = JSON.stringify(oldEdge.criteria ?? {})
      const nc = JSON.stringify(edge.criteria ?? {})
      if (oc !== nc) c.push(`condition for “${target}”: ${describeCriteria(oldEdge.criteria, prevMap.fields)} → ${describeCriteria(edge.criteria, p.map.fields)}`)
    }
    if (c.length) changed.push({ label: s.label, changes: c })
  }
  const oldFields = new Map((prevMap.fields ?? []).map(f => [f.key, f]))
  const newFields = new Map((p.map.fields ?? []).map(f => [f.key, f]))
  for (const [key, field] of newFields) {
    const oldField = oldFields.get(key)
    if (!oldField) changed.push({label: `Input added: ${field.label ?? key}`, changes: [describeField(field)]})
    else if (JSON.stringify(field) !== JSON.stringify(oldField)) {
      const changes = []
      if (field.label !== oldField.label) changes.push(`renamed from “${oldField.label ?? key}”`)
      if (describeField(field) !== describeField(oldField)) changes.push(`${describeField(oldField)} → ${describeField(field)}`)
      if (changes.length) changed.push({label: `Input changed: ${field.label ?? key}`, changes})
    }
  }
  for (const [key, field] of oldFields) if (!newFields.has(key)) changed.push({label: `Input removed: ${field.label ?? key}`, changes: [describeField(field)]})
  for (const key of ['appliesWhen', 'priorityWhen'] as const) {
    if (JSON.stringify(prevMap[key] ?? null) !== JSON.stringify(p.map[key] ?? null))
      changed.push({label: key === 'appliesWhen' ? 'When to use this playbook' : 'Priority conditions', changes:
        [...new Set([...Object.keys(prevMap[key] ?? {}), ...Object.keys(p.map[key] ?? {})])]
          .filter(k => JSON.stringify(prevMap[key]?.[k]) !== JSON.stringify(p.map[key]?.[k]))
          .map(k => `${k}: ${String(prevMap[key]?.[k] ?? 'not set')} → ${String(p.map[key]?.[k] ?? 'not set')}`)})
  }
  return { prevVersion: prior.version || 1, added, removed, changed }
}

export async function deleteProcess(id: string): Promise<void> {
  const response = await fetch(`/api/processes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ actingAs: state.actingAs }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new ApiError(response.status, error.detail ?? error.error ?? response.statusText)
  }
  window.Understudy.log(`deleted process ${id} from the library`)
  await refresh()
}

export async function startFreshWorkspace(): Promise<void> {
  await window.Understudy.flushRun?.()
  commit({captureContext: null, captureDraft: {task: '', sample: false}, draft: {}, pausedDrafts: [], reviewSync: null, runStarted: null, dismissedSuggestions: []})
  try {
    localStorage.removeItem('understudy.lastPlaybook')
  } catch {
    /* ignore */
  }
  window.Understudy.unloadProcess?.()
  window.Understudy.log('Started a new work item in this tab. Saved playbooks, runs and review records are preserved.')
}
