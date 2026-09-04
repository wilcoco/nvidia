/** Starter guidance is supplied by the product; follow-up questions come from the visitor's agent. */
export const STARTER_QUESTION = 'What needs to happen before this work can start?'
export const FOLLOWUP_QUESTION = 'What happens after this work, and who takes over?'
export const EXAMPLE_WORK = 'I am preparing a customer order for delivery.'
export interface DiscoveryAnswer {
  answer: string
  answeredBy: string
  answeredAt: number
}
export interface PlaybookRequest {
  worklogId: string
  task: string
  discovery?: { before?: DiscoveryAnswer; after?: DiscoveryAnswer }
}

export function discoveryInvite(work: PlaybookRequest, url: string): string {
  const before = work.discovery?.before
  const after = work.discovery?.after
  return `Help me create a new playbook in Understudy: ${url}\nRead describe_workspace and work log #${work.worklogId}: “${work.task}”.${before ? `\nI already answered “${STARTER_QUESTION}”: “${before.answer}”.` : ''}${after ? `\nI already answered “${FOLLOWUP_QUESTION}”: “${after.answer}”.` : ''}${before || after ? '\nKeep these answers and ask only about what is still missing.' : ''}\nUse ask_user to ask one concrete question at a time about the preceding and following work, owners, rules and exceptions. Build the process beside my work from my answers, and let me correct and confirm it. Do not invent answers, start execution or complete work for me.`
}
