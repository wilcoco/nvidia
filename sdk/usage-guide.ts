export type GuideLanguage = 'en' | 'ko'
export type GuideTopic = 'overview' | 'usage'

export function buildUsageGuide(language: GuideLanguage, topic: GuideTopic, dismiss: () => void, changeTopic: (topic: GuideTopic) => void): HTMLElement {
  const ko = language === 'ko'
  const overview = topic === 'overview'
  const guide = document.createElement('section')
  guide.className = 'usage-guide'
  guide.lang = language
  guide.setAttribute('aria-label', ko ? 'Understudy 안내' : 'Understudy guide')
  const add = (tag: string, text: string) => {
    const node = document.createElement(tag)
    node.textContent = text
    guide.appendChild(node)
    return node
  }
  add('h2', overview ? ko ? 'Understudy는 이런 서비스입니다' : 'What is Understudy?' : ko ? '이렇게 사용하세요' : 'Here’s how to use Understudy')
  add('p', ko ? '업무 한 줄에서 시작해, 팀이 순서대로 실행하고 다음에도 재사용할 프로세스를 만듭니다.' : 'Start with one task. Build a process your team can follow and reuse.')
  const steps = overview ? ko ? [
    '업무를 발견합니다. AI가 앞뒤 업무·담당자·판단 기준을 묻고, 사람의 답과 교정으로 프로세스를 만듭니다.',
    '팀이 실행합니다. 각 담당자가 자기 단계를 처리하면 다음 담당자에게 업무가 이어집니다.',
    '경험을 재사용합니다. 비슷한 업무에서 기존 플레이북을 골라 다시 실행하고, 새로 알게 된 절차는 검토해 반영합니다.',
  ] : [
    'Discover the process. Your agent asks about preceding and following work, owners and rules, then builds from your answers and corrections.',
    'Run it as a team. Each person completes their step and hands work to the next owner.',
    'Reuse the experience. Choose a saved playbook for similar work, and review new knowledge before updating it.',
  ] : ko ? [
    'Create process에서 지금 하는 일을 한 줄로 적고 첫 질문에 답하세요. 로그인 전이면 Enter demo workspace로 들어오세요.',
    '이어지는 요청을 이 브라우저를 연 AI 채팅에 보내세요. 에이전트가 앞뒤 업무·담당자·판단 기준을 묻고, 질문은 이 패널에 나타납니다.',
    '오른쪽 프로세스에서 틀린 단계나 규칙을 고치고 확정하세요. 저장한 프로세스를 플레이북이라고 부릅니다.',
    'Run this playbook으로 실행하세요. My tasks에서 각 담당자가 순서대로 처리하고, 승인할 일은 Reviews에 나타납니다.',
    '비슷한 업무를 할 때 추천되는 플레이북을 선택하거나 Playbooks에서 찾아 다시 실행하세요.',
  ] : [
    'In Create process, describe one task and answer the first question. If you are signed out, enter the demo workspace first.',
    'Send the request in the AI chat that opened this tab. Your agent asks about the surrounding work, owners and rules. Its questions appear in this panel.',
    'Correct the steps and rules in the process on the right, then confirm. This saved process is your playbook.',
    'Choose Run this playbook. Each owner follows their steps in My tasks; sign-offs appear in Reviews.',
    'For similar work, choose a suggested playbook or find one in Playbooks to run it again.',
  ]
  const list = add('ol', '')
  for (const step of steps) {
    const item = document.createElement('li')
    item.textContent = step
    list.appendChild(item)
  }
  if (overview) add('p', ko ? 'Example: “Preparing a customer order” → Confirm order → Pack order → Delivery handoff → Confirm receipt. 반복 업무를 여러 사람이 나누어 처리하는 팀에 맞습니다.' : 'Example: “Preparing a customer order” becomes order confirmation → packing → delivery handoff → receipt. It helps teams coordinate recurring work across people.')
  else add('p', ko ? 'Tools registered는 페이지 등록 상태이고 Agent connected는 실제 호출 상태입니다. 채팅이 연결되지 않으면 페이지의 starter draft와 수동 인터뷰를 사용할 수 있습니다.' : '“Tools registered” is page registration; “Agent connected” appears only after a real tool call. If the chat is not attached, use the on-page starter draft and manual interview.')
  const next = add('button', overview ? ko ? '사용 방법 보기 →' : 'Show me how →' : ko ? '서비스 소개 보기' : 'What is this service?')
  next.onclick = () => changeTopic(overview ? 'usage' : 'overview')
  const close = add('button', ko ? '알겠어요 · 업무로 돌아가기' : 'Got it · back to my work')
  close.onclick = dismiss
  return guide
}
