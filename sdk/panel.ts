import * as journal from './journal'
import * as mapstore from './mapstore'
import * as asksStore from './asks'
import * as host from './host'
import { runAsHuman, preconditionFor } from './runner'
import { isRunComplete } from './runsync'
import type { Step } from './types'
import { discoveryPreview } from './discovery-preview'
import type { PlaybookRequest } from './discovery'
import { buildUsageGuide, type GuideLanguage, type GuideTopic } from './usage-guide'

const HOST_ID = 'understudy-panel-host'

let webmcpStatus: 'not detected' | 'unsupported API' | 'error' | 'registered' | 'active' = 'not detected'
let guideLanguage: GuideLanguage | null = null
let guideTopic: GuideTopic = 'usage'
function usageGuide(): HTMLElement {
  return buildUsageGuide(guideLanguage ?? 'en', guideTopic, () => {
    guideLanguage = null
    shadow?.querySelector('.usage-guide')?.remove()
  }, topic => openUsageGuide(guideLanguage ?? 'en', topic))
}
export function openUsageGuide(language: GuideLanguage = 'en', topic: GuideTopic = 'usage'): boolean {
  guideLanguage = language
  guideTopic = topic
  collapsed = false
  render()
  // Help can open even while a draft editor is focused. Insert it without
  // detaching that editor or committing the person's unfinished correction.
  const body = shadow?.querySelector('.body')
  if (body) {
    body.querySelector('.usage-guide')?.remove()
    body.prepend(usageGuide())
    body.scrollTop = 0
  }
  return !!body
}
export function setWebmcpStatus(status: typeof webmcpStatus): void {
  if (webmcpStatus === status) return
  webmcpStatus = status
  scheduleRender()
  announceInteraction()
}

export function getInteractionState() {
  return { registered: ['registered', 'active'].includes(webmcpStatus), active: webmcpStatus === 'active',
    connected: webmcpStatus === 'active', questions: asksStore.asks.length, approvals: asksStore.approvals.length,
    interview: asksStore.getInterviewProgress() }
}

function announceInteraction() {
  window.dispatchEvent(new CustomEvent('understudy:agent-state'))
}

export function openPanel(): void {
  collapsed = false
  render()
  focusPendingQuestion()
}

