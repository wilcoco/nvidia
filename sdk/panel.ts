import * as journal from './journal'
import * as mapstore from './mapstore'
import * as asksStore from './asks'
import * as host from './host'
import { runAsHuman, preconditionFor } from './runner'
import { isRunComplete } from './runsync'
import { isAutoApprove, setAutoApprove } from './settings'
import type { Step } from './types'

const HOST_ID = 'understudy-panel-host'

let webmcpStatus = 'not detected'
export function setWebmcpStatus(status: string): void {
  webmcpStatus = status
  scheduleRender()
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
.panel {
  position: fixed; top: 0; right: 0; height: 100vh; height: 100dvh; width: min(360px, 86vw); z-index: 2147483000;
  background: #0f172a; color: #e2e8f0; display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,.35); font-size: 13px;
}
.panel.collapsed { display: none; }
.fab {
  position: fixed; bottom: 16px; right: 16px; z-index: 2147483000;
  background: #0f172a; color: #fff; border: none; border-radius: 999px;
  padding: 10px 16px; font-size: 13px; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.3);
}
header {
  padding: 12px 14px; display: flex; align-items: center; gap: 8px;
  border-bottom: 1px solid #1e293b; flex: none;
}
header .logo { font-weight: 700; font-size: 14px; color: #fff; }
header .status { font-size: 11px; color: #94a3b8; margin-left: auto; display: flex; align-items: center; gap: 5px; }
header .dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
header .dot.on { background: #34d399; }
header button.close { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 15px; }
.body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 16px; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin: 0 0 8px; }
h2.activity-toggle { cursor: pointer; user-select: none; }
h2.activity-toggle:hover { color: #94a3b8; }
.empty { color: #475569; font-style: italic; }
.invite-box { margin-top: 10px; background: #1e293b; border: 1px dashed #334155; border-radius: 8px; padding: 10px; }
.invite-hint { color: #94a3b8; font-size: 11px; margin-bottom: 6px; }
.invite-text { color: #cbd5e1; font-size: 11px; font-style: italic; margin-bottom: 8px; user-select: text; }
.invite-copy { background: #3b82f6; color: #fff; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.step { background: #1e293b; border: 1px solid #2b3a52; border-radius: 10px; padding: 8px 10px; margin-bottom: 4px; position: relative; }
.step:hover { border-color: #3b5378; }
.step .metarow { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.step .metarow .spacer { flex: 1; }
.step.done { opacity: .55; border-left: 3px solid #34d399; }
.step.done .label { text-decoration: line-through; }
.step.ready { border-left: 3px solid #fbbf24; }
.step.skipped { border-left: 3px solid #ef4444; }
.step.conditional { border-left: 3px dotted #64748b; }
.step.blocked { border-left: 3px solid #f97316; }
.step.not_applicable { opacity: .5; border-left: 3px dotted #94a3b8; }
.step input.chk { accent-color: #34d399; flex: none; margin: 0; }
.step input.chk:disabled { opacity: .4; }
.chip { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; flex: none; }
.chip.ready { background: #fbbf24; color: #451a03; }
.chip.skipped { background: #ef4444; color: #fff; }
.chip.conditional { background: #334155; color: #94a3b8; }
.chip.blocked { background: #f97316; color: #431407; }
.chip.na { background: #475569; color: #cbd5e1; }
.step .blocked-reason { color: #fdba74; font-size: 10px; margin-top: 3px; }
.step .row { display: flex; align-items: center; gap: 6px; }
.step .label { font-weight: 600; font-size: 13px; line-height: 1.35; }
.badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; flex: none; }
.badge.task { background: #1d4ed8; color: #dbeafe; }
.badge.decision { background: #b45309; color: #fef3c7; }
.badge.approval { background: #7c3aed; color: #ede9fe; }
.step .label { flex: 1; cursor: text; color: #f1f5f9; }
.step input.label-edit { flex: 1; background: #0f172a; color: #fff; border: 1px solid #3b82f6; border-radius: 4px; padding: 2px 6px; font-size: 13px; }
.step .detail { color: #94a3b8; font-size: 11px; margin-top: 3px; cursor: text; }
.step .detail-empty { color: #475569; font-style: italic; }
.step input.detail-edit { width: 100%; background: #0f172a; color: #fff; border: 1px solid #3b82f6; border-radius: 4px; padding: 2px 6px; font-size: 11px; margin-top: 3px; }
.step .action-tag { color: #38bdf8; font-size: 10px; margin-top: 2px; }
.step .human-tag { color: #a5b4fc; }
.map-fields { color: #94a3b8; font-size: 11px; margin: -4px 0 8px; }
.map-fields b { color: #cbd5e1; font-weight: 600; }
.step button.del { background: none; border: none; color: #475569; cursor: pointer; flex: none; }
.step button.del:hover { color: #f87171; }
.step select { background: #0f172a; color: #cbd5e1; border: 1px solid #334155; border-radius: 4px; font-size: 10px; }
/* Editing affordances stay out of the way until the card is hovered. */
.step select, .step button.del { opacity: 0; transition: opacity .15s; }
.step:hover select, .step:hover button.del { opacity: 1; }
.step .action-tag { display: none; }
.step:hover .action-tag { display: block; }
.branch { margin: 5px 0 0; padding: 4px 7px; border-radius: 6px; color: #94a3b8; font-size: 11px; display: flex; gap: 5px; align-items: center; flex-wrap: wrap; background: rgba(52,211,153,.07); border: 1px solid rgba(52,211,153,.18); }
.branch.back { background: rgba(248,113,113,.07); border-color: rgba(248,113,113,.2); }
.branch .bglyph { font-weight: 700; flex: none; }
.branch .bglyph.fwd { color: #34d399; }
.branch .bglyph.back { color: #f87171; }
.branch .btarget { color: #cbd5e1; font-weight: 600; }
.flow { display: flex; flex-direction: column; gap: 10px; position: relative; padding-left: 6px; }
.flow svg.edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; overflow: visible; }
.flow-row { display: flex; gap: 8px; position: relative; z-index: 1; }
.flow-row .step { flex: 1; margin-bottom: 0; min-width: 0; }
.node-col { width: 26px; flex: none; position: relative; display: flex; justify-content: center; }
.node { width: 20px; height: 20px; flex: none; border-radius: 50%; background: #0f172a; border: 2px solid #475569; color: #94a3b8; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 6px; z-index: 1; }
.node.task { border-color: #3b82f6; }
.node.decision { border-radius: 4px; transform: rotate(45deg); border-color: #d97706; }
.node.decision .ni { transform: rotate(-45deg); }
.node.approval { border-radius: 6px; border-color: #8b5cf6; }
.node.done { background: #059669; border-color: #34d399; color: #fff; }
.node.ready { background: #f59e0b; border-color: #fbbf24; color: #451a03; animation: nodepulse 1.6s infinite; }
.node.skipped { background: #dc2626; border-color: #ef4444; color: #fff; }
.node.blocked { background: #ea580c; border-color: #f97316; color: #fff; }
.node.conditional { border-style: dashed; }
.node.not_applicable { opacity: .4; }
@keyframes nodepulse { 0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,.55); } 50% { box-shadow: 0 0 0 6px rgba(251,191,36,0); } }
.branch input { background: transparent; color: #fbbf24; border: 1px solid transparent; border-radius: 4px; padding: 1px 5px; font-size: 11px; flex: 1; min-width: 110px; }
.branch input:hover, .branch input:focus { border-color: #334155; background: #0f172a; outline: none; }
.arrow { text-align: center; color: #475569; font-size: 11px; line-height: 1; margin: 1px 0; }
.confirm-bar { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.confirm-bar button { background: #059669; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
.confirmed { color: #34d399; font-weight: 600; font-size: 12px; }
.run-complete { background: #064e3b; color: #6ee7b7; border-radius: 8px; padding: 8px 10px; margin-top: 8px; font-size: 12px; font-weight: 600; }
.map-title { font-weight: 600; color: #fff; margin-bottom: 8px; }
.map-hint { color: #7dd3fc; background: rgba(56,189,248,.08); border: 1px solid rgba(56,189,248,.25); border-radius: 6px; padding: 6px 8px; font-size: 11px; line-height: 1.5; margin-bottom: 8px; }
.card { background: #1e293b; border: 1px solid #3b82f6; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.card .q { color: #f1f5f9; margin-bottom: 8px; }
.card .opts { display: flex; flex-wrap: wrap; gap: 6px; }
.card .opts button { background: #3b82f6; color: #fff; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.card input.freetext { width: 100%; margin-top: 6px; background: #0f172a; color: #fff; border: 1px solid #334155; border-radius: 6px; padding: 5px 8px; font-size: 12px; }
.card.approval-card { border-color: #f59e0b; }
.card .params { font-size: 11px; color: #94a3b8; white-space: pre-wrap; word-break: break-all; margin: 6px 0; max-height: 120px; overflow-y: auto; }
.card .yn { display: flex; gap: 8px; }
.card .yn .yes { background: #059669; } .card .yn .no { background: #475569; }
.card .yn button { color: #fff; border: none; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.j-entry { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid #16202f; align-items: baseline; }
.j-entry .src { font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 3px; flex: none; }
.j-entry .src.user { background: #334155; color: #cbd5e1; }
.j-entry .src.agent { background: #065f46; color: #a7f3d0; }
.j-entry .kind { color: #64748b; font-size: 10px; flex: none; }
.j-entry .lbl { color: #cbd5e1; word-break: break-word; }
footer { flex: none; border-top: 1px solid #1e293b; padding: 10px 14px; display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 12px; }
footer input { accent-color: #3b82f6; }
`

let shadow: ShadowRoot | null = null
let collapsed = false
// The activity journal exists for the agent; humans see a collapsed summary.
let activityOpen = false
let renderQueued = false

export function mountPanel(): void {
  if (document.getElementById(HOST_ID)) return
  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)
  shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = CSS
  shadow.appendChild(style)
  const root = document.createElement('div')
  root.id = 'root'
  shadow.appendChild(root)

  journal.subscribe(scheduleRender)
  mapstore.subscribe(scheduleRender)
  asksStore.subscribe(scheduleRender)
  render()
}

function scheduleRender() {
  if (renderQueued) return
  renderQueued = true
  // setTimeout, not requestAnimationFrame: rAF never fires in hidden tabs,
  // which would freeze the panel while an agent works in the background.
  setTimeout(() => {
    renderQueued = false
    render()
  }, 0)
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function renderStep(
  step: Step,
  index: number,
  container: HTMLElement,
  status?: mapstore.StepStatus,
) {
  const card = el('div', `step${status ? ` ${status}` : ''}`)
  const meta = el('div', 'metarow')
  const row = el('div', 'row')
  if (mapstore.getMap()?.confirmed && step.type !== 'decision') {
    const chk = el('input', 'chk') as HTMLInputElement
    chk.type = 'checkbox'
    chk.checked = !!step.done
    if (step.type === 'approval') {
      // Sign-offs cannot be hand-waved: they complete only through a
      // successful review action.
      chk.disabled = true
      chk.title = 'Approval steps complete only via a successful review action'
    } else {
      chk.title = 'Mark this step done'
      chk.onchange = () => mapstore.humanToggleStepDone(step.id)
    }
    row.appendChild(chk)
  }
  meta.appendChild(el('span', `badge ${step.type}`, step.type))
  if (status === 'ready') meta.appendChild(el('span', 'chip ready', 'NEXT'))
  if (status === 'skipped') meta.appendChild(el('span', 'chip skipped', 'SKIPPED'))
  if (status === 'conditional') meta.appendChild(el('span', 'chip conditional', 'IF'))
  if (status === 'blocked') meta.appendChild(el('span', 'chip blocked', 'BLOCKED'))
  if (status === 'not_applicable') meta.appendChild(el('span', 'chip na', 'N/A'))
  meta.appendChild(el('span', 'spacer'))

  const label = el('span', 'label', step.label)
  label.title = 'Click to rename'
  label.onclick = () => {
    const input = el('input', 'label-edit') as HTMLInputElement
    input.value = step.label
    row.replaceChild(input, label)
    input.focus()
    input.select()
    const commit = () => mapstore.humanEditStep(step.id, 'label', input.value.trim() || step.label)
    input.onkeydown = (e) => {
      if (e.key === 'Enter') commit()
      if (e.key === 'Escape') scheduleRender()
    }
    input.onblur = commit
  }
  row.appendChild(label)

  const typeSel = el('select') as HTMLSelectElement
  for (const t of ['task', 'decision', 'approval']) {
    const opt = el('option', undefined, t) as HTMLOptionElement
    opt.value = t
    if (t === step.type) opt.selected = true
    typeSel.appendChild(opt)
  }
  typeSel.onchange = () => mapstore.humanEditStep(step.id, 'type', typeSel.value)
  meta.appendChild(typeSel)

  const del = el('button', 'del', '✕')
  del.title = 'Remove step'
  del.onclick = () => mapstore.humanRemoveStep(step.id)
  meta.appendChild(del)

  card.appendChild(meta)
  card.appendChild(row)
  if (step.type !== 'decision' || step.detail) {
    const detail = el('div', `detail${step.detail ? '' : ' detail-empty'}`, step.detail || '+ add note')
    detail.title = 'Click to edit this note (judgment rules live here)'
    detail.onclick = () => {
      const input = el('input', 'detail-edit') as HTMLInputElement
      input.value = step.detail ?? ''
      input.placeholder = 'the rule or threshold that guides this step…'
      card.replaceChild(input, detail)
      input.focus()
      const commit = () => mapstore.humanEditStep(step.id, 'detail', input.value.trim())
      input.onkeydown = (e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') scheduleRender()
      }
      input.onblur = commit
    }
    card.appendChild(detail)
  }
  if (step.naReason) card.appendChild(el('div', 'detail', `N/A: ${step.naReason}`))
  if (step.action) card.appendChild(el('div', 'action-tag', `runs: ${step.action}`))
  if (step.humanOnly) card.appendChild(el('div', 'action-tag human-tag', '👤 human step'))
  if (status === 'blocked' && step.action) {
    const reason = preconditionFor(step.action)
    if (reason) card.appendChild(el('div', 'blocked-reason', `⛔ ${reason}`))
  }

  const branches = step.next ?? []
  const map = mapstore.getMap()
  if (branches.length > 1 || branches.some((b) => b.condition)) {
    for (const b of branches) {
      const targetIdx = map?.steps.findIndex((s) => s.id === b.to) ?? -1
      const target = targetIdx >= 0 ? map?.steps[targetIdx] : undefined
      const back = targetIdx >= 0 && targetIdx <= index
      const line = el('div', `branch${back ? ' back' : ''}`)
      line.appendChild(el('span', `bglyph ${back ? 'back' : 'fwd'}`, back ? '⟲' : '↳'))
      line.appendChild(el('span', 'btarget', `${targetIdx >= 0 ? `#${targetIdx + 1} ` : ''}${target?.label ?? b.to}`))
      line.appendChild(el('span', undefined, 'if'))
      const cond = el('input') as HTMLInputElement
      cond.value = b.condition ?? ''
      cond.placeholder = 'condition…'
      cond.onchange = () => mapstore.humanEditCondition(step.id, b.to, cond.value)
      line.appendChild(cond)
      card.appendChild(line)
    }
  }

  const rowWrap = el('div', 'flow-row')
  const nodeCol = el('div', 'node-col')
  const node = el('div', `node ${step.type}${status ? ` ${status}` : ''}`)
  const glyph = status === 'done' ? '✓' : status === 'skipped' ? '✕' : String(index + 1)
  node.appendChild(el('span', 'ni', glyph))
  node.title = `step ${index + 1} · ${step.type}${status ? ` · ${status}` : ''}`
  nodeCol.appendChild(node)
  rowWrap.appendChild(nodeCol)
  rowWrap.appendChild(card)
  container.appendChild(rowWrap)
}

const EDGE_COLORS: Array<[string, string]> = [
  ['arr-gray', '#475569'],
  ['arr-green', '#34d399'],
  ['arr-amber', '#fbbf24'],
  ['arr-red', '#f87171'],
]

// Draws every step-to-step edge as a real flowchart line over the node
// column: straight gray for linear flow, green/amber curves for forward
// branches (taken/undecided), dashed red loop-backs, dimmed when the
// target ended up not applicable.
function drawEdges(flow: HTMLElement) {
  flow.querySelector('svg.edges')?.remove()
  const map = mapstore.getMap()
  if (!map || map.steps.length < 2) return
  const statuses = mapstore.progress(preconditionFor)
  const rows = Array.from(flow.querySelectorAll(':scope > .flow-row')) as HTMLElement[]
  const flowRect = flow.getBoundingClientRect()
  if (flowRect.height === 0) return
  const pos = new Map<string, { x: number; top: number; bottom: number; mid: number }>()
  map.steps.forEach((st, i) => {
    const node = rows[i]?.querySelector('.node')
    if (!node) return
    const r = node.getBoundingClientRect()
    pos.set(st.id, {
      x: r.left - flowRect.left + r.width / 2,
      top: r.top - flowRect.top,
      bottom: r.bottom - flowRect.top,
      mid: r.top - flowRect.top + r.height / 2,
    })
  })
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'edges')
  const defs = document.createElementNS(NS, 'defs')
  for (const [id, color] of EDGE_COLORS) {
    const m = document.createElementNS(NS, 'marker')
    m.setAttribute('id', id)
    m.setAttribute('markerUnits', 'userSpaceOnUse')
    m.setAttribute('markerWidth', '8')
    m.setAttribute('markerHeight', '8')
    m.setAttribute('refX', '6.5')
    m.setAttribute('refY', '4')
    m.setAttribute('orient', 'auto')
    const tri = document.createElementNS(NS, 'polygon')
    tri.setAttribute('points', '0 0, 8 4, 0 8')
    tri.setAttribute('fill', color)
    m.appendChild(tri)
    defs.appendChild(m)
  }
  svg.appendChild(defs)
  const idx = new Map(map.steps.map((st, i) => [st.id, i] as const))
  map.steps.forEach((st, i) => {
    const edges =
      st.next && st.next.length
        ? st.next
        : i < map.steps.length - 1
          ? [{ to: map.steps[i + 1].id, condition: undefined }]
          : []
    for (const e of edges) {
      const j = idx.get(e.to)
      const a = pos.get(st.id)
      const b = j === undefined ? undefined : pos.get(e.to)
      if (j === undefined || !a || !b) continue
      const back = j <= i
      const isBranch = (st.next?.length ?? 0) > 1 || !!e.condition
      const tStatus = statuses.get(e.to)
      let color = '#475569'
      let marker = 'arr-gray'
      let dash = ''
      let opacity = '1'
      if (back) {
        color = '#f87171'
        marker = 'arr-red'
        dash = '4 3'
      } else if (isBranch) {
        if (tStatus === 'conditional') {
          color = '#fbbf24'
          marker = 'arr-amber'
        } else {
          color = '#34d399'
          marker = 'arr-green'
        }
      }
      if (tStatus === 'not_applicable') opacity = '.3'
      let d: string
      if (!back && j === i + 1) {
        d = `M ${a.x} ${a.bottom + 2} L ${b.x} ${b.top - 4}`
      } else if (!back) {
        const bulge = 13 + Math.min(9, (j - i) * 3)
        d = `M ${a.x} ${a.bottom + 2} C ${a.x - bulge} ${a.bottom + 22}, ${b.x - bulge} ${b.top - 22}, ${b.x} ${b.top - 4}`
      } else {
        const bulge = 24
        d = `M ${a.x - 11} ${a.mid} C ${a.x - bulge} ${a.mid}, ${b.x - bulge} ${b.mid}, ${b.x - 12} ${b.mid}`
      }
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', d)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color)
      path.setAttribute('stroke-width', '2')
      if (dash) path.setAttribute('stroke-dasharray', dash)
      path.setAttribute('opacity', opacity)
      path.setAttribute('marker-end', `url(#${marker})`)
      svg.appendChild(path)
    }
  })
  flow.insertBefore(svg, flow.firstChild)
}

function render() {
  if (!shadow) return
  const root = shadow.getElementById('root')
  if (!root) return
  root.innerHTML = ''

  // Let the host page adapt its layout to the panel (e.g. release the
  // right-hand margin when the panel is minimized on narrow screens).
  document.documentElement.setAttribute('data-understudy-panel', collapsed ? 'collapsed' : 'open')

  const fab = el('button', 'fab', collapsed ? '🎭 Understudy' : '')
  if (collapsed) {
    fab.onclick = () => {
      collapsed = false
      render()
    }
    root.appendChild(fab)
    return
  }

  const panel = el('div', 'panel')

  // Header
  const header = el('header')
  header.appendChild(el('span', 'logo', '🎭 Understudy'))
  const status = el('span', 'status')
  const dot = el('span', `dot${webmcpStatus === 'connected' ? ' on' : ''}`)
  status.appendChild(dot)
  status.appendChild(el('span', undefined, `WebMCP ${webmcpStatus}`))
  header.appendChild(status)
  const close = el('button', 'close', '—')
  close.onclick = () => {
    collapsed = true
    render()
  }
  header.appendChild(close)
  panel.appendChild(header)

  const body = el('div', 'body')

  // Agent questions
  if (asksStore.asks.length > 0) {
    const section = el('section')
    section.appendChild(el('h2', undefined, 'Agent is asking you'))
    for (const ask of asksStore.asks) {
      const card = el('div', 'card')
      card.appendChild(el('div', 'q', ask.question))
      if (ask.options?.length) {
        const opts = el('div', 'opts')
        for (const o of ask.options) {
          const b = el('button', undefined, o.label)
          b.onclick = async () => {
            if (!o.run) {
              asksStore.answerAsk(ask.id, o.label)
              return
            }
            // Executable option: the click is the consent — run the bound host
            // action now and hand the agent the real outcome.
            b.disabled = true
            b.textContent = `${o.label}…`
            const outcome = await runAsHuman(o.run.name, o.run.params ?? {})
            asksStore.answerAsk(
              ask.id,
              outcome.ok
                ? `${o.label} — executed ${o.run.name} successfully`
                : `${o.label} — ${o.run.name} did not run (${outcome.error})`,
            )
          }
          opts.appendChild(b)
        }
        card.appendChild(opts)
      }
      if (ask.allowText) {
        const input = el('input', 'freetext') as HTMLInputElement
        input.placeholder = 'Type an answer and press Enter…'
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && input.value.trim()) asksStore.answerAsk(ask.id, input.value.trim())
        }
        card.appendChild(input)
      }
      section.appendChild(card)
    }
    body.appendChild(section)
  }

  // Agent action approvals
  if (asksStore.approvals.length > 0) {
    const section = el('section')
    section.appendChild(el('h2', undefined, 'Agent wants to act'))
    for (const req of asksStore.approvals) {
      const card = el('div', 'card approval-card')
      card.appendChild(el('div', 'q', `Run action: ${req.actionName}`))
      card.appendChild(el('div', 'params', JSON.stringify(req.params, null, 1)))
      const yn = el('div', 'yn')
      const yes = el('button', 'yes', 'Approve')
      yes.onclick = () => void asksStore.decideApprovalCard(req.id, true)
      const no = el('button', 'no', 'Deny')
      no.onclick = () => void asksStore.decideApprovalCard(req.id, false)
      yn.appendChild(yes)
      yn.appendChild(no)
      card.appendChild(yn)
      section.appendChild(card)
    }
    body.appendChild(section)
  }

  // Process map
  const mapSection = el('section')
  mapSection.appendChild(el('h2', undefined, 'Process map'))
  const map = mapstore.getMap()
  if (!map) {
    mapSection.appendChild(
      el('div', 'empty', 'No process yet. Do your work — the agent drafts the process around each event: what to prepare and prevent before it, what to verify and sign off after it.'),
    )
    const invite =
      'Work along with me on this page. Watch what I do, guide me with the saved playbooks, and ask me questions when a process is missing knowledge.'
    const tip = el('div', 'invite-box')
    tip.appendChild(el('div', 'invite-hint', 'Using an AI agent? Invite it once:'))
    tip.appendChild(el('div', 'invite-text', `“${invite}”`))
    const copy = el('button', 'invite-copy', '🤖 Copy agent invite')
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(invite)
        copy.textContent = '✓ Copied — paste it to your agent'
        setTimeout(() => (copy.textContent = '🤖 Copy agent invite'), 2500)
      } catch {
        copy.textContent = 'Select and copy the text above'
      }
    }
    tip.appendChild(copy)
    mapSection.appendChild(tip)
  } else {
    mapSection.appendChild(el('div', 'map-title', map.title))
    mapSection.appendChild(
      el(
        'div',
        'map-hint',
        map.confirmed
          ? 'Live guide — the agent follows along as you work. Yellow border = do this next · red = skipped · dotted = only if its branch applies.'
          : "The agent drafted this from your work — it's yours to correct before saving: click any text to reword it, hover a card to change its type (task / decision / approval) or remove it.",
      ),
    )
    if (map.fields?.length) {
      const f = el('div', 'map-fields')
      f.innerHTML = ''
      f.appendChild(el('b', undefined, 'Captures: '))
      f.appendChild(
        document.createTextNode(
          map.fields.map((d) => `${d.label ?? d.key}${d.unit ? ` (${d.unit})` : ''}${d.required ? '*' : ''}`).join(' · '),
        ),
      )
      mapSection.appendChild(f)
    }
    const statuses = mapstore.progress(preconditionFor)
    const flow = el('div', 'flow')
    map.steps.forEach((s, i) => renderStep(s, i, flow, statuses.get(s.id)))
    mapSection.appendChild(flow)
    if (map.confirmed && isRunComplete()) {
      mapSection.appendChild(el('div', 'run-complete', '✓ Playbook run complete — all required steps handled'))
    }
    const bar = el('div', 'confirm-bar')
    if (map.confirmed) {
      bar.appendChild(el('span', 'confirmed', '✓ Confirmed — ready for the agent to run'))
    } else {
      const store = host.getProcessStore()
      const btn = el('button', undefined, store ? 'Confirm & save to library' : 'Confirm process')
      btn.onclick = () =>
        mapstore.humanConfirmMap(store ? (m) => store.save(m) : undefined)
      bar.appendChild(btn)
    }
    mapSection.appendChild(bar)
  }
  body.appendChild(mapSection)

  // Journal — collapsed by default: it is the agent's reading material, not the
  // human's. A count keeps it discoverable without reading like a log dump.
  const jSection = el('section')
  const allEntries = journal.all()
  const jHeader = el('h2', 'activity-toggle', `Activity (${allEntries.length}) ${activityOpen ? '▾' : '▸'}`)
  jHeader.title = activityOpen ? 'Hide the agent-facing activity journal' : 'Show what the agent can read'
  jHeader.onclick = () => {
    activityOpen = !activityOpen
    render()
  }
  jSection.appendChild(jHeader)
  if (activityOpen) {
    const entries = allEntries.slice(-30).reverse()
    if (entries.length === 0) {
      jSection.appendChild(el('div', 'empty', 'Nothing recorded yet.'))
    } else {
      for (const e of entries) {
        const line = el('div', 'j-entry')
        line.appendChild(el('span', `src ${e.source}`, e.source === 'agent' ? 'AGT' : 'YOU'))
        line.appendChild(el('span', 'kind', e.kind))
        line.appendChild(el('span', 'lbl', e.label))
        jSection.appendChild(line)
      }
    }
  }
  body.appendChild(jSection)

  panel.appendChild(body)

  // Footer
  const footer = el('footer')
  const check = el('input') as HTMLInputElement
  check.type = 'checkbox'
  check.checked = isAutoApprove()
  check.onchange = () => {
    setAutoApprove(check.checked)
  }
  const lbl = el('label')
  lbl.appendChild(check)
  lbl.appendChild(document.createTextNode(' Auto-approve agent actions'))
  footer.appendChild(lbl)
  panel.appendChild(footer)

  root.appendChild(panel)
  const flowEl = panel.querySelector('.flow') as HTMLElement | null
  if (flowEl) drawEdges(flowEl)
}
