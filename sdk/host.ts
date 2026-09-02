import type { HostAction, ProcessStoreAdapter } from './types'

let appName = document.title || 'Web app'
let stateProvider: (() => unknown) | null = null
let processStore: ProcessStoreAdapter | null = null
let branchResolver: ((condition: string) => boolean | undefined) | null = null

export function setBranchResolver(fn: (condition: string) => boolean | undefined): void {
  branchResolver = fn
}
export function getBranchResolver(): ((condition: string) => boolean | undefined) | null {
  return branchResolver
}
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

/** The active persona's role, when the host state exposes actingAs + users[]. */
export function actorRole(): string | undefined {
  try {
    const st = getState() as {
      actingAs?: unknown
      users?: Array<{ username?: unknown; role?: unknown }>
    } | null
    const acting = typeof st?.actingAs === 'string' ? st.actingAs : undefined
    const u = Array.isArray(st?.users) ? st.users.find((x) => x?.username === acting) : undefined
    return typeof u?.role === 'string' ? u.role : undefined
  } catch {
    return undefined
  }
}

export function registerAction(action: HostAction): void {
  actions.set(action.name, action)
}
export function getAction(name: string): HostAction | undefined {
  return actions.get(name)
}
export function listActions(): Array<Omit<HostAction, 'handler'>> {
  return Array.from(actions.values())
    .filter((a) => !a.hidden)
    .map(({ name, description, params }) => ({ name, description, params }))
}
