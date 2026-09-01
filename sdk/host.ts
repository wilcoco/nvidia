import type { HostAction, ProcessStoreAdapter } from './types'

let appName = document.title || 'Web app'
let stateProvider: (() => unknown) | null = null
let processStore: ProcessStoreAdapter | null = null
const actions = new Map<string, HostAction>()

export function setProcessStore(store: ProcessStoreAdapter): void {
  processStore = store
}
export function getProcessStore(): ProcessStoreAdapter | null {
  return processStore
}

export function setAppName(name: string): void {
  appName = name
}
export function getAppName(): string {
  return appName
}

export function setStateProvider(fn: () => unknown): void {
  stateProvider = fn
}
export function getState(): unknown {
  return stateProvider ? stateProvider() : { note: 'This app did not register a state provider.' }
}

export function registerAction(action: HostAction): void {
  actions.set(action.name, action)
}
export function getAction(name: string): HostAction | undefined {
  return actions.get(name)
}
export function listActions(): Array<Omit<HostAction, 'handler'>> {
  return Array.from(actions.values()).map(({ name, description, params }) => ({
    name,
    description,
    params,
  }))
}
