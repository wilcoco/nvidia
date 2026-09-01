import * as journal from './journal'
import * as mapstore from './mapstore'
import * as asksStore from './asks'
import * as host from './host'
import type { Step } from './types'

const HOST_ID = 'understudy-panel-host'

let autoApprove = false
export function isAutoApprove(): boolean {
  return autoApprove
}

let webmcpStatus = 'not detected'
export function setWebmcpStatus(status: string): void {
  webmcpStatus = status
  scheduleRender()
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
.panel {
  position: fixed; top: 0; right: 0; height: 100vh; width: 360px; z-index: 2147483000;
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
.empty { color: #475569; font-style: italic; }
.step { background: #1e293b; border-radius: 8px; padding: 8px 10px; margin-bottom: 4px; position: relative; }
.step.done { opacity: .55; }
.step.done .label { text-decoration: line-through; }
.step input.chk { accent-color: #34d399; flex: none; margin: 0; }
.step .row { display: flex; align-items: center; gap: 6px; }
.badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; flex: none; }
.badge.task { background: #1d4ed8; color: #dbeafe; }
.badge.decision { background: #b45309; color: #fef3c7; }
.badge.approval { background: #7c3aed; color: #ede9fe; }
.step .label { flex: 1; cursor: text; color: #f1f5f9; }
.step input.label-edit { flex: 1; background: #0f172a; color: #fff; border: 1px solid #3b82f6; border-radius: 4px; padding: 2px 6px; font-size: 13px; }
.step .detail { color: #94a3b8; font-size: 11px; margin-top: 3px; }
.step .action-tag { color: #38bdf8; font-size: 10px; margin-top: 2px; }
.step button.del { background: none; border: none; color: #475569; cursor: pointer; flex: none; }
.step button.del:hover { color: #f87171; }
.step select { background: #0f172a; color: #cbd5e1; border: 1px solid #334155; border-radius: 4px; font-size: 10px; }
.branch { margin: 2px 0 2px 16px; color: #94a3b8; font-size: 11px; display: flex; gap: 4px; align-items: center; }
.branch input { background: #0f172a; color: #fbbf24; border: 1px solid #334155; border-radius: 4px; padding: 1px 5px; font-size: 11px; width: 150px; }
.arrow { text-align: center; color: #475569; font-size: 11px; line-height: 1; margin: 1px 0; }
.confirm-bar { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.confirm-bar button { background: #059669; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
.confirmed { color: #34d399; font-weight: 600; font-size: 12px; }
.map-title { font-weight: 600; color: #fff; margin-bottom: 8px; }
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

function renderStep(step: Step, isLast: boolean, container: HTMLElement) {
  const card = el('div', `step${step.done ? ' done' : ''}`)
  const row = el('div', 'row')
  if (mapstore.getMap()?.confirmed) {
    const chk = el('input', 'chk') as HTMLInputElement
    chk.type = 'checkbox'
    chk.checked = !!step.done
    chk.title = 'Mark this step done'
    chk.onchange = () => mapstore.humanToggleStepDone(step.id)
    row.appendChild(chk)
  }
  row.appendChild(el('span', `badge ${step.type}`, step.type))

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
  row.appendChild(typeSel)

  const del = el('button', 'del', '✕')
  del.title = 'Remove step'
  del.onclick = () => mapstore.humanRemoveStep(step.id)
  row.appendChild(del)

  card.appendChild(row)
  if (step.detail) card.appendChild(el('div', 'detail', step.detail))
  if (step.action) card.appendChild(el('div', 'action-tag', `runs: ${step.action}`))

  const branches = step.next ?? []
  const map = mapstore.getMap()
  if (branches.length > 1 || branches.some((b) => b.condition)) {
    for (const b of branches) {
      const target = map?.steps.find((s) => s.id === b.to)
      const line = el('div', 'branch')
      line.appendChild(el('span', undefined, `→ ${target?.label ?? b.to} if`))
      const cond = el('input') as HTMLInputElement
      cond.value = b.condition ?? ''
      cond.placeholder = 'condition…'
      cond.onchange = () => mapstore.humanEditCondition(step.id, b.to, cond.value)
      line.appendChild(cond)
      card.appendChild(line)
    }
  }

  container.appendChild(card)
  if (!isLast) container.appendChild(el('div', 'arrow', '↓'))
}

function render() {
  if (!shadow) return
  const root = shadow.getElementById('root')
  if (!root) return
  root.innerHTML = ''

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
          const b = el('button', undefined, o)
          b.onclick = () => ask.resolve(o)
          opts.appendChild(b)
        }
        card.appendChild(opts)
      }
      if (ask.allowText) {
        const input = el('input', 'freetext') as HTMLInputElement
        input.placeholder = 'Type an answer and press Enter…'
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && input.value.trim()) ask.resolve(input.value.trim())
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
      yes.onclick = () => req.resolve(true)
      const no = el('button', 'no', 'Deny')
      no.onclick = () => req.resolve(false)
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
      el('div', 'empty', 'No process yet. Work in the app — the agent will draft one from what you do.'),
    )
  } else {
    mapSection.appendChild(el('div', 'map-title', map.title))
    map.steps.forEach((s, i) => renderStep(s, i === map.steps.length - 1, mapSection))
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

  // Journal
  const jSection = el('section')
  jSection.appendChild(el('h2', undefined, 'Activity'))
  const entries = journal.all().slice(-30).reverse()
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
  body.appendChild(jSection)

  panel.appendChild(body)

  // Footer
  const footer = el('footer')
  const check = el('input') as HTMLInputElement
  check.type = 'checkbox'
  check.checked = autoApprove
  check.onchange = () => {
    autoApprove = check.checked
  }
  const lbl = el('label')
  lbl.appendChild(check)
  lbl.appendChild(document.createTextNode(' Auto-approve agent actions'))
  footer.appendChild(lbl)
  panel.appendChild(footer)

  root.appendChild(panel)
}
