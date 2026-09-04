declare const __BUILD__: string
interface UnderstudyHostAction {
  roles?: string[]
  selfReporting?: boolean
  name: string
  description: string
  params?: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string; required?: boolean }>
  handler: (params: Record<string, unknown>) => unknown | Promise<unknown>
  precondition?: () => string | null
  hidden?: boolean
}

interface UnderstudyFieldDef {
  confirm?: boolean
  key: string
  label?: string
  type: 'number' | 'string' | 'boolean' | 'select'
  options?: string[]
  unit?: string
  required?: boolean
}

interface UnderstudyElicitationRecord {
  incident?: string
  cues?: string[]
  noviceMistake?: string
  boundaries?: string[]
  failureRecovery?: string
  unspeakable?: string[]
  answers: Array<{
    questionId: string
    question: string
    answer: string
    stage: 'incident' | 'cues' | 'novice_mistake' | 'boundary' | 'failure_recovery'
    answeredAt: number
    disposition: 'accepted' | 'declined' | 'needs_probe' | 'unspeakable'
  }>
  confirmed?: boolean
  confirmedBy?: string
  confirmedAt?: number
}

interface UnderstudyProcessMap {
  events?: import('../sdk/types').RunEvent[]
  title: string
  steps: Array<{
    id: string
    label: string
    type: 'task' | 'decision' | 'approval'
    approvalPurpose?: 'work' | 'plan'
    detail?: string
    action?: string
    humanOnly?: boolean
    role?: string
    fields?: string[]
    done?: boolean
    resultId?: string
    completedBy?: string
    completedAt?: number
    resultData?: Record<string, unknown>
    elicitation?: UnderstudyElicitationRecord
    next?: Array<{ to: string; condition?: string; criteria?: Record<string, Record<string, unknown>> }>
  }>
  confirmed?: boolean
  saving?: boolean
  saveError?: string
  version?: number
  decisions?: Array<{ stepId: string; to: string; reason?: string; ts?: number; invalidated?: boolean }>
  fields?: UnderstudyFieldDef[]
  appliesWhen?: Record<string, unknown>
  priorityWhen?: Record<string, unknown>
  sourceWorklogId?: string
  sourceProcessId?: string
  elicitationVersion?: 1
  elicitationExpandedSteps?: string[]
  draftMode?: 'evidence-only'
}

interface UnderstudyProcessSummary {
  id: string
  title: string
  createdBy?: string
  createdAt?: number
}

interface UnderstudyApi {
  init(opts?: {
    appName?: string
    panelInitiallyCollapsed?: boolean
    autoCapture?: 'full' | 'min' | 'off'
    stateProvider?: () => unknown
    actions?: UnderstudyHostAction[]
    processStore?: {
      save(map: UnderstudyProcessMap): Promise<UnderstudyProcessSummary>
      list(): Promise<UnderstudyProcessSummary[]>
      load(id: string): Promise<{ map: UnderstudyProcessMap; title?: string; createdBy?: string }>
      findRelevant?: () => unknown
      saveVerification?: (
        measurements: Record<string, unknown>,
        meta: {
          stepId: string
          branchTo: string
          producedIds: Array<{ step: string; action?: string; id: string }>
          branchLabel?: string
          toApproval?: boolean
          criteriaChecked?: boolean
        },
      ) => void | Promise<unknown>
      startRun?: (processId: string, map: UnderstudyProcessMap) => Promise<{ id: string }>
      readRun?: (runId: string) => Promise<{id: string; status: string; steps: Array<{id?: unknown; status?: unknown}>; decisions?: unknown[]; events?: import('../sdk/types').RunEvent[]}>
      updateRun?: (
        runId: string,
        payload: {
      steps: unknown[]
      decisions?: unknown[]
      events?: import('../sdk/types').RunEvent[]
      status?: 'active' | 'completed'
      deviations?: number
    },
      ) => Promise<unknown>
    }
    branchResolver?: (condition: string) => boolean | undefined
  }): void
  log(label: string, detail?: unknown): void
  registerAction(action: UnderstudyHostAction): void
  loadProcess(map: UnderstudyProcessMap, meta?: { id?: string; createdBy?: string
      resume?: { runId: string; steps?: unknown[]; decisions?: unknown[]; events?: import('../sdk/types').RunEvent[] }
    }): void
  notifyAction(name: string, resultId?: string): void
  draftRevision?(map: UnderstudyProcessMap, sourceId: string): void
  draftProcess?(map: UnderstudyProcessMap): void
  unloadProcess?(): void
  currentRunId?(): string | null
  getRunStartError?(): string | null
  getRunSyncError?(): string | null
  flushRun?(): Promise<void>
  refreshRunState?(): Promise<boolean>
  isRunComplete?(): boolean
  isRunStarting?(): boolean
  getProgress?(): Array<{ id: string; label: string; type: string; role?: string; fields?: string[]; status?: string; done?: boolean }>
  completeStep?(stepId: string, values?: Record<string, unknown>): { ok: boolean; error?: string }
  openPanel?(): void
  closePanel?(): void
  openUsageGuide?(language?: 'en' | 'ko', topic?: 'overview' | 'usage'): boolean
  getInteractionState?(): { registered: boolean; active: boolean; connected: boolean; questions: number; approvals: number; interview?: {asked: number; answered: number} }
  getPendingDecision?(): { id: string; label: string } | null
  reportProblem?(stepId: string, note: string): void
  getLoadedProcess(): UnderstudyProcessMap | null
}

interface Window {
  Understudy: UnderstudyApi
}
