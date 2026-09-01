import type { MapEdit, ProcessMap, Step, StepType } from './types'
import { record } from './journal'

type Listener = () => void

let map: ProcessMap | null = null
let nextEditId = 1
const edits: MapEdit[] = []
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((fn) => fn())
}

export function getMap(): ProcessMap | null {
  return map
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Agent proposes a full map (replaces the current draft). */
export function proposeMap(next: ProcessMap): void {
  map = { ...next, confirmed: false }
  record('agent', 'map', `proposed process map "${next.title}" (${next.steps.length} steps)`)
  notify()
}

function pushEdit(edit: Omit<MapEdit, 'id' | 'ts'>): void {
  edits.push({ id: nextEditId++, ts: Date.now(), ...edit })
  if (edits.length > 200) edits.splice(0, edits.length - 200)
}

/** Human edits made through the panel UI. Journaled so the agent can read them back. */
export function humanEditStep(stepId: string, field: 'label' | 'detail' | 'type', to: string): void {
  if (!map) return
  const step = map.steps.find((s) => s.id === stepId)
  if (!step) return
  const from = String(step[field] ?? '')
  if (from === to) return
  if (field === 'type') step.type = to as StepType
  else step[field] = to
  pushEdit({ stepId, field, from, to })
  record('user', 'map', `edited step "${step.label}": ${field} → ${to}`)
  notify()
}

export function humanEditCondition(stepId: string, targetId: string, to: string): void {
  if (!map) return
  const step = map.steps.find((s) => s.id === stepId)
  const branch = step?.next?.find((b) => b.to === targetId)
  if (!step || !branch) return
  const from = branch.condition ?? ''
  if (from === to) return
  branch.condition = to
  pushEdit({ stepId, field: `condition→${targetId}`, from, to })
  record('user', 'map', `edited branch condition on "${step.label}"`)
  notify()
}

export function humanRemoveStep(stepId: string): void {
  if (!map) return
  const idx = map.steps.findIndex((s) => s.id === stepId)
  if (idx < 0) return
  const [removed] = map.steps.splice(idx, 1)
  // Rewire: anything pointing at the removed step now points at its successors.
  const successors = removed.next ?? []
  for (const s of map.steps) {
    if (!s.next) continue
    if (s.next.some((b) => b.to === stepId)) {
      s.next = s.next.filter((b) => b.to !== stepId).concat(successors)
    }
  }
  pushEdit({ stepId, field: 'removed', from: removed.label })
  record('user', 'map', `removed step "${removed.label}"`)
  notify()
}

export function humanConfirmMap(): void {
  if (!map) return
  map.confirmed = true
  pushEdit({ field: 'confirmed', to: 'true' })
  record('user', 'map', `confirmed process "${map.title}"`)
  notify()
}

export function editsSince(cursor = 0): MapEdit[] {
  return edits.filter((e) => e.id > cursor)
}

export function orderedSteps(): Step[] {
  return map ? map.steps : []
}
