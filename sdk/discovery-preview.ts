import type { PlaybookRequest } from './discovery'

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text) node.textContent = text
  return node
}

/** A labelled illustration, never inserted into mapstore or the saved library. */
export function discoveryPreview(request: PlaybookRequest | null, _refresh: () => void): HTMLElement {
  const section = el('div', 'discovery-preview')
  if (request) {
    section.appendChild(el('h3', '', 'Your chat grows the process here'))
    section.appendChild(el('p', 'preview-note', 'Starting point saved · keep working in chat. Optional page context appears only as a drafting aid.'))
    const flow = el('ol', 'preview-flow')
    const before = request.discovery?.before?.answer
    const after = request.discovery?.after?.answer
    for (const [label, text, known] of [
      [before ? 'BEFORE' : 'BEFORE · OPTIONAL', before ?? 'Add preparation context only if it helps.', !!before],
      ['YOUR WORK', request.task, true],
      [after ? 'AFTER' : 'AFTER · OPTIONAL', after ?? 'Add handoff context only if it helps.', !!after],
    ] as const) {
      const item = el('li', `preview-node${known ? ' known' : ' unknown'}`)
      item.appendChild(el('span', 'preview-role', label))
      item.appendChild(el('p', '', text))
      flow.appendChild(item)
    }
    section.appendChild(flow)
    section.appendChild(el('p', 'preview-note', 'Tell your agent about owners, rules or branches in chat. Review the growing draft before you save it.'))
    return section
  }

  section.appendChild(el('h3', '', 'Your process will grow here'))
  section.appendChild(el('p', 'preview-note', 'No process is loaded yet. Start with one sentence about real work on the left.'))
  const empty = el('div', 'preview-empty')
  empty.appendChild(el('strong', '', 'Start with your work'))
  empty.appendChild(el('p', '', 'As you answer and correct your agent, this canvas fills with the actual steps, owners, inputs, conditions, branches and approvals.'))
  section.appendChild(empty)
  return section
}
