interface FlowCatchHostAction {
  name: string
  description: string
  params?: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string; required?: boolean }>
  handler: (params: Record<string, unknown>) => unknown | Promise<unknown>
}

interface FlowCatchProcessMap {
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

interface FlowCatchProcessSummary {
  id: string
  title: string
  createdBy?: string
  createdAt?: number
}

interface FlowCatchApi {
  init(opts?: {
    appName?: string
    autoCapture?: 'full' | 'min' | 'off'
    stateProvider?: () => unknown
    actions?: FlowCatchHostAction[]
    processStore?: {
      save(map: FlowCatchProcessMap): Promise<FlowCatchProcessSummary>
      list(): Promise<FlowCatchProcessSummary[]>
      load(id: string): Promise<{ map: FlowCatchProcessMap; title?: string; createdBy?: string }>
    }
  }): void
  log(label: string, detail?: unknown): void
  registerAction(action: FlowCatchHostAction): void
  loadProcess(map: FlowCatchProcessMap, meta?: { id?: string; createdBy?: string }): void
}

interface Window {
  FlowCatch: FlowCatchApi
}
