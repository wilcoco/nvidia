/**
 * FlowCatch — drop-in WebMCP layer that turns any web work-app into an
 * agent-readable, agent-operable workspace.
 *
 * Add <script src="/flowcatch.js"></script> to a page and call
 * FlowCatch.init(). The page gains:
 *  - an action journal of what the human does,
 *  - a side panel where the agent drafts a process map the human can edit,
 *  - a WebMCP toolset so an agent (ChatGPT, Chrome) can read the work,
 *    structure it into a process, ask questions, and replay the process.
 */
import { record } from './journal'
import { startCapture } from './capture'
import { mountPanel } from './panel'
import { registerWebmcpTools } from './tools'
import * as host from './host'
import type { HostAction, InitOptions } from './types'

let initialized = false

function init(opts: InitOptions = {}): void {
  if (initialized) return
  initialized = true
  if (opts.appName) host.setAppName(opts.appName)
  if (opts.stateProvider) host.setStateProvider(opts.stateProvider)
  for (const action of opts.actions ?? []) host.registerAction(action)

  const boot = () => {
    mountPanel()
    const mode = opts.autoCapture ?? 'full'
    if (mode !== 'off') startCapture(mode)
    registerWebmcpTools()
    record('user', 'navigate', `opened ${host.getAppName()}`)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
}

/** Semantic logging for host apps that want richer journal entries than auto-capture. */
function log(label: string, detail?: unknown): void {
  record('user', 'app', label, detail)
}

function registerAction(action: HostAction): void {
  host.registerAction(action)
}

;(window as any).FlowCatch = { init, log, registerAction }
