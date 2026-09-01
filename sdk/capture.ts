import { record } from './journal'

const PANEL_HOST_ID = 'flowcatch-panel-host'

function insidePanel(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`#${PANEL_HOST_ID}`)
}

function labelFor(el: Element): string {
  const explicit = el.getAttribute('data-flow-label')
  if (explicit) return explicit
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ')
  return text.slice(0, 60) || `<${el.tagName.toLowerCase()}>`
}

function summarizeForm(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {}
  const data = new FormData(form)
  data.forEach((value, key) => {
    if (typeof value !== 'string') return
    const input = form.elements.namedItem(key)
    if (input instanceof HTMLInputElement && input.type === 'password') return
    out[key] = value.slice(0, 120)
  })
  return out
}

/** Watch what the user does in the host page and journal it. */
export function startCapture(mode: 'full' | 'min'): void {
  // Navigation is captured in every mode.
  const pushState = history.pushState.bind(history)
  history.pushState = (...args) => {
    pushState(...args)
    record('user', 'navigate', location.pathname + location.search)
  }
  window.addEventListener('popstate', () =>
    record('user', 'navigate', location.pathname + location.search),
  )

  if (mode === 'min') return

  document.addEventListener(
    'click',
    (e) => {
      if (insidePanel(e.target)) return
      const el =
        e.target instanceof Element
          ? e.target.closest('button, a, [role="button"], [data-flow-label]')
          : null
      if (!el || el.hasAttribute('data-flow-ignore')) return
      record('user', 'click', labelFor(el))
    },
    true,
  )

  document.addEventListener(
    'submit',
    (e) => {
      if (insidePanel(e.target)) return
      const form = e.target as HTMLFormElement
      record('user', 'submit', form.getAttribute('data-flow-label') || form.name || 'form', {
        fields: summarizeForm(form),
      })
    },
    true,
  )

  document.addEventListener(
    'change',
    (e) => {
      if (insidePanel(e.target)) return
      const el = e.target
      if (
        (el instanceof HTMLSelectElement || el instanceof HTMLInputElement) &&
        el.name &&
        el.type !== 'password' &&
        el.type !== 'text' &&
        el.type !== 'textarea'
      ) {
        const value = el instanceof HTMLInputElement && el.type === 'checkbox'
          ? String(el.checked)
          : el.value
        record('user', 'change', el.name, { value: value.slice(0, 120) })
      }
    },
    true,
  )
}
