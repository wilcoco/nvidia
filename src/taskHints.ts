const STORAGE_KEY = 'understudy.taskHints.v1'
type Scope = { user: string; processId: string; stepId: string; field: UnderstudyFieldDef }
type Hint = {value: string; runId: string}
function key(scope: Scope): string {
  const {field: f} = scope
  return JSON.stringify([scope.user, scope.processId, scope.stepId, f.key, f.type, f.unit ?? '', f.options ?? []])
}
function read(): Record<string, Hint> {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch { return {} }
}
export function taskHint(scope: Scope): Hint | undefined {
  const hint = read()[key(scope)]
  return typeof hint?.value === 'string' && typeof hint?.runId === 'string' ? hint : undefined
}
export function rememberTaskHint(scope: Scope, value: unknown, runId: string): void {
  if (typeof value !== 'number' && typeof value !== 'string') return
  const data = read(), id = key(scope)
  delete data[id]
  data[id] = {value: String(value), runId}
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(data).slice(-100)))) } catch { /* optional convenience */ }
}
