import type { ActionEntry, ActionSource } from './types'

type Listener = () => void

let nextId = 1
const entries: ActionEntry[] = []
const listeners = new Set<Listener>()

export function record(
  source: ActionSource,
  kind: string,
  label: string,
  detail?: unknown,
): ActionEntry {
  const entry: ActionEntry = {
    id: nextId++,
    ts: Date.now(),
    source,
    kind,
    label,
    detail,
    page: location.pathname,
  }
  entries.push(entry)
  if (entries.length > 500) entries.splice(0, entries.length - 500)
  listeners.forEach((fn) => fn())
  return entry
}

export function since(cursor = 0, limit = 50): ActionEntry[] {
  return entries.filter((e) => e.id > cursor).slice(-limit)
}

export function all(): readonly ActionEntry[] {
  return entries
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