export function closePanel(): void {
  collapsed = true
  render()
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
.panel {
  position: fixed; top: 0; right: 0; height: 100vh; height: 100dvh; width: min(var(--understudy-panel-width, 420px), 86vw); z-index: 2147483000;
  background: #0f172a; color: #e2e8f0; display: flex; flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,.35); font-size: 13px;
}
.panel.collapsed { display: none; }
button:focus-visible, input:focus-visible, select:focus-visible, [role="button"]:focus-visible {
  outline: 3px solid #6ee7b7; outline-offset: 3px;
}
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
header .dot.registered { background: #fbbf24; }
header button.close { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 15px; }
.body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 16px; }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin: 0 0 8px; }
h2.activity-toggle { cursor: pointer; user-select: none; }
h2.activity-toggle:hover { color: #94a3b8; }
.empty { color: #475569; font-style: italic; }
.answered-question { background: #14231f; border: 1px solid #315348; border-radius: 8px; margin-bottom: 8px; padding: 9px 11px; color: #cbd5e1; }
.answered-question summary { cursor: pointer; color: #8ed1b6; font-size: 11px; font-weight: 700; }
.answered-question p { color: #dbe8e3; line-height: 1.6; white-space: pre-wrap; }
.invite-box { margin-top: 10px; background: #1e293b; border: 1px dashed #334155; border-radius: 8px; padding: 10px; }
.invite-hint { color: #94a3b8; font-size: 11px; margin-bottom: 6px; }
.invite-text { color: #cbd5e1; font-size: 11px; font-style: italic; margin-bottom: 8px; user-select: text; }
.invite-copy { background: #3b82f6; color: #fff; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.discovery-preview h3 { color: #f1f5f9; font-size: 20px; line-height: 1.3; margin: 6px 0 10px; }
.preview-note { color: #a2b0c2; font-size: 12px; line-height: 1.6; margin: 10px 0; }
.preview-empty { min-height: 260px; border: 1px dashed #405064; border-radius: 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 28px; color: #cbd5e1; background: linear-gradient(180deg, rgba(30,41,59,.28), rgba(15,23,42,.08)); }
.preview-empty strong { color: #ecfdf5; font-size: 15px; }
.preview-empty p { color: #93a4b8; font-size: 12px; line-height: 1.7; max-width: 270px; }
.preview-flow { list-style: none; margin: 20px 0; padding: 0 0 0 16px; border-left: 2px solid #476b64; }
.preview-node { position: relative; background: #182636; padding: 11px 13px; border: 1px solid #456157; border-radius: 8px; margin: 0 0 14px; overflow-wrap: anywhere; }
.preview-node::before { content: ''; position: absolute; left: -22px; top: 23px; width: 8px; height: 8px; border-radius: 50%; background: #80bda6; }
.preview-node p { margin: 5px 0 0; color: #ecf4f1; line-height: 1.5; }
.preview-role { color: #b0c7bf; font-size: 10px; letter-spacing: .05em; }
.preview-node.unknown { border-style: dashed; background: transparent; }
.usage-guide { padding: 16px; background: #18392f; border: 1px solid #4c8b73; border-radius: 10px; color: #e5f4ec; }
.usage-guide h2 { color: #e5f4ec; font-size: 18px; text-transform: none; letter-spacing: 0; margin-bottom: 12px; }
.usage-guide p, .usage-guide li { font-size: 13px; line-height: 1.7; }
.usage-guide ol { padding-left: 20px; }
.usage-guide li { margin-bottom: 8px; }
.usage-guide button { border: 1px solid #86bba6; border-radius: 6px; padding: 8px 12px; background: #edf7f1; color: #16432f; cursor: pointer; margin: 4px 8px 0 0; }
.step { background: #161e2c; border: 1px solid rgba(148,163,184,.1); border-radius: 10px; padding: 9px 11px; margin-bottom: 4px; position: relative; transition: border-color .15s, box-shadow .15s; }
.step:hover { border-color: rgba(148,163,184,.25); }
.step .metarow { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.step .metarow .spacer { flex: 1; }
.step.done { opacity: .9; }
.step.ready { border-color: rgba(251,191,36,.55); background: #1a2130; box-shadow: 0 0 0 1px rgba(251,191,36,.12), 0 0 20px -8px rgba(251,191,36,.35); }
.step.skipped { border-color: rgba(239,68,68,.45); }
.step.conditional { border-style: dashed; }
.step.blocked { border-color: rgba(249,115,22,.5); }
.step.not_applicable { opacity: .38; }
.step input.chk { accent-color: #34d399; flex: none; margin: 0; }
.step input.chk:disabled { opacity: .4; }
.chip { font-size: 9px; font-weight: 700; padding: 1.5px 7px; border-radius: 999px; letter-spacing: .04em; flex: none; }
.chip.ready { background: #fbbf24; color: #451a03; }
.chip.skipped { background: #ef4444; color: #fff; }
.chip.conditional { background: #334155; color: #94a3b8; }
.chip.blocked { background: #f97316; color: #431407; }
.chip.na { background: #475569; color: #cbd5e1; }
.step .blocked-reason { color: #fdba74; font-size: 10px; margin-top: 3px; }
.skip-confirm { margin-top: 6px; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.35); border-radius: 7px; padding: 6px 8px; font-size: 11px; color: #fca5a5; }
.skip-confirm button { margin: 4px 6px 0 0; border: none; border-radius: 5px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
.skip-confirm .skip-yes { background: #dc2626; color: #fff; }
.skip-confirm .skip-no { background: #334155; color: #cbd5e1; }
.step .row { display: flex; align-items: flex-start; gap: 7px; }
.step .row input.chk { margin-top: 2px; }
.step .label { font-weight: 600; font-size: 13px; line-height: 1.35; color: #eef2f7; }
.badge { display: inline-flex; align-items: center; gap: 4px; font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; font-weight: 600; color: #7c8698; flex: none; }
.badge .ticon { font-size: 11px; }
.badge.task .ticon { color: #60a5fa; }
.badge.decision .ticon { color: #f59e0b; }
.badge.approval .ticon { color: #a78bfa; }
.step .label { flex: 1; cursor: text; color: #f1f5f9; }
.step input.label-edit { flex: 1; background: #0f172a; color: #fff; border: 1px solid #3b82f6; border-radius: 4px; padding: 2px 6px; font-size: 13px; }
.step .detail { color: #8b96a8; font-size: 11px; line-height: 1.5; margin-top: 3px; cursor: text; }
.step .detail-empty { color: #475569; font-style: italic; }
.step input.detail-edit { width: 100%; background: #0f172a; color: #fff; border: 1px solid #3b82f6; border-radius: 4px; padding: 2px 6px; font-size: 11px; margin-top: 3px; }
.step .knowledge { margin-top: 6px; border: 1px solid rgba(167,139,250,.28); border-radius: 7px; background: rgba(124,58,237,.07); color: #aeb8c8; font-size: 10px; }
.step .knowledge summary { cursor: pointer; padding: 5px 7px; color: #c4b5fd; font-weight: 650; list-style-position: inside; }
.step .knowledge-body { padding: 0 8px 7px; line-height: 1.45; }
.step .knowledge-row { margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
.interview-scope { background: #172337; border: 1px solid #35506f; border-radius: 9px; padding: 10px 11px; color: #cbd5e1; font-size: 12px; line-height: 1.5; }
.interview-scope strong { color: #f1f5f9; }
.interview-scope .scope-note { color: #94a3b8; margin-top: 4px; }
.interview-scope button { margin-top: 9px; width: 100%; border: 1px solid #6ee7b7; border-radius: 6px; padding: 7px 9px; background: #173e36; color: #d1fae5; cursor: pointer; }
.evidence-only { background: #332b18; border: 1px solid #8c6d2b; border-radius: 9px; padding: 10px 11px; color: #fde9a9; font-size: 12px; line-height: 1.5; }
.evidence-only strong { display: block; color: #fff4c7; margin-bottom: 4px; }
.evidence-only ul { margin: 7px 0 0; padding-left: 18px; }
.step .knowledge-row b { color: #ddd6fe; }
.step .knowledge-source { margin-top: 6px; padding-top: 5px; border-top: 1px solid rgba(167,139,250,.18); color: #7f8a9c; }
.step .knowledge-status { color: #a78bfa; }
.step .knowledge-status.confirmed { color: #6ee7b7; }
.step .action-tag { color: #38bdf8; font-size: 10px; margin-top: 2px; }
.step .human-tag { color: #a5b4fc; }
.role-chip { font-size: 9px; font-weight: 700; color: #93c5fd; background: rgba(59,130,246,.12); border: 1px solid rgba(59,130,246,.3); border-radius: 999px; padding: 1px 7px; flex: none; }
.map-fields { color: #94a3b8; font-size: 11px; margin: -4px 0 8px; }
.map-fields b { color: #cbd5e1; font-weight: 600; }
.step button.del { background: none; border: none; color: #475569; cursor: pointer; flex: none; }
.step button.del:hover { color: #f87171; }
.step select { background: #0f172a; color: #cbd5e1; border: 1px solid #334155; border-radius: 4px; font-size: 10px; }
/* Editing affordances stay out of the way until the card is hovered or a
   keyboard user moves focus into it. Invisible controls remain tabbable and
   become visible as soon as focus enters the card. */
.step select, .step button.del { opacity: 0; transition: opacity .15s; }
.step:hover select, .step:hover button.del { opacity: 1; }
/* Keyboard controls must be visible in the same frame that focus reaches the
   card. A hover fade is fine; a focus fade briefly presents an invisible
   active control to keyboard and low-vision users. */
.step:focus-within select, .step:focus-within button.del { opacity: 1; transition: none; }
.step .action-tag { display: none; }
.step:hover .action-tag { display: block; }
.branch { margin: 5px 0 0; padding: 4px 8px; border-radius: 7px; color: #8b96a8; font-size: 11px; display: flex; gap: 5px; align-items: center; flex-wrap: wrap; background: rgba(52,211,153,.05); border: 1px solid rgba(52,211,153,.14); }
.branch.back { background: rgba(248,113,113,.05); border-color: rgba(248,113,113,.16); }
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
.node.ready { background: #f59e0b; border-color: #fbbf24; color: #451a03; animation: nodepulse 2.4s infinite; }
.node.skipped { background: #dc2626; border-color: #ef4444; color: #fff; }
.node.blocked { background: #ea580c; border-color: #f97316; color: #fff; }
.node.conditional { border-style: dashed; }
.node.not_applicable { opacity: .4; }
@keyframes nodepulse { 0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,.45); } 50% { box-shadow: 0 0 0 7px rgba(251,191,36,0); } }
.node { transition: background .2s, border-color .2s; }
.branch input { background: transparent; color: #fbbf24; border: 1px solid transparent; border-radius: 4px; padding: 1px 5px; font-size: 11px; flex: 1; min-width: 110px; }
.branch input:hover, .branch input:focus { border-color: #334155; background: #0f172a; outline: none; }
.arrow { text-align: center; color: #475569; font-size: 11px; line-height: 1; margin: 1px 0; }
.confirm-bar { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.confirm-bar button { background: #059669; color: #fff; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
.confirm-bar button:disabled { background: #334155; color: #94a3b8; cursor: not-allowed; }
.confirm-bar button.revise { background: #334155; color: #cbd5e1; }
.step .label.ro { cursor: default; }
.branch .cond-ro { color: #fbbf24; }
.confirmed { color: #34d399; font-weight: 600; font-size: 12px; }
.confirm-bar .unsaved { color: #fbbf24; font-size: 11px; font-weight: 600; }
.run-complete { background: #064e3b; color: #6ee7b7; border-radius: 8px; padding: 8px 10px; margin-top: 8px; font-size: 12px; font-weight: 600; }
.run-summary { background: linear-gradient(180deg, #064e3b, #0b3a2e); border: 1px solid #059669; border-radius: 10px; padding: 10px 12px; margin-top: 8px; }
.run-summary .rs-title { color: #6ee7b7; font-weight: 700; font-size: 13px; margin-bottom: 6px; }
.run-summary .rs-line { color: #a7f3d0; font-size: 11px; line-height: 1.6; }
.run-summary .rs-copy { margin-top: 8px; background: #059669; color: #fff; border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer; }
.map-title { font-weight: 600; color: #fff; margin-bottom: 8px; }
.map-hint { color: #64748b; font-size: 10.5px; line-height: 1.5; margin: -2px 0 10px; }
.overview { background: #10182a; border: 1px solid rgba(148,163,184,.08); border-radius: 10px; padding: 6px 8px; margin-bottom: 10px; overflow-x: auto; }
.overview svg { display: block; margin: 0 auto; }
.overview .mini { cursor: pointer; }
.map-hint::before { content: 'ℹ '; opacity: .8; }
.card { background: #1e293b; border: 1px solid #3b82f6; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
.card .q { color: #f1f5f9; margin-bottom: 8px; }
.card .opts { display: flex; flex-wrap: wrap; gap: 6px; }
.card .opts button { background: #3b82f6; color: #fff; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.card input.freetext { width: 100%; margin-top: 6px; background: #0f172a; color: #fff; border: 1px solid #334155; border-radius: 6px; padding: 5px 8px; font-size: 12px; }
.card.approval-card { border-color: #f59e0b; }
.card .params { font-size: 11px; color: #94a3b8; white-space: pre-wrap; word-break: break-all; margin: 6px 0; max-height: 120px; overflow-y: auto; }
.card .approval-summary { margin: 8px 0 10px; padding: 10px 11px; border-left: 3px solid #6ee7b7; border-radius: 5px; background: #14231f; color: #ecfdf5; font-size: 13px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.card .approval-meta { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-bottom: 10px; color: #a7b4c6; font-size: 10px; }
.card .approval-details { margin: 8px 0 10px; color: #94a3b8; font-size: 10px; }
.card .approval-details summary { cursor: pointer; color: #94a3b8; }
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
// On phones the panel would cover ~86% of the screen — start collapsed there.
let collapsed = typeof window !== 'undefined' && window.innerWidth < 560
let expanded = false
let seenApprovalCount = 0
let seenQuestionCount = 0
// In-progress free-text answers, keyed by ask id — the 5s host-state poll
// rebuilds the DOM and must not eat what the human is typing.
const answerDrafts = new Map<string, string>()
let skipConfirmId: string | null = null
// The activity journal exists for the agent; humans see a collapsed summary.
let activityOpen = false
let renderQueued = false
let pointerDown = false

export function mountPanel(initiallyCollapsed?: boolean): void {
  window.addEventListener('understudy:host-state', () => scheduleRender())
  if (document.getElementById(HOST_ID)) return
  if (initiallyCollapsed !== undefined) collapsed = initiallyCollapsed
  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)
  shadow = host.attachShadow({ mode: 'open' })
  // Moving focus is not a state change. Re-rendering on every focusout
  // detached the newly focused control and made natural Tab traversal fall
  // out of the Shadow DOM. Actual edits already notify through mapstore.
  shadow.addEventListener('click', () => scheduleRender())
  shadow.addEventListener('pointerdown', () => { pointerDown = true })
  window.addEventListener('pointerup', () => {
    pointerDown = false
    scheduleRender()
  })
  window.addEventListener('pointercancel', () => { pointerDown = false; scheduleRender() })
  // Host polling must not detach the editor, steal focus or interrupt IME input.
  const style = document.createElement('style')
  style.textContent = CSS
  shadow.appendChild(style)
  const root = document.createElement('div')
  root.id = 'root'
  shadow.appendChild(root)

  journal.subscribe(scheduleRender)
  let previousMap = mapstore.getMap()
  let wasConfirmed = previousMap?.confirmed
  mapstore.subscribe(() => {
    const nextMap = mapstore.getMap()
    if (nextMap && !nextMap.confirmed && (nextMap !== previousMap || wasConfirmed)) collapsed = false
    previousMap = nextMap
    wasConfirmed = nextMap?.confirmed
    scheduleRender()
  })
  asksStore.subscribe(() => { scheduleRender(); announceInteraction() })
  render()
}

function scheduleRender() {
  if (renderQueued) return
  renderQueued = true
  // setTimeout, not requestAnimationFrame: rAF never fires in hidden tabs,
  // which would freeze the panel while an agent works in the background.
  setTimeout(() => {
    renderQueued = false
    // A blur can commit an edit between pointerdown and click. Wait until the
    // pointer sequence has finished so the clicked control remains attached.
    if (pointerDown) return
    render()
  }, 0)
}

/** Put the human directly into the current interview question. This is used
 * both when a question first arrives and when the page CTA reopens the panel. */
function focusPendingQuestion(): void {
  const inputs = shadow?.querySelectorAll<HTMLInputElement>('.card input.freetext')
  const next = inputs?.item((inputs?.length ?? 0) - 1)
  if (!next) return
  requestAnimationFrame(() => {
    next.focus()
    next.scrollIntoView({block: 'center', behavior: 'smooth'})
  })
}

function setFocusKey<T extends HTMLElement>(node: T, key: string): T {
  node.dataset.focusKey = key
  return node
}

function restoreFocus(root: HTMLElement, key?: string): void {
  if (!key) return
  const target = [...root.querySelectorAll<HTMLElement>('[data-focus-key]')]
    .find((node) => node.dataset.focusKey === key)
  target?.focus({ preventScroll: true })
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
    } else if (!step.done && (status === 'not_applicable' || status === 'conditional')) {
      chk.disabled = true
      chk.title = 'This step is not on the active path'
    } else if (step.role && host.actorRole() && step.role !== host.actorRole() && !step.done) {
      chk.disabled = true
      chk.title = `This step belongs to the ${step.role} role — switch persona to complete it`
    } else if (!step.done && step.fields?.length) {
      chk.disabled = true
      chk.title = 'This step requires inputs — complete it from the My tasks card'
    } else {
      chk.title = 'Mark this step done'
      chk.onchange = () => {
        // Checking a step ahead of unfinished earlier work is a skip — it is
        // held for an explicit confirmation instead of silently reordering.
        if (!step.done && status === 'pending') {
          chk.checked = false
          skipConfirmId = step.id
          scheduleRender()
          return
        }
        skipConfirmId = null
        mapstore.humanToggleStepDone(step.id)
      }
    }
    row.appendChild(chk)
  }
  const typeIcons: Record<string, string> = { task: '⚙', decision: '◈', approval: '✍' }
  const tb = el('span', `badge ${step.type}`)
  tb.appendChild(el('span', 'ticon', typeIcons[step.type] ?? '•'))
  tb.appendChild(el('span', undefined, step.type))
  meta.appendChild(tb)
  if (status === 'ready') meta.appendChild(el('span', 'chip ready', 'NEXT'))
  if (status === 'skipped') meta.appendChild(el('span', 'chip skipped', 'SKIPPED'))
  if (status === 'conditional') meta.appendChild(el('span', 'chip conditional', 'IF'))
  if (status === 'blocked') meta.appendChild(el('span', 'chip blocked', 'BLOCKED'))
  if (status === 'not_applicable') meta.appendChild(el('span', 'chip na', 'N/A'))
  meta.appendChild(el('span', 'spacer'))

  const locked = !!(mapstore.getMap()?.confirmed || mapstore.getMap()?.saving)
  const label = el('span', `label${locked ? ' ro' : ''}`, step.label)
  if (!locked) {
    const editLabel = () => {
      if (!label.isConnected) return
      const input = el('input', 'label-edit') as HTMLInputElement
      input.value = step.label
      input.setAttribute('aria-label', `Step name: ${step.label}`)
      row.replaceChild(input, label)
      input.focus()
      input.select()
      const commit = () => {
        mapstore.humanEditStep(step.id, 'label', input.value.trim() || step.label)
        // No-op edits do not notify mapstore, but the temporary editor still
        // has to collapse back to its read view after Tab/blur.
        scheduleRender()
      }
      input.onkeydown = (e) => {
        if (e.isComposing) return
        if (e.key === 'Enter') input.blur()
        if (e.key === 'Escape') {
          input.onblur = null
          input.blur()
          scheduleRender()
        }
      }
      input.onblur = commit
    }
    label.title = 'Click or press Enter to rename'
    label.tabIndex = 0
    setFocusKey(label, `step:${step.id}:label`)
    label.setAttribute('role', 'button')
    label.setAttribute('aria-label', `Rename step: ${step.label}`)
    label.onclick = editLabel
    label.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      editLabel()
    }
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
  setFocusKey(typeSel, `step:${step.id}:type`)
  typeSel.setAttribute('aria-label', `Step type for ${step.label}`)
  if (!locked) meta.appendChild(typeSel)

  const del = el('button', 'del', '✕')
  del.title = 'Remove step'
  setFocusKey(del, `step:${step.id}:delete`)
  del.setAttribute('aria-label', `Remove step: ${step.label}`)
  del.onclick = () => mapstore.humanRemoveStep(step.id)
  if (!locked) meta.appendChild(del)

  card.appendChild(meta)
  card.appendChild(row)
  if ((step.type !== 'decision' || step.detail) && (!locked || step.detail)) {
    const detail = el('div', `detail${step.detail ? '' : ' detail-empty'}`, step.detail || '+ add note')
    if (!locked) {
      const editDetail = () => {
        if (!detail.isConnected) return
        const input = el('input', 'detail-edit') as HTMLInputElement
        input.value = step.detail ?? ''
        input.placeholder = 'the rule or threshold that guides this step…'
        input.setAttribute('aria-label', `Step note for ${step.label}`)
        card.replaceChild(input, detail)
        input.focus()
        const commit = () => {
          mapstore.humanEditStep(step.id, 'detail', input.value.trim())
          scheduleRender()
        }
        input.onkeydown = (e) => {
          if (e.isComposing) return
          if (e.key === 'Enter') input.blur()
          if (e.key === 'Escape') {
            input.onblur = null
            input.blur()
            scheduleRender()
          }
        }
        input.onblur = commit
      }
      detail.title = 'Click or press Enter to edit this note (judgment rules live here)'
      detail.tabIndex = 0
      setFocusKey(detail, `step:${step.id}:detail`)
      detail.setAttribute('role', 'button')
      detail.setAttribute('aria-label', `${step.detail ? 'Edit' : 'Add'} note for ${step.label}`)
      detail.onclick = editDetail
      detail.onkeydown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        editDetail()
      }
    }
    card.appendChild(detail)
  }
  if (step.elicitation?.answers?.length) {
    const captured = step.elicitation
    const covered = new Set(captured.answers
      .filter(answer => answer.disposition !== 'needs_probe')
      .map(answer => answer.stage)).size
    const knowledge = el('details', 'knowledge') as HTMLDetailsElement
    const confirmation = captured.confirmed
      ? `✓ Human-confirmed${captured.confirmedBy ? ` by ${captured.confirmedBy}` : ''}`
      : 'Draft evidence · confirmed when this playbook is saved'
    const summary = el('summary', undefined, `Expert judgment sources · ${covered}/5 · `)
    summary.appendChild(el('span', `knowledge-status${captured.confirmed ? ' confirmed' : ''}`, confirmation))
    knowledge.appendChild(summary)
    const body = el('div', 'knowledge-body')
    const addKnowledgeRow = (label: string, value?: string | string[]) => {
      const values = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
      if (!values.length) return
      const row = el('div', 'knowledge-row')
      row.appendChild(el('b', undefined, `${label}: `))
      row.appendChild(document.createTextNode(values.join(' / ')))
      body.appendChild(row)
    }
    addKnowledgeRow('Real case', captured.incident)
    addKnowledgeRow('Observed cues', captured.cues)
    addKnowledgeRow('Likely novice mistake', captured.noviceMistake)
    addKnowledgeRow('Boundaries / exceptions', captured.boundaries)
    addKnowledgeRow('Failure / recovery', captured.failureRecovery)
    addKnowledgeRow('Needs observation', captured.unspeakable)
    const sources = el('div', 'knowledge-source', `${captured.answers.length} source answer${captured.answers.length === 1 ? '' : 's'} preserved`)
    sources.title = 'These human answers are source evidence. They do not become executable thresholds or routes unless the reviewed process explicitly encodes them.'
    body.appendChild(sources)
    knowledge.appendChild(body)
    card.appendChild(knowledge)
  }
  if (step.fields?.length) {
    const inputs = el('div', 'detail task-input-preview')
    inputs.appendChild(el('strong', undefined, `Inputs for ${step.role || 'this task’s owner'}`))
    for (const key of step.fields) {
      const field = mapstore.getMap()?.fields?.find(f => f.key === key)
      inputs.appendChild(el('div', undefined, field
        ? `${field.label || key}${field.unit ? ` (${field.unit})` : ''} · ${field.type === 'select' ? `choose: ${field.options?.join(' / ')}` : field.type}${field.required || field.confirm ? ' · required' : ' · optional'}`
        : `${key} · input definition missing`))
    }
    card.appendChild(inputs)
  }
  if (step.naReason) card.appendChild(el('div', 'detail', `N/A: ${step.naReason}`))
  if (step.action) card.appendChild(el('div', 'action-tag', `runs: ${step.action}`))
  if (step.humanOnly) card.appendChild(el('div', 'action-tag human-tag', '👤 human step'))
  if (step.role) meta.insertBefore(el('span', 'role-chip', `👤 ${step.role}`), meta.querySelector('.spacer'))
  if (step.approvalPurpose) meta.insertBefore(el('span', 'role-chip', step.approvalPurpose === 'plan' ? 'Plan approval only' : 'Work approval'), meta.querySelector('.spacer'))
  if (status === 'blocked' && step.action) {
    const reason = preconditionFor(step.action)
    if (reason) card.appendChild(el('div', 'blocked-reason', `⛔ ${reason}`))
  }
  if (skipConfirmId === step.id) {
    const warn = el('div', 'skip-confirm')
    warn.appendChild(
      el('span', undefined, 'Earlier steps are not done — checking this records them as SKIPPED. '),
    )
    const yes = el('button', 'skip-yes', 'Skip anyway (recorded)')
    yes.onclick = () => {
      skipConfirmId = null
      mapstore.humanToggleStepDone(step.id, undefined, { allowSkip: true })
    }
    const no = el('button', 'skip-no', 'Cancel')
    no.onclick = () => {
      skipConfirmId = null
      scheduleRender()
    }
    warn.appendChild(yes)
    warn.appendChild(no)
    card.appendChild(warn)
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
      if (locked) {
        line.appendChild(el('span', 'cond-ro', b.condition || '—'))
      } else {
        const cond = el('input') as HTMLInputElement
        cond.value = b.condition ?? ''
        cond.placeholder = 'condition…'
        cond.onchange = () => mapstore.humanEditCondition(step.id, b.to, cond.value)
        line.appendChild(cond)
      }
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

// Compact true-flowchart overview: peer branches split symmetrically left and
// right on the same rank, joins return to the parent lane, and loop-backs curve
// around the left edge. Clicking a node scrolls to its card.
function buildOverview(panelEl: HTMLElement): HTMLElement | null {
  const map = mapstore.getMap()
  if (!map || map.steps.length < 2) return null
  const statuses = mapstore.progress(preconditionFor)
  const idx = new Map(map.steps.map((st, i) => [st.id, i] as const))
  const forwardEdges = (i: number) => {
    const st = map.steps[i]
    const edges = st.next !== undefined
      ? st.next
      : i < map.steps.length - 1 ? [{to: map.steps[i + 1].id}] : []
    return edges.map(edge => idx.get(edge.to)).filter((j): j is number => j !== undefined && j > i)
  }
  // Rank is graph depth rather than array position. Sibling choices therefore
  // share a row even when their definitions are adjacent in the saved JSON.
  const rank = new Array(map.steps.length).fill(-1)
  rank[0] = 0
  map.steps.forEach((_, i) => {
    if (rank[i] < 0) rank[i] = i === 0 ? 0 : Math.max(0, rank[i - 1] + 1)
    for (const j of forwardEdges(i)) rank[j] = Math.max(rank[j], rank[i] + 1)
  })

  // For each fork, all nodes unique to one branch inherit a centered lane.
  // Nodes reachable from every branch are joins and stay on the parent lane.
  const col = new Array(map.steps.length).fill(0)
  const reachable = (start: number) => {
    const seen = new Set<number>()
    const visit = (i: number) => {
      if (seen.has(i)) return
      seen.add(i)
      for (const j of forwardEdges(i)) visit(j)
    }
    visit(start)
    return seen
  }
  map.steps.forEach((_, i) => {
    const branches = forwardEdges(i)
    if (branches.length < 2) return
    const paths = branches.map(reachable)
    const common = paths.slice(1).reduce(
      (shared, path) => new Set([...shared].filter(node => path.has(node))),
      new Set(paths[0]),
    )
    paths.forEach((path, branchIndex) => {
      // Two paths become -1/+1; three become -2/0/+2.
      const lane = col[i] + branchIndex * 2 - (paths.length - 1)
      for (const node of path) if (!common.has(node)) col[node] = lane
    })
    for (const node of common) col[node] = col[i]
  })
  const STEPX = 26
  const STEPY = 30
  const PADX = 16
  const PADY = 12
  const minCol = Math.min(...col)
  const maxCol = Math.max(...col)
  const width = Math.max(140, PADX * 2 + (maxCol - minCol) * STEPX + 20)
  const startX = (width - (maxCol - minCol) * STEPX) / 2
  const height = PADY * 2 + Math.max(...rank) * STEPY
  const cx = (i: number) => startX + (col[i] - minCol) * STEPX
  const cy = (i: number) => PADY + rank[i] * STEPY
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', String(Math.max(width, 120)))
  svg.setAttribute('height', String(height))
  const FILL: Record<string, [string, string, string]> = {
    done: ['#059669', '#34d399', '#fff'],
    ready: ['#f59e0b', '#fbbf24', '#451a03'],
    skipped: ['#dc2626', '#ef4444', '#fff'],
    blocked: ['#ea580c', '#f97316', '#fff'],
  }
  const TYPESTROKE: Record<string, string> = { task: '#3b82f6', decision: '#d97706', approval: '#8b5cf6' }
  // edges first (under nodes)
  map.steps.forEach((st, i) => {
    // An explicit empty next means a terminal step; only an OMITTED next
    // falls back to the implicit straight line.
    const edges =
      st.next !== undefined
        ? st.next
        : i < map.steps.length - 1
          ? [{ to: map.steps[i + 1].id, condition: undefined }]
          : []
    for (const e of edges) {
      const j = idx.get(e.to)
      if (j === undefined) continue
      const back = j <= i
      const isBranch = (st.next?.length ?? 0) > 1 || !!e.condition
      const tStatus = statuses.get(e.to)
      let color = '#3d4a61'
      let dash = ''
      if (back) {
        color = '#f87171'
        dash = '3 3'
      } else if (isBranch) {
        color = tStatus === 'conditional' ? '#fbbf24' : '#34d399'
      }
      const path = document.createElementNS(NS, 'path')
      let d: string
      if (back) {
        const loopX = Math.min(...col.map((_, n) => cx(n))) - 18
        d = `M ${cx(i) - 8} ${cy(i)} C ${loopX} ${cy(i)}, ${loopX} ${cy(j)}, ${cx(j) - 8} ${cy(j)}`
      } else if (col[i] === col[j]) {
        d = `M ${cx(i)} ${cy(i) + 8} L ${cx(j)} ${cy(j) - 8}`
      } else {
        d = `M ${cx(i)} ${cy(i) + 8} C ${cx(i)} ${cy(i) + 20}, ${cx(j)} ${cy(j) - 20}, ${cx(j)} ${cy(j) - 8}`
      }
      path.setAttribute('d', d)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color)
      path.setAttribute('stroke-width', '1.6')
      if (dash) path.setAttribute('stroke-dasharray', dash)
      if (tStatus === 'not_applicable') path.setAttribute('opacity', '.3')
      svg.appendChild(path)
    }
  })
  map.steps.forEach((st, i) => {
    const status = statuses.get(st.id)
    const g = document.createElementNS(NS, 'g')
    g.setAttribute('class', 'mini')
    const [fill, stroke, textCol] = FILL[status ?? ''] ?? ['#0f172a', TYPESTROKE[st.type] ?? '#475569', '#94a3b8']
    let shape: SVGElement
    if (st.type === 'decision') {
      shape = document.createElementNS(NS, 'rect')
      shape.setAttribute('x', String(cx(i) - 7))
      shape.setAttribute('y', String(cy(i) - 7))
      shape.setAttribute('width', '14')
      shape.setAttribute('height', '14')
      shape.setAttribute('rx', '3')
      shape.setAttribute('transform', `rotate(45 ${cx(i)} ${cy(i)})`)
    } else if (st.type === 'approval') {
      shape = document.createElementNS(NS, 'rect')
      shape.setAttribute('x', String(cx(i) - 8))
      shape.setAttribute('y', String(cy(i) - 8))
      shape.setAttribute('width', '16')
      shape.setAttribute('height', '16')
      shape.setAttribute('rx', '5')
    } else {
      shape = document.createElementNS(NS, 'circle')
      shape.setAttribute('cx', String(cx(i)))
      shape.setAttribute('cy', String(cy(i)))
      shape.setAttribute('r', '8')
    }
    shape.setAttribute('fill', fill)
    shape.setAttribute('stroke', stroke)
    shape.setAttribute('stroke-width', '1.6')
    if (status === 'conditional') shape.setAttribute('stroke-dasharray', '3 2')
    if (status === 'not_applicable') g.setAttribute('opacity', '.35')
    const label = document.createElementNS(NS, 'text')
    label.setAttribute('x', String(cx(i)))
    label.setAttribute('y', String(cy(i) + 3))
    label.setAttribute('text-anchor', 'middle')
    label.setAttribute('font-size', '8.5')
    label.setAttribute('font-weight', '700')
    label.setAttribute('fill', textCol)
    label.textContent = status === 'done' ? '✓' : status === 'skipped' ? '✕' : String(i + 1)
    const title = document.createElementNS(NS, 'title')
    title.textContent = `${i + 1}. ${st.label}${status ? ` · ${status}` : ''}`
    g.appendChild(title)
    g.appendChild(shape)
    g.appendChild(label)
    g.addEventListener('click', () => {
      const row = panelEl.querySelectorAll('.flow-row')[i]
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    svg.appendChild(g)
  })
  const wrap = el('div', 'overview')
  wrap.appendChild(svg)
  return wrap
}

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
    // An explicit empty next means a terminal step; only an OMITTED next
    // falls back to the implicit straight line.
    const edges =
      st.next !== undefined
        ? st.next
        : i < map.steps.length - 1
          ? [{ to: map.steps[i + 1].id, condition: undefined }]
          : []
    for (const e of edges) {
      const j = idx.get(e.to)
      const a = pos.get(st.id)
      const b = j === undefined ? undefined : pos.get(e.to)
      if (j === undefined || !a || !b) continue
      // The card gutter only carries adjacent connections; structure
      // (skips, loop-backs) lives in the overview diagram and the pills.
      if (j !== i + 1) continue
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
  const editing = shadow.activeElement
  if (editing instanceof HTMLTextAreaElement ||
      (editing instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(editing.type))) return
  const root = shadow.getElementById('root')
  if (!root) return
  const focusKey = editing instanceof HTMLElement ? editing.dataset.focusKey : undefined
  root.innerHTML = ''

  // Let the host page adapt its layout to the panel (e.g. release the
  // right-hand margin when the panel is minimized on narrow screens).
  // A consent request must be seen: a newly arrived approval card reopens
  // a collapsed panel (the human can collapse it again).
  const newQuestionArrived = asksStore.asks.length > seenQuestionCount
  if (asksStore.approvals.length > seenApprovalCount || newQuestionArrived) collapsed = false
  seenApprovalCount = asksStore.approvals.length
  seenQuestionCount = asksStore.asks.length
  document.documentElement.setAttribute('data-understudy-panel', collapsed ? 'collapsed' : 'open')

  const fab = el('button', 'fab', collapsed ? 'Open playbook & conversation' : '')
  if (collapsed) {
    fab.onclick = () => {
      collapsed = false
      render()
    }
    root.appendChild(fab)
    restoreFocus(root, focusKey)
    return
  }

  const panel = el('div', 'panel')

  // Header
  const header = el('header')
  header.appendChild(el('span', 'logo', 'Playbook & conversation'))
  const status = el('span', 'status')
  const dot = el('span', `dot${webmcpStatus === 'active' ? ' on' : webmcpStatus === 'registered' ? ' registered' : ''}`)
  status.appendChild(dot)
  status.appendChild(el('span', undefined,
    webmcpStatus === 'active' ? 'Agent connected'
      : webmcpStatus === 'registered' ? 'Tools registered'
        : 'Tools unavailable'))
  status.title = webmcpStatus === 'active'
    ? 'An agent has called this page’s WebMCP tools.'
    : webmcpStatus === 'registered'
      ? 'This page registered its WebMCP tools, but cannot know whether the current chat is attached until the agent calls one.'
      : 'This browser did not expose a supported WebMCP registration API. You can still use the on-page starter draft and interview.'
  header.appendChild(status)
  const help = el('button', 'close', '?')
  help.setAttribute('aria-label', 'How to use Understudy')
  help.onclick = () => openUsageGuide()
  header.appendChild(help)
  if (window.innerWidth >= 1000) {
    const widen = el('button', 'close', expanded ? '⇥' : '⇤')
    widen.setAttribute('aria-label', expanded ? 'Use standard process width' : 'Expand process view')
    widen.onclick = () => {
      expanded = !expanded
      document.documentElement.style.setProperty('--understudy-panel-width', expanded ? '560px' : '420px')
      render()
    }
    header.appendChild(widen)
  }
  const close = el('button', 'close', '—')
  close.setAttribute('aria-label', 'Minimize conversation panel')
  close.onclick = () => {
    collapsed = true
    render()
  }
  header.appendChild(close)
  panel.appendChild(header)

  const body = el('div', 'body')

  if (guideLanguage) body.appendChild(usageGuide())

  // Agent questions
  const answeredQuestions = asksStore.recentAnsweredQuestions()
  if (asksStore.asks.length > 0 || answeredQuestions.length > 0) {
    const section = el('section')
    section.appendChild(el('h2', undefined, 'Agent is asking you'))
    for (const answered of answeredQuestions) {
      const completed = el('details', 'answered-question') as HTMLDetailsElement
      completed.appendChild(el('summary', undefined, `✓ Answer saved · ${answered.question}`))
      completed.appendChild(el('p', undefined, answered.answer))
      section.appendChild(completed)
    }
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
        input.value = answerDrafts.get(ask.id) ?? ''
        input.oninput = () => answerDrafts.set(ask.id, input.value)
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.isComposing && input.value.trim()) {
            e.preventDefault()
            e.stopPropagation()
            const answer = input.value.trim()
            answerDrafts.delete(ask.id)
            input.blur()
            asksStore.answerAsk(ask.id, answer)
          }
        }
        card.appendChild(input)
      }
      if (ask.resolvesGap?.startsWith('knowledge_')) {
        const controls = el('div', 'opts interview-controls')
        const later = el('button', undefined, 'Continue later')
        later.title = 'Keep this question open and return when you are ready'
        later.onclick = () => { collapsed = true; render() }
        const skip = el('button', undefined, 'Skip this question')
        skip.title = 'Record that you chose not to answer this interview question'
        skip.onclick = () => asksStore.answerAsk(ask.id, 'Skip this question', {declinedByUser: true})
        controls.appendChild(later)
        controls.appendChild(skip)
        card.appendChild(controls)
      }
      section.appendChild(card)
    }
    body.appendChild(section)
  }

  // Agent action approvals
  if (asksStore.approvals.length > 0) {
    const section = el('section')
    section.appendChild(el('h2', undefined, 'Your confirmation'))
    for (const req of asksStore.approvals) {
      const card = el('div', 'card approval-card')
      const startsProcess = req.actionName === 'log_work_item' && !mapstore.getMap()
      if (req.actionName === 'log_work_item') {
        card.appendChild(el('div', 'q', startsProcess ? 'Use this as the starting point?' : 'Record this work?'))
        card.appendChild(el('div', 'approval-summary', String(req.params.task ?? 'Untitled work')))
        const meta = el('div', 'approval-meta')
        meta.appendChild(el('span', undefined, `Date · ${String(req.params.date ?? 'today')}`))
        meta.appendChild(el('span', undefined, `Type · ${String(req.params.kind ?? 'routine work')}`))
        card.appendChild(meta)
        const details = el('details', 'approval-details') as HTMLDetailsElement
        details.appendChild(el('summary', undefined, 'Technical details'))
        details.appendChild(el('div', 'params', `Action: ${req.actionName}\n${JSON.stringify(req.params, null, 1)}`))
        card.appendChild(details)
      } else {
        card.appendChild(el('div', 'q', `Run action: ${req.actionName}`))
        card.appendChild(el('div', 'params', JSON.stringify(req.params, null, 1)))
      }
      const yn = el('div', 'yn')
      const yes = el('button', 'yes', startsProcess ? 'Save & ask the first question' : req.actionName === 'log_work_item' ? 'Save work record' : 'Approve')
      const nowPersona = (() => {
        try {
          const st = host.getState() as { actingAs?: unknown } | null
          return typeof st?.actingAs === 'string' ? st.actingAs : undefined
        } catch {
          return undefined
        }
      })()
      const wrongPersona = !!(req.persona && nowPersona && req.persona !== nowPersona)
      if (wrongPersona) {
        yes.disabled = true
        yes.title = `Requested while acting as ${req.persona} — switch back to decide`
        card.appendChild(
          el('div', 'blocked-reason', `⛔ Requested by ${req.persona} — switch to that persona to approve or deny.`),
        )
      }
      yes.onclick = () => void asksStore.decideApprovalCard(req.id, true)
      const no = el('button', 'no', req.actionName === 'log_work_item' ? 'Not now' : 'Deny')
      if (wrongPersona) no.disabled = true
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
    const state = host.getState() as {playbookRequest?: PlaybookRequest | null} | null
    mapSection.appendChild(discoveryPreview(state?.playbookRequest ?? null, render))
  } else {
    mapSection.appendChild(el('div', 'map-title', map.title))
    if (map.draftMode === 'evidence-only') {
      const warning = el('div', 'evidence-only')
      warning.appendChild(el('strong', undefined, 'Evidence-only starter · not runnable yet'))
      warning.appendChild(el('div', undefined, 'Your work and answers are preserved as source material. No step, owner, input, branch or approval rule has been inferred from free text.'))
      const checklist = el('ul')
      for (const item of ['Replace placeholder steps with the real sequence', 'Assign owners and required inputs', 'Encode any branch and recovery rules', 'Add the human sign-off point']) checklist.appendChild(el('li', undefined, item))
      warning.appendChild(checklist)
      mapSection.appendChild(warning)
    }
    if (map.editError) {
      const error = el('div', 'blocked-reason', map.editError)
      error.setAttribute('role', 'alert')
      mapSection.appendChild(error)
    }
    mapSection.appendChild(
      el(
        'div',
        'map-hint',
        map.confirmed
          ? 'Follow your tasks in the workspace. This map shows the route and its checks.'
          : 'Review your agent’s draft. Click a step name or rule to correct it, then confirm below.',
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
    const overview = buildOverview(panel)
    if (overview) mapSection.appendChild(overview)
    const flow = el('div', 'flow')
    map.steps.forEach((s, i) => renderStep(s, i, flow, statuses.get(s.id)))
    mapSection.appendChild(flow)
    if (!map.confirmed) {
      const interview = mapstore.elicitationInterviewState()
      if (interview?.active) {
        const scope = el('div', 'interview-scope')
        scope.appendChild(el('strong', undefined,
          `Focused expert interview · ${interview.active.step} · ${interview.active.covered}/${interview.active.total}`))
        scope.appendChild(el('div', 'scope-note', interview.active.complete
          ? map.draftMode === 'evidence-only'
            ? 'This focused interview is complete. The source evidence must be structured and reviewed before it can be saved as a playbook.'
            : interview.canExploreAnother
              ? 'This judgment point is complete. Save now, or deliberately explore one more point.'
              : 'This focused interview is complete. Review the process and save when it reflects the work.'
          : map.draftMode === 'evidence-only'
            ? 'One question at a time. Continue later whenever you need; this remains source evidence until an agent structures it for review.'
            : 'One question at a time. This interview is optional: you can save now and continue in a later revision.'))
        const nextGap = mapstore.mapGaps().find(gap => gap.kind.startsWith('knowledge_'))
        const alreadyAsked = nextGap && asksStore.asks.some(ask => ask.resolvesGap === nextGap.resolves_gap)
        if (!interview.active.complete && nextGap?.fallback_question && nextGap.resolves_gap && !alreadyAsked) {
          scope.appendChild(el('div', 'scope-note', `Why this question: ${nextGap.question_goal}`))
          const manual = el('button', undefined, 'Ask the next question on this page')
          manual.title = 'Manual fallback when this browser tab is not attached to an agent chat'
          manual.onclick = () => asksStore.askUser(nextGap.fallback_question!, undefined, true, nextGap.resolves_gap)
          scope.appendChild(manual)
        }
        if (interview.canExploreAnother && interview.next) {
          const more = el('button', undefined, 'Explore another judgment point')
          more.title = `Add “${interview.next.step}” to this interview`
          more.onclick = () => mapstore.exploreAnotherJudgmentPoint()
          scope.appendChild(more)
        }
        mapSection.appendChild(scope)
      }
    }
    if (map.confirmed && isRunComplete()) {
      const card = el('div', 'run-summary')
      card.appendChild(el('div', 'rs-title', '🏁 Run complete — all required steps handled'))
      if (map.steps.some(s => s.done && s.type === 'approval' && s.approvalPurpose === 'plan'))
        card.appendChild(el('div', 'rs-line', '📋 Plan approved only — this does not certify successful work validation.'))
      const people = [
        ...new Set(
          map.steps.filter((s) => s.done && s.completedBy).map((s) => `${s.completedBy}${s.role ? ` (${s.role})` : ''}`),
        ),
      ]
      if (people.length) card.appendChild(el('div', 'rs-line', `👥 ${people.join(' · ')}`))
      const values: Record<string, unknown> = {}
      for (const s of map.steps) if (s.resultData) Object.assign(values, s.resultData)
      if (Object.keys(values).length)
        card.appendChild(
          el('div', 'rs-line', `📊 ${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(' · ')}`),
        )
      for (const d of (map.decisions ?? []).filter((x) => !x.invalidated)) {
        const from = map.steps.find((s) => s.id === d.stepId)?.label ?? d.stepId
        const to = map.steps.find((s) => s.id === d.to)?.label ?? d.to
        card.appendChild(el('div', 'rs-line', `◈ ${from} → ${to}`))
      }
      const signed = map.steps.filter((s) => s.type === 'approval' && s.done).map((s) => s.label)
      if (signed.length) card.appendChild(el('div', 'rs-line', `✍ signed off: ${signed.join(' · ')}`))
      const copyBtn = el('button', 'rs-copy', '📋 Copy run report')
      copyBtn.onclick = () => {
        const lines: string[] = [`# Run report — ${map.title}${map.version ? ` v${map.version}` : ''}`, '']
        lines.push('## Steps')
        for (const s of map.steps) {
          if (s.type === 'decision') continue // decisions are reported in their own section
          const state = s.done ? 'done' : s.naReason ? `n/a (${s.naReason})` : 'not required'
          const who = s.completedBy ? ` — ${s.completedBy}` : ''
          const when = s.completedAt ? ` @ ${new Date(s.completedAt).toLocaleString('en-US')}` : ''
          const vals = s.resultData
            ? ` — ${Object.entries(s.resultData).map(([k, v]) => `${k}=${v}`).join(', ')}`
            : ''
          lines.push(`- [${s.done ? 'x' : ' '}] ${s.label} (${s.type}${s.role ? `, ${s.role}` : ''}): ${state}${who}${when}${vals}`)
        }
        const decs = (map.decisions ?? []).filter((d) => !d.invalidated)
        if (decs.length) {
          lines.push('', '## Decisions')
          for (const d of decs) {
            const from = map.steps.find((s) => s.id === d.stepId)?.label ?? d.stepId
            const to = map.steps.find((s) => s.id === d.to)?.label ?? d.to
            lines.push(`- ${from} → ${to}${d.reason ? ` — ${d.reason}` : ''}${d.evidence ? ` (evidence: ${d.evidence})` : ''}`)
          }
        }
        void navigator.clipboard.writeText(lines.join('\n')).then(() => {
          copyBtn.textContent = '✓ Copied'
          setTimeout(() => {
            copyBtn.textContent = '📋 Copy run report'
          }, 1500)
        })
      }
      card.appendChild(copyBtn)
      mapSection.appendChild(card)
    }
    const bar = el('div', 'confirm-bar')
    if (map.confirmed) {
      bar.appendChild(el('span', 'confirmed', '✓ Confirmed — ready for the agent to run'))
      const revise = el('button', 'revise', 'Propose changes (new draft)')
      revise.title = 'The running structure is read-only. This reopens it as a draft you re-confirm as the next version.'
      revise.onclick = () => mapstore.reopenAsDraft()
      bar.appendChild(revise)
    } else {
      const store = host.getProcessStore()
      const nextV = (map.version ?? 0) + 1
      const btn = el(
        'button',
        undefined,
        map.draftMode === 'evidence-only' ? 'Structure this evidence before saving'
          : map.saving ? 'Saving playbook…' : store ? (map.version ? `Save as v${nextV} to library` : 'Confirm & save to library') : 'Confirm process',
      )
      btn.disabled = !!map.saving || map.draftMode === 'evidence-only'
      btn.onclick = () =>
        mapstore.humanConfirmMap(store ? (m) => store.save(m) : undefined)
      bar.appendChild(btn)
      bar.appendChild(
        el('span', 'unsaved', map.version ? `● unsaved draft — edits are NOT in saved v${map.version} yet` : '● draft — not in the library yet'),
      )
    }
    mapSection.appendChild(bar)
    if (map.saveError) {
      const error = el('div', 'skip-confirm', map.saveError)
      error.setAttribute('role', 'alert')
      mapSection.appendChild(error)
    }
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

  root.appendChild(panel)
  const flowEl = panel.querySelector('.flow') as HTMLElement | null
  if (flowEl) drawEdges(flowEl)
  restoreFocus(root, focusKey)
  if (newQuestionArrived && !focusKey) {
    focusPendingQuestion()
  }
}
