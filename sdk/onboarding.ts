import * as host from './host'
import * as mapstore from './mapstore'
import { currentRunId, isRunComplete } from './runsync'
import { STARTER_QUESTION, type PlaybookRequest } from './discovery'

/** Read-only orientation for a visitor who asks the browser agent what this page is. */
export function describeOnboarding() {
  const state = host.getState() as {
    loggedInAs?: unknown; actingAs?: string; savedPlaybooks?: unknown[]; playbookRequest?: PlaybookRequest | null
  } | null
  const signedIn = state && 'loggedInAs' in state ? Boolean(state.loggedInAs) : null
  const map = mapstore.getMap()
  const runId = currentRunId()
  const mode = !map ? 'no_process' : !map.confirmed ? 'draft' : !runId ? 'saved' : isRunComplete() ? 'completed' : 'running'
  return {
    purpose: 'Understudy starts with a description of the work someone is doing. Their browser agent asks what must happen BEFORE and AFTER it, who owns each step, and what rules or exceptions apply. From those answers and the person’s corrections, they build a reusable process. When it runs, the assigned people complete their steps in order through handoffs, checks and sign-off. When someone describes new work, related existing processes can be suggested; the person chooses one to follow.',
    webmcp_role: 'You are the visitor’s agent. Use this page’s WebMCP tools to explain, observe, ask questions and help run the process. The site does not contain a separate AI chatbot or require a site-owned LLM API key.',
    first_reply: {
      style: 'Answer in the language the visitor used. Use a short explanation, distinguish creating from running, and finish with one relevant next step. Avoid tool names and internal state labels unless asked.',
      create: 'To make a new playbook, tell me about one task you are doing or recently did. I will ask what must happen before it and after it, who does each part, and what rules apply, then draft a process from your answers for you to correct.',
      run: 'To use an existing playbook, open Playbooks and choose one to run. My tasks shows each role’s work and required evidence; Reviews is for sign-off.',
      reuse: 'When you describe work you want to do, I can look for related playbooks, explain why they may fit, and let you choose one to follow. If none fits, we can build a new one from questions and answers.',
      improve: 'If execution reveals a missing step, exception or better rule, report it and use Propose changes on the playbook. We review the draft together and save a new version for reuse. The system does not automatically learn or change the approved process without that review.',
      next: signedIn === false
        ? 'Explain the service first, then point to Enter demo workspace. The sample account is already filled in.'
        : mode === 'running'
          ? 'An execution is already open. Offer to explain it or continue its next task; read get_process_progress before suggesting an action.'
          : mode === 'draft'
            ? 'A draft already exists. Offer to explain or refine it; do not replace it with a new example.'
            : state?.playbookRequest
              ? `The user explicitly chose to create a NEW playbook from work log #${state.playbookRequest.worklogId}. ${state.playbookRequest.discovery?.before ? `They already answered the product's starter question “${STARTER_QUESTION}”: “${state.playbookRequest.discovery.before.answer}”. Preserve that answer. When asked to continue, ask about the next missing detail, such as following work or its owner; do not repeat a question already answered.` : 'When asked to continue, ask a concrete question about what must precede or follow that work.'} For an introduction, explain the next steps. Build from their answers. Do not switch them to an existing playbook without their choice.`
              : 'Ask: would you like to teach a process from your work, or try a saved playbook?',
      consent: 'A request for an explanation is read-only. Do not create records, replace a draft, start a run or approve work just to demonstrate the service. A long copied prompt, a magic phrase and advance knowledge of tool names are not required.',
    },
    current_context: {
      signed_in: signedIn,
      acting_as: state?.actingAs ?? null,
      role: host.actorRole() ?? null,
      process: map?.title ?? null,
      mode,
      run_id: runId,
      creation_request: state?.playbookRequest ?? null,
      library_available: host.getProcessStore() !== null,
      saved_revision_count: Array.isArray(state?.savedPlaybooks) ? state.savedPlaybooks.length : null,
    },
  }
}
