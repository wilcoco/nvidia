import { EXAMPLE_WORK, type PlaybookRequest } from './discovery'

let exampleStage = 0
function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  if (text) node.textContent = text
  return node
}

/** A labelled illustration, never inserted into mapstore or the saved library. */
export function discoveryPreview(request: PlaybookRequest | null, refresh: () => void): HTMLElement {
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

  section.appendChild(el('h3', '', 'From one task to the whole process'))
  section.appendChild(el('p', 'preview-note', 'Interactive example · no records are created'))
  const tabs = el('div', 'preview-stages')
  ;['Work', 'Discover', 'Run', 'Reuse'].forEach((label, index) => {
    const button = el('button', '', `${index + 1}. ${label}`)
    button.setAttribute('aria-pressed', String(exampleStage === index))
    button.onclick = () => { exampleStage = index; refresh() }
    tabs.appendChild(button)
  })
  section.appendChild(tabs)
  section.appendChild(el('blockquote', 'preview-work', `“${EXAMPLE_WORK}”`))
  const messages = [
    'You know your task. The questions uncover the work around it.',
    'Question: “Before packing, who confirms the quantity and delivery date?”\nAnswer: “Sales confirms both with the customer.”',
    'Sales has confirmed the order. Warehouse now sees “Prepare the order” in My tasks. Finishing it hands the work to Logistics.',
    'Next order? The saved “Customer delivery” playbook is suggested. Choose it to start a fresh run with the same steps and owners.',
  ]
  section.appendChild(el('p', 'preview-story', messages[exampleStage]))
  const nodes = exampleStage === 0
    ? [['?', 'Before · still to discover', 'unknown'], ['Prepare the order', 'Your starting task', 'known'], ['?', 'After · still to discover', 'unknown']]
    : [['Confirm quantity & date', 'Sales', exampleStage === 2 ? 'complete' : 'known'], ['Prepare the order', 'Warehouse', exampleStage === 2 ? 'current' : 'known'], ['Arrange delivery', 'Logistics', 'known'], ['Confirm receipt', 'Sales', 'known']]
  const flow = el('ol', 'preview-flow')
  for (const [label, owner, status] of nodes) {
    const item = el('li', `preview-node ${status}`)
    item.appendChild(el('span', 'preview-role', `${owner}${status === 'complete' ? ' · DONE' : status === 'current' ? ' · NEXT OWNER' : ''}`))
    item.appendChild(el('p', '', label))
    flow.appendChild(item)
  }
  section.appendChild(flow)
  const next = el('button', 'preview-next', exampleStage === 3 ? 'See the example again ↺' : ['See the questions →', 'See the handoff →', 'See it reused →'][exampleStage])
  next.onclick = () => { exampleStage = (exampleStage + 1) % 4; refresh() }
  section.appendChild(next)
  section.appendChild(el('p', 'preview-note', 'Try your own work on the left. Your answers and corrections determine the real process.'))
  return section
}
