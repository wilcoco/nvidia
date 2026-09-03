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
  /** Measurements that passed the decision criteria (post-adjustment values). */
  verification?: Record<string, number | string | boolean>
  verifiedAt?: string
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
  id: string
  worklogId: string
  requestedBy: string
  approver: string
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
  me: UserInfo | null
  authChecked: boolean
  actingAs: string
  users: UserInfo[]
  worklogs: Worklog[]
  approvals: Approval[]
  processes: ProcessSummary[]
  draft: DraftContext
  dismissedSuggestions: string[]
  runStarted: { title: string; version?: number; next?: string } | null
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
  runStarted: null,
}

const listeners = new Set<() => void>()

function commit(patch: Partial<AppState>) {
  try {
    window.dispatchEvent(new CustomEvent('understudy:host-state'))
  } catch {
    /* ignore */
  }
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
    resumeLastPlaybook()
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
  try {
    localStorage.removeItem('understudy.lastPlaybook')
  } catch {
    /* ignore */
  }
  window.Understudy.unloadProcess?.()
  commit({ me: null })
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
  window.Understudy.notifyAction('log_work_item', wl.id)
  await refresh()
  return wl
}

export async function requestApproval(
  worklogId: string,
  approver: string,
  asPersona?: string,
): Promise<Approval> {
  const approval = await api<Approval>(`/api/worklogs/${worklogId}/submit`, {
    approver,
    actingAs: asPersona ?? state.actingAs,
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
  // An approval advances the loaded run ONLY when it belongs to that run —
  // approving unrelated work must never tick another run's sign-off step.
  const runId = window.Understudy.currentRunId?.()
  const targetRunId = wl?.data.runId != null ? String(wl.data.runId) : null
  if (runId && targetRunId === String(runId)) {
    window.Understudy.notifyAction(decision === 'APPROVED' ? 'approve_review' : 'reject_review', decided.id)
  } else if (targetRunId && decision === 'APPROVED') {
    // The reviewed entry belongs to a run that is NOT on screen: its server
    // row must still converge — sign-off done (with approver, time, review
    // id) and, when nothing else is open, the run completed.
    try {
      const runs = await listRuns()
      const row = runs.find((r) => String(r.id) === targetRunId)
      if (row && row.status !== 'abandoned' && Array.isArray(row.steps)) {
        const steps = row.steps.map((s) => ({ ...s })) as Array<Record<string, unknown>>
        const signoff = steps.find(
          (s) => s.type === 'approval' && !['done', 'not_applicable'].includes(String(s.status ?? '')),
        )
        if (signoff) {
          signoff.status = 'done'
          signoff.completedBy = state.actingAs
          signoff.completedAt = Date.now()
          signoff.resultId = decided.id
        }
        const stillOpen = steps.some(
          (s) =>
            s.type !== 'approval' &&
            ['ready', 'blocked', 'skipped', 'pending'].includes(String(s.status ?? '')),
        )
        const approvalsLeft = steps.some(
          (s) => s.type === 'approval' && !['done', 'not_applicable'].includes(String(s.status ?? '')),
        )
        await updateRun(row.id, {
          steps,
          ...(!stillOpen && !approvalsLeft ? { status: 'completed' } : {}),
        })
        window.Understudy.log(
          `approval recorded on run #${targetRunId}: sign-off completed by ${state.actingAs}${!stillOpen && !approvalsLeft ? ' — run completed' : ''}`,
          { approvalId },
        )
      }
    } catch {
      /* the run row converges on its next sync if this patch fails */
    }
  } else if (runId) {
    window.Understudy.log(
      `review decision on "${wl?.task ?? decided.worklogId}" recorded — no run of its own to advance`,
      { approvalId },
    )
  }
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
  window.Understudy.notifyAction('record_step_result', worklogId)
  await refresh()
  return wl
}

export async function saveVerification(
  worklogId: string,
  measurements: Record<string, unknown>,
  route?: { label?: string; pass?: boolean; checked?: boolean },
): Promise<void> {
  await api(`/api/worklogs/${worklogId}/verification`, { measurements, route })
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
  kind: (v) => `incident type: ${v}`,
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
  opts?: { silent?: boolean; resume?: boolean },
): Promise<void> {
  const p = await getProcess(processId)
  let resume: { runId: string; steps?: unknown[]; decisions?: unknown[] } | undefined
  if (opts?.resume) {
    try {
      const runs = await listRuns(processId)
      // Active first; a completed run only when nothing is in progress.
      const usable = runs.filter(
        (r) => r.status !== 'abandoned' && Array.isArray(r.steps) && r.steps.length > 0,
      )
      const target = usable.find((r) => r.status === 'active') ?? usable[0]
      if (target) resume = { runId: target.id, steps: target.steps, decisions: target.decisions }
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
  window.Understudy.loadProcess(p.map as never, {
    id: p.id,
    createdBy: p.createdBy,
    ...(resume ? { resume } : {}),
  })
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
      version: (p as { version?: number }).version,
      next: next?.label,
    },
  })
}

/** When the run reaches its approval step, the linked entry's review request
 *  is created automatically and routed to a persona of the step's role. */
let approvalSyncInFlight = false
function contributorPersonaFor(): string | undefined {
  const me = state.users.find((u) => u.username === state.actingAs)
  if (me?.role === 'Contributor') return me.username
  return state.users.find((u) => u.role === 'Contributor')?.username
}

export async function autoSyncApproval(): Promise<void> {
  if (approvalSyncInFlight) return
  const runId = window.Understudy.currentRunId?.()
  if (!runId) return
  const prog = window.Understudy.getProgress?.() ?? []
  // The sign-off step shows 'blocked' (no pending review) until we create one —
  // both statuses mean "the run has arrived at sign-off".
  const readyApproval = prog.find(
    (p) => p.type === 'approval' && (p.status === 'ready' || p.status === 'blocked'),
  )
  if (!readyApproval) return
  // Everything before the sign-off must actually be handled.
  const before = prog.slice(0, prog.findIndex((p) => p.id === readyApproval.id))
  if (before.some((p) => !p.done && p.status !== 'not_applicable' && p.type !== 'decision')) return
  // Any draft of this run — the synthesized completion record included — is
  // the review subject; a retry after a failed first request must find it.
  let wl = state.worklogs.find(
    (w) => String(w.data.runId ?? '') === String(runId) && w.status === 'draft',
  )
  const proc = window.Understudy.getLoadedProcess?.()
  if (!proc) return
  if (!wl) {
    // Review already requested/decided only when this run's OWN record has
    // moved past draft — a stale runId on an old, unrelated entry never
    // suppresses the review.
    if (
      state.worklogs.some(
        (w) =>
          String(w.data.runId ?? '') === String(runId) &&
          w.data.systemGenerated === true &&
          w.status !== 'draft',
      )
    )
      return
    // Pure task-card runs produce no entry of their own — synthesize the run's
    // completion record (with every submitted step value as evidence) so the
    // review has a subject. Server still enforces the Contributor role.
    // The record is attributed to a Contributor persona (the run's doer) even
    // if a Reviewer persona is active when the run reaches sign-off.
    const contributor =
      state.users.find((u) => u.username === state.actingAs && u.role === 'Contributor')?.username ??
      state.users.find((u) => u.role === 'Contributor')?.username
    if (!contributor) return
    const evidence: Record<string, unknown> = {}
    for (const s of proc.steps) if (s.resultData) Object.assign(evidence, s.resultData)
    approvalSyncInFlight = true
    try {
      wl = await api<Worklog>('/api/worklogs', {
        date: new Date().toISOString().slice(0, 10),
        line: 'A',
        task: `${proc.title} — run #${runId} completion record`,
        hours: 0,
        note: '',
        urgent: false,
        kind: ((proc as { appliesWhen?: { kind?: string } }).appliesWhen?.kind as string) ?? 'development',
        data: { ...evidence, runId, systemGenerated: true },
        progressPct: 100,
        actingAs: contributor,
      })
      window.Understudy.log(
        `completion record for run #${runId} created automatically (attributed to ${contributor})`,
        { worklogId: wl.id },
      )
      await refresh()
    } catch {
      approvalSyncInFlight = false
      return
    }
    approvalSyncInFlight = false
  }
  const role = proc.steps.find((s) => s.id === readyApproval.id)?.role ?? 'Reviewer'
  const approver =
    state.users.find((u) => u.role === role && u.username !== state.me?.username)?.username ?? 'lee'
  approvalSyncInFlight = true
  void requestApproval(wl.id, approver, contributorPersonaFor())
    .then(() => {
      window.Understudy.log(
        `review request created automatically — the run reached "${readyApproval.label}" and was routed to ${approver}`,
        { worklogId: wl.id },
      )
    })
    .catch(() => {
      // The 700ms run-sync can lag the server gate — retry once it settles.
      setTimeout(() => void autoSyncApproval(), 1500)
    })
    .finally(() => {
      approvalSyncInFlight = false
    })
}

/** Demo stability: a reopened tab restores the map it was following. */
let resumeAttempted = false
export function resumeLastPlaybook(): void {
  if (resumeAttempted) return
  resumeAttempted = true
  if (window.Understudy.getLoadedProcess?.()) return
  void (async () => {
    // Source of truth is the server. Priority: the newest ACTIVE run (work in
    // progress always beats finished work); otherwise the newest completed
    // run, so a finished state still survives a reload.
    try {
      let runs = await listRuns()
      const newestActive = runs.find((r) => r.status === 'active')
      if (newestActive && (!Array.isArray(newestActive.steps) || newestActive.steps.length === 0)) {
        // Its sync may still be in flight — give it one beat and re-read.
        await new Promise((r) => setTimeout(r, 900))
        runs = await listRuns()
      }
      const usable = runs.filter(
        (r) => r.status !== 'abandoned' && Array.isArray(r.steps) && r.steps.length > 0,
      )
      const target = usable.find((r) => r.status === 'active') ?? usable[0]
      if (target) {
        await followPlaybook(target.processId, { silent: true, resume: true })
        return
      }
    } catch {
      /* fall through to the memo */
    }
    let id: string | null = null
    try {
      id = localStorage.getItem('understudy.lastPlaybook')
    } catch {
      return
    }
    if (!id) return
    await followPlaybook(id, { silent: true, resume: true }).catch(() => {
      try {
        localStorage.removeItem('understudy.lastPlaybook')
      } catch {
        /* ignore */
      }
    })
  })()
}

export function dismissRunStarted(): void {
  commit({ runStarted: null })
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
  await api(`/api/runs/${runId}`, payload)
}

export async function listRuns(processId?: string): Promise<ProcessRun[]> {
  return api<ProcessRun[]>(`/api/runs${processId ? `?processId=${processId}` : ''}`)
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
    if ((o.role ?? '') !== (s.role ?? '')) c.push(`owner ${o.role ?? 'anyone'} → ${s.role ?? 'anyone'}`)
    const of_ = (o.fields ?? []).join(','), nf = (s.fields ?? []).join(',')
    if (of_ !== nf) c.push(`captures [${nf || '—'}] (was [${of_ || '—'}])`)
    const oe = (o.next ?? []).length, ne = (s.next ?? []).length
    if (oe !== ne) c.push(`${ne} outgoing branch(es) (was ${oe})`)
    for (const edge of s.next ?? []) {
      const oldEdge = (o.next ?? []).find((x) => x.to === edge.to)
      if (!oldEdge) continue
      if ((oldEdge.condition ?? '') !== (edge.condition ?? ''))
        c.push(`condition → ${edge.to}: “${edge.condition ?? '—'}” (was “${oldEdge.condition ?? '—'}”)`)
      const oc = JSON.stringify(oldEdge.criteria ?? {})
      const nc = JSON.stringify(edge.criteria ?? {})
      if (oc !== nc) c.push(`criteria → ${edge.to}: ${nc} (was ${oc})`)
    }
    if (c.length) changed.push({ label: s.label, changes: c })
  }
  return { prevVersion: prior.version || 1, added, removed, changed }
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
  try {
    localStorage.removeItem('understudy.lastPlaybook')
  } catch {
    /* ignore */
  }
  window.Understudy.unloadProcess?.()
  window.Understudy.log(`reset demo data (${scope})`)
  await refresh()
}
