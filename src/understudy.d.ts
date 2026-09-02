interface UnderstudyHostAction {
  roles?: string[]
  name: string
  description: string
  params?: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string; required?: boolean }>
  handler: (params: Record<string, unknown>) => unknown | Promise<unknown>
  precondition?: () => string | null
  hidden?: boolean
}

interface UnderstudyFieldDef {
  key: string
  label?: string
  type: 'number' | 'string' | 'boolean'
  unit?: string
  required?: boolean
}

interface UnderstudyProcessMap {
  title: string
  steps: Array<{
    id: string
    label: string
    type: 'task' | 'decision' | 'approval'
    detail?: string
    action?: string
    humanOnly?: boolean
    role?: string
    fields?: string[]
    done?: boolean
    completedBy?: string
    resultData?: Record<string, unknown>
    next?: Array<{ to: string; condition?: string }>
  }>
  confirmed?: boolean
  fields?: UnderstudyFieldDef[]
  appliesWhen?: Record<string, unknown>
  priorityWhen?: Record<string, unknown>
  sourceWorklogId?: string
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
      updateRun?: (
        runId: string,
        payload: {
      steps: unknown[]
      decisions?: unknown[]
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
      resume?: { runId: string; steps?: unknown[]; decisions?: unknown[] }
    }): void
  notifyAction(name: string, resultId?: string): void
  unloadProcess?(): void
  currentRunId?(): string | null
  getProgress?(): Array<{ id: string; label: string; type: string; role?: string; fields?: string[]; status?: string; done?: boolean }>
  completeStep?(stepId: string, values?: Record<string, unknown>): void
  reportProblem?(stepId: string, note: string): void
  getLoadedProcess(): UnderstudyProcessMap | null
}

interface Window {
  Understudy: UnderstudyApi
}
