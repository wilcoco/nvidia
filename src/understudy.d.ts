interface UnderstudyHostAction {
  name: string
  description: string
  params?: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string; required?: boolean }>
  handler: (params: Record<string, unknown>) => unknown | Promise<unknown>
  precondition?: () => string | null
}

interface UnderstudyProcessMap {
  title: string
  steps: Array<{
    id: string
    label: string
    type: 'task' | 'decision' | 'approval'
    detail?: string
    action?: string
    next?: Array<{ to: string; condition?: string }>
  }>
  confirmed?: boolean
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
      startRun?: (processId: string, map: UnderstudyProcessMap) => Promise<{ id: string }>
      updateRun?: (
        runId: string,
        payload: { steps: unknown[]; status?: 'active' | 'completed'; deviations?: number },
      ) => Promise<unknown>
    }
    branchResolver?: (condition: string) => boolean | undefined
  }): void
  log(label: string, detail?: unknown): void
  registerAction(action: UnderstudyHostAction): void
  loadProcess(map: UnderstudyProcessMap, meta?: { id?: string; createdBy?: string }): void
  notifyAction(name: string, resultId?: string): void
}

interface Window {
  Understudy: UnderstudyApi
}
