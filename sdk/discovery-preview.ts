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
    section.appendChild(el('h3', '', 'Your process starts here'))
    section.appendChild(el('p', 'preview-note', 'Saved notes · your agent will turn these into steps for you to review.'))
    const flow = el('ol', 'preview-flow')
    const before = request.discovery?.before?.answer
    for (const [label, text, known] of [
      ['BEFORE', before ?? 'What needs to happen first?', !!before],
      ['YOUR WORK', request.task, true],
      ['AFTER', 'What happens next, and who takes over?', false],
    ] as const) {
      const item = el('li', `preview-node${known ? ' known' : ' unknown'}`)
      item.appendChild(el('span', 'preview-role', label))
      item.appendChild(el('p', '', text))
      flow.appendChild(item)
    }
    section.appendChild(flow)
    section.appendChild(el('p', 'preview-note', 'Next, agree on the owners and rules. Your confirmed playbook will guide each person’s tasks.'))
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
