interface FlowCatchHostAction {
  name: string
  description: string
  params?: Record<string, { type: 'string' | 'number' | 'boolean'; description?: string; required?: boolean }>
  handler: (params: Record<string, unknown>) => unknown | Promise<unknown>
}

interface FlowCatchApi {
  init(opts?: {
    appName?: string
    autoCapture?: 'full' | 'min' | 'off'
    stateProvider?: () => unknown
    actions?: FlowCatchHostAction[]
  }): void
  log(label: string, detail?: unknown): void
  registerAction(action: FlowCatchHostAction): void
}

interface Window {
  FlowCatch: FlowCatchApi
}
