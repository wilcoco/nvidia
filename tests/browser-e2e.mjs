import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {chromium} from 'playwright-core'

const defaultChrome = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/google-chrome'
const chrome = process.env.CHROME_PATH || defaultChrome
const strictBrowserGate = process.env.BROWSER_E2E_REQUIRED === '1' || process.env.CI === 'true'
const chromeAvailable = existsSync(chrome)
const expectedBuild = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA)?.slice(0, 7) || 'dev'

test('natural keyboard editing of a seeded draft and 375px role relay survive approval and reload', {skip: !chromeAvailable && !strictBrowserGate, timeout: 60_000}, async()=>{
  assert.ok(chromeAvailable, `Chrome is required for the browser E2E gate; set CHROME_PATH (looked for ${chrome})`)
  let base = ''
  let stderr = ''
  const server = spawn(process.execPath, ['server/index.js'], {
    env: {...process.env, DATABASE_URL: '', PORT: '0'},
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr.on('data', chunk => { stderr += String(chunk) })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/listening on :(\d+)/)
      if (match) { base = `http://127.0.0.1:${match[1]}`; resolve() }
    })
    server.once('exit', code => reject(Error(stderr || `server exited ${code}`)))
  })

  let browser
  try {
    browser = await chromium.launch({executablePath: chrome, headless: true})
    const context = await browser.newContext({viewport: {width: 1280, height: 900}})
    const page = await context.newPage()
    const browserErrors = []
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
    })
    page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`))
    const title = `Browser E2E ${Date.now()}`
    await page.goto(base)
    assert.equal(await page.locator('script[src*="/understudy.js"]').getAttribute('src'), `/understudy.js?v=${expectedBuild}`)
    assert.equal(await page.evaluate(() => window.Understudy.getInteractionState?.().sdkBuild), expectedBuild)
    const plainHtml = await (await page.request.get(`${base}/plain.html`)).text()
    assert.match(plainHtml, new RegExp(`<script src="/understudy\\.js\\?v=${expectedBuild}"></script>`))
    await page.getByRole('button', {name: /Enter demo workspace/}).click()
    await page.getByRole('navigation', {name: 'Workspace'}).waitFor()
    const panel = page.locator('#understudy-panel-host')
    await panel.getByText('Your process will grow here').waitFor()
    assert.equal(await panel.locator('.preview-node').count(), 0, 'the empty start canvas must not look like a preloaded process')
    const firstInput = page.getByRole('textbox', {name: 'Describe your work'})
    await firstInput.waitFor()
    await firstInput.fill('QA-3D NEGATIVE — reconcile one supplier invoice against a purchase order.')
    assert.equal(await page.locator('.suggestion').count(), 0,
      'a generic work-category candidate must not be presented as a related playbook')
    await firstInput.fill('')
    assert.equal(await page.getByText('Hi — what would you like to do?').count(), 0,
      'the empty workspace must not duplicate the real starting form with a second welcome card')
    assert.ok((await firstInput.boundingBox()).y < 900, 'the real starting input belongs in the first viewport')
    await page.evaluate(() => window.__understudy.call('navigate_workspace', {destination: 'records'}))
    await page.getByRole('heading', {name: 'Work records'}).waitFor()
    await page.evaluate(() => window.__understudy.call('navigate_workspace', {destination: 'create'}))
    await firstInput.waitFor()
    await page.setViewportSize({width: 375, height: 812})
    await page.evaluate(() => window.Understudy.closePanel?.())
    assert.equal(await page.locator('.mobile-scope').count(), 0,
      'the task-operation mobile note must not push down the Create process input')
    assert.ok((await page.getByRole('button', {name: 'Save starting point'}).boundingBox()).y < 812,
      'the first input and its submit action must fit in the initial mobile viewport')
    await page.setViewportSize({width: 1280, height: 900})
    await page.evaluate(() => window.Understudy.openPanel?.())

    // The chat-first path keeps one human confirmation but presents the
    // business meaning, not a raw tool/JSON prompt. Approval opens the same
    // chat-first continuation state without forcing focus into a second page form.
    const chatPage = await context.newPage()
    await chatPage.goto(base)
    await chatPage.getByRole('navigation', {name: 'Workspace'}).waitFor()
    const chatPanel = chatPage.locator('#understudy-panel-host')
    const chatTask = 'I am preparing a customer order for delivery.'
    const pendingCapture = await chatPage.evaluate(async task => {
      const tool = window.__understudy.tools.find(candidate => candidate.name === 'run_action')
      const response = await tool.execute({name: 'log_work_item', params: {
        date: new Date().toISOString().slice(0, 10), area: 'A', kind: 'routine work', task,
      }})
      return JSON.parse(response.content[0].text)
    }, chatTask)
    assert.equal(pendingCapture.status, 'pending_approval')
    await chatPanel.getByText('Use this as the starting point?').waitFor()
    await chatPanel.getByText(chatTask, {exact: true}).waitFor()
    assert.equal(await chatPanel.getByText('Run action: log_work_item').count(), 0,
      'raw action names must not lead the first-use confirmation')
    assert.equal(await chatPanel.getByText('Action: log_work_item').isVisible(), false,
      'technical action details stay collapsed by default')
    const chatInput = chatPage.getByRole('textbox', {name: 'Describe your work'})
    const inputBox = await chatInput.boundingBox()
    const attentionBox = await chatPage.getByRole('button', {name: /Your input is needed/}).boundingBox()
    assert.ok(inputBox.y < attentionBox.y && inputBox.y < 900,
      'a pending chat confirmation must not push the real starting input below the first viewport')
    await chatPanel.getByRole('button', {name: 'Save & continue in chat'}).click()
    await chatPage.getByRole('heading', {name: 'Keep building this process in your AI chat.'}).waitFor()
    await chatPage.getByText('Optional page help · add what happens before').waitFor()
    const chatStarter = chatPage.getByRole('textbox', {name: 'Add preparation context (optional)'})
    assert.equal(await chatStarter.isVisible(), false, 'the optional page helper stays collapsed on the chat-first path')
    assert.notEqual(await chatPage.evaluate(() => document.activeElement?.id), 'starter-answer',
      'saving a chat starting point must not move focus into an optional page field')
    await chatPage.locator('main').getByText(chatTask, {exact: true}).waitFor()
    await chatPage.close()

    const mobilePage = await context.newPage()
    await mobilePage.setViewportSize({width: 375, height: 812})
    await mobilePage.goto(base)
    await mobilePage.getByRole('navigation', {name: 'Workspace'}).waitFor()
    await mobilePage.evaluate(() => window.Understudy.closePanel?.())
    await mobilePage.getByRole('textbox', {name: 'Describe your work'}).fill('I inspect a mobile handoff before delivery.')
    await mobilePage.getByRole('button', {name: 'Save starting point'}).click()
    await mobilePage.getByRole('heading', {name: 'Keep building this process in your AI chat.'}).waitFor()
    const mobileOptional = mobilePage.getByText('Optional page help · add what happens before')
    await mobileOptional.waitFor()
    assert.ok((await mobileOptional.boundingBox()).y < 812, 'chat continuation and optional help must remain in the mobile viewport')
    assert.equal(await mobilePage.locator('#understudy-panel-host').locator('.panel').count(), 0,
      'starting on mobile must not cover the first question with the process panel')
    await mobilePage.locator('#understudy-panel-host').getByRole('button', {name: 'Open playbook & conversation'}).waitFor()
    await mobilePage.close()

    // A page-only path remains usable when the current AI chat is not bound to
    // the browser's registered WebMCP tools.
    await page.getByRole('textbox', {name: 'Describe your work'}).fill('I inspect one outgoing parcel before handoff.')
    await page.getByRole('button', {name: 'Save starting point'}).click()
    await page.getByText('Optional page help · add what happens before').click()
    await page.getByRole('textbox', {name: 'Add preparation context (optional)'}).fill('Kim confirms the order and the packed quantity.')
    assert.equal(await page.getByRole('textbox', {name: 'Describe your work'}).count(), 0,
      'the saved starting point replaces the blank new-entry form')
    await page.getByRole('button', {name: 'Save optional note'}).click()
    await page.getByText('Optional page help · add what happens after').click()
    await page.getByRole('textbox', {name: 'Add handoff context (optional)'}).waitFor()
    assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'followup-answer')
    await page.reload()
    await page.getByText('Optional page help · add what happens after').click()
    const followup = page.getByRole('textbox', {name: 'Add handoff context (optional)'})
    await followup.waitFor()
    await page.getByText('✓ What happens before · SAVED').waitFor()
    await followup.fill('Park records the handoff code, then Lee reviews the evidence.')
    await page.getByRole('button', {name: 'Save optional note'}).click()
    await page.evaluate(() => window.__understudy.tools.find(tool => tool.name === 'describe_workspace').execute({}))
    await page.getByRole('button', {name: 'Start a separate work entry'}).waitFor()
    await page.reload()
    await page.getByRole('navigation', {name: 'Workspace'}).waitFor()
    await page.getByText('No connected AI chat? Use the page-only fallback').click()
    await page.getByRole('button', {name: 'Continue interview on this page'}).click()
    await panel.getByText(/Evidence-only starter · work log/).waitFor()
    const starterDraft = await page.evaluate(() => window.Understudy.getLoadedProcess())
    assert.equal(starterDraft.sourceProcessId, undefined, 'a fallback draft is not a revision of a saved playbook')
    assert.ok(starterDraft.sourceWorklogId, 'the worker-supplied source remains attributable')
    assert.equal(starterDraft.draftMode, 'evidence-only')
    assert.equal(await panel.getByRole('button', {name: 'Structure this evidence before saving'}).isDisabled(), true)
    await panel.getByRole('button', {name: 'Optional: show one question here'}).waitFor()
    await page.getByText(`Continue draft from work log #${starterDraft.sourceWorklogId}`).waitFor()
    await page.getByRole('button', {name: 'Start a separate work entry'}).click()
    await page.waitForFunction(() => !window.Understudy.getLoadedProcess?.())
    const newEntry = page.getByRole('textbox', {name: 'Describe your work'})
    await newEntry.fill('I verify a separate customer return before restocking.')
    await page.getByRole('button', {name: 'Save starting point'}).click()
    await page.getByText('Optional page help · add what happens before').waitFor()
    await page.getByText('I inspect one outgoing parcel before handoff.').last().waitFor()
    await page.getByRole('button', {name: 'Continue editing'}).click()
    await page.waitForFunction((sourceWorklogId) => window.Understudy.getLoadedProcess()?.sourceWorklogId === sourceWorklogId,
      starterDraft.sourceWorklogId)
    assert.equal((await page.evaluate(() => window.Understudy.getLoadedProcess())).draftMode, 'evidence-only')
    await page.getByText('I verify a separate customer return before restocking.').last().waitFor()
    assert.equal(await page.getByRole('textbox', {name: 'Describe your work'}).count(), 0,
      'an open draft is visually separate from starting another work entry')

    await page.evaluate((mapTitle) => {
      window.Understudy.draftRevision({
        title: mapTitle,
        elicitationVersion: 1,
        appliesWhen: {kind: 'operations', keywords: ['browser', 'handoff']},
        fields: [
          {key: 'packageCount', label: 'Package count', type: 'number', required: true},
          {key: 'handoffCode', label: 'Handoff code', type: 'string', required: true},
        ],
        steps: [
          {id: 'prepare', label: 'Prepare packages', detail: 'Count every package.', type: 'task', role: 'Contributor', fields: ['packageCount'], next: [{to: 'temporary'}]},
          {id: 'temporary', label: 'Temporary inspection note', detail: 'Remove this draft-only step.', type: 'task', next: [{to: 'route'}]},
          {id: 'route', label: 'Choose parcel route', type: 'decision', role: 'Contributor', next: [
            {to: 'handoff', condition: 'Standard handoff', criteria: {packageCount: {lte: 5}}},
            {to: 'bulk', condition: 'Bulk handoff', criteria: {packageCount: {gt: 5}}},
          ]},
          {id: 'handoff', label: 'Record handoff', detail: 'Record the receiving code.', type: 'task', role: 'Operations', fields: ['handoffCode'], next: [{to: 'approve'}]},
          {id: 'bulk', label: 'Arrange bulk handoff', type: 'task', role: 'Operations', next: [{to: 'approve'}]},
          {id: 'approve', label: 'Approve completed handoff', type: 'approval', role: 'Reviewer', approvalPurpose: 'work'},
        ],
      }, 'browser-e2e-draft')
    }, title)

    const overviewLayout = await panel.evaluate((host) => Object.fromEntries(
      [...host.shadowRoot.querySelectorAll('.overview .mini')].map(group => {
        const shape = group.querySelector('circle, rect')
        const x = shape.tagName === 'circle'
          ? Number(shape.getAttribute('cx'))
          : Number(shape.getAttribute('x')) + Number(shape.getAttribute('width')) / 2
        const y = shape.tagName === 'circle'
          ? Number(shape.getAttribute('cy'))
          : Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')) / 2
        return [group.querySelector('title').textContent.split(' · ')[0].replace(/^\d+\. /, ''), {x, y}]
      }),
    ))
    assert.equal(overviewLayout['Record handoff'].y, overviewLayout['Arrange bulk handoff'].y,
      'peer branch choices belong on the same visual rank')
    assert.equal(overviewLayout['Choose parcel route'].x - overviewLayout['Record handoff'].x,
      overviewLayout['Arrange bulk handoff'].x - overviewLayout['Choose parcel route'].x,
      'peer branch choices split symmetrically around their decision')
    assert.equal(overviewLayout['Approve completed handoff'].x, overviewLayout['Choose parcel route'].x,
      'a shared join returns to the parent lane')

    assert.equal(await panel.getByText(/auto-approve/i).count(), 0, 'the panel must not expose a global mutation bypass')
    const agenda = await page.evaluate(() => window.__understudy.call('get_map_gaps'))
    const incidentGap = agenda.gaps.find(gap => gap.stepId === 'route' && gap.kind === 'knowledge_incident')
    assert.equal(incidentGap.resolves_gap, 'knowledge_incident:route')
    await panel.getByRole('button', {name: 'Optional: show one question here'}).waitFor()
    await page.evaluate((resolvesGap) => window.__understudy.call('ask_user', {
      question: 'Tell me about one recent parcel where experience changed the route decision.',
      resolves_gap: resolvesGap,
    }), incidentGap.resolves_gap)
    await panel.getByRole('button', {name: 'Continue later'}).waitFor()
    await panel.getByRole('button', {name: 'Skip this question'}).waitFor()
    await page.waitForFunction(() => document.querySelector('#understudy-panel-host')?.shadowRoot?.activeElement?.classList.contains('freetext'))
    const sourceAnswer = panel.locator('input.freetext')
    await sourceAnswer.fill('A normal package count hid a crushed corner, so I stopped standard handoff.')
    await sourceAnswer.press('Enter')
    assert.equal(await page.getByRole('navigation', {name: 'Workspace'}).getByRole('button', {name: 'Create process'}).getAttribute('aria-current'), 'page',
      'answering an agent question must keep the current process workspace open')
    await panel.locator('details.answered-question').filter({hasText: 'A normal package count hid a crushed corner'}).waitFor()
    await page.waitForFunction(() => window.Understudy.getLoadedProcess()?.steps.find(step => step.id === 'route')?.elicitation?.incident?.includes('crushed corner'))
    const knowledge = panel.locator('details.knowledge').filter({hasText: 'Expert judgment sources · 1/5'})
    await knowledge.waitFor()
    await knowledge.locator('summary').click()
    await panel.getByText('Draft evidence · confirmed when this playbook is saved').waitFor()
    assert.equal(await panel.getByText(/Human-confirmed/).count(), 0, 'draft answers are proposals until Save as vN')
    const focusedPanelControl = () => panel.evaluate((host) => {
      const active = host.shadowRoot?.activeElement
      return active instanceof HTMLElement
        ? {label: active.getAttribute('aria-label'), focusVisible: active.matches(':focus-visible'), opacity: getComputedStyle(active).opacity}
        : null
    })
    const waitForPanelFocus = (label) => page.waitForFunction((expected) => {
      const host = document.querySelector('#understudy-panel-host')
      return host?.shadowRoot?.activeElement?.getAttribute('aria-label') === expected
    }, label)
    // Start from the page itself and enter the open Shadow DOM using only the
    // browser's sequential focus navigation. This catches focusout renders
    // that direct locator.focus() would bypass.
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
    let reachedLabel = false
    for (let i = 0; i < 200; i++) {
      await page.keyboard.press('Tab')
      if ((await focusedPanelControl())?.label === 'Rename step: Prepare packages') { reachedLabel = true; break }
    }
    assert.equal(reachedLabel, true, 'natural Tab traversal must reach the first step label')
    assert.equal((await focusedPanelControl())?.focusVisible, true)
    await page.keyboard.press('Enter')
    const labelInput = panel.getByRole('textbox', {name: 'Step name: Prepare packages'})
    await labelInput.waitFor()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Prepare counted packages')
    assert.equal(await labelInput.inputValue(), 'Prepare counted packages')
    await page.keyboard.press('Tab')

    await waitForPanelFocus('Edit note for Prepare counted packages')
    assert.equal((await focusedPanelControl())?.label, 'Edit note for Prepare counted packages')
    assert.equal((await focusedPanelControl())?.focusVisible, true)
    await page.keyboard.press('Space')
    const noteInput = panel.getByRole('textbox', {name: 'Step note for Prepare counted packages'})
    await noteInput.waitFor()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Count every package before handoff.')
    assert.equal(await noteInput.inputValue(), 'Count every package before handoff.')
    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(100)

    assert.equal((await focusedPanelControl())?.label, 'Rename step: Prepare counted packages')
    assert.equal((await focusedPanelControl())?.focusVisible, true)
    await page.keyboard.press('Shift+Tab')
    assert.equal((await focusedPanelControl())?.label, 'Remove step: Prepare counted packages')
    assert.equal((await focusedPanelControl())?.focusVisible, true)
    assert.equal((await focusedPanelControl())?.opacity, '1')
    await page.keyboard.press('Shift+Tab')
    assert.equal((await focusedPanelControl())?.label, 'Step type for Prepare counted packages')
    assert.equal((await focusedPanelControl())?.focusVisible, true)
    assert.equal((await focusedPanelControl())?.opacity, '1')

    const typeSelect = panel.getByRole('combobox', {name: 'Step type for Prepare counted packages'})
    assert.equal(await typeSelect.evaluate(el => getComputedStyle(el).opacity), '1')
    const remove = panel.getByRole('button', {name: 'Remove step: Prepare counted packages'})
    assert.equal(await remove.evaluate(el => getComputedStyle(el).opacity), '1')

    // Reach the temporary step through natural navigation, change its real
    // select value, then activate delete with Space. The saved v1 below proves
    // both keyboard mutations reached the map instead of only changing focus.
    let reachedTemporaryType = false
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab')
      if ((await focusedPanelControl())?.label === 'Step type for Temporary inspection note') { reachedTemporaryType = true; break }
    }
    assert.equal(reachedTemporaryType, true)
    assert.equal((await focusedPanelControl())?.opacity, '1', 'focused type control must be immediately visible')
    await panel.getByRole('combobox', {name: 'Step type for Temporary inspection note'}).selectOption('decision')
    await page.waitForFunction(() => {
      const host = document.querySelector('#understudy-panel-host')
      const active = host?.shadowRoot?.activeElement
      return window.Understudy.getLoadedProcess()?.steps.find(step => step.id === 'temporary')?.type === 'decision' &&
        active?.getAttribute('aria-label') === 'Step type for Temporary inspection note' && active.value === 'decision'
    })
    assert.equal(await page.evaluate(() => window.Understudy.getLoadedProcess()?.steps.find(step => step.id === 'temporary')?.type), 'decision')
    await page.keyboard.press('Tab')
    assert.equal((await focusedPanelControl())?.label, 'Remove step: Temporary inspection note')
    assert.equal((await focusedPanelControl())?.opacity, '1', 'focused delete control must be immediately visible')
    await page.keyboard.press('Space')
    await panel.getByRole('button', {name: 'Remove step: Temporary inspection note'}).waitFor({state: 'detached'})
    assert.deepEqual(await page.evaluate(() => {
      const map = window.Understudy.getLoadedProcess()
      return {hasTemporary: map?.steps.some(step => step.id === 'temporary'), prepareNext: map?.steps.find(step => step.id === 'prepare')?.next?.[0]?.to}
    }), {hasTemporary: false, prepareNext: 'route'})

    await panel.getByRole('button', {name: 'Confirm & save to library'}).click()
    await page.waitForFunction(() => window.Understudy.getLoadedProcess()?.confirmed === true && window.Understudy.getLoadedProcess()?.version === 1)
    await panel.getByText(/Human-confirmed by kim/).waitFor()
    await panel.getByRole('button', {name: 'Propose changes (new draft)'}).click()
    const secondNote = panel.getByRole('button', {name: 'Edit note for Prepare counted packages'})
    await secondNote.click()
    await panel.getByRole('textbox', {name: 'Step note for Prepare counted packages'}).fill('Count and verify every package before handoff.')
    await panel.getByRole('textbox', {name: 'Step note for Prepare counted packages'}).press('Enter')
    await panel.getByRole('button', {name: 'Save as v2 to library'}).click()
    await page.waitForFunction(() => window.Understudy.getLoadedProcess()?.confirmed === true && window.Understudy.getLoadedProcess()?.version === 2)

    await page.getByRole('button', {name: 'My tasks', exact: true}).click()
    await page.getByRole('button', {name: /Run this playbook/}).click()
    await page.waitForFunction(() => Boolean(window.Understudy.currentRunId?.()))

    // Assigned task entry and approval are the supported phone workflow.
    const mobileRunId = await page.evaluate(() => window.Understudy.currentRunId?.())
    await page.setViewportSize({width: 375, height: 768})
    await page.reload()
    await page.getByRole('navigation', {name: 'Workspace'}).waitFor()
    await page.waitForFunction((expected) => window.Understudy.currentRunId?.() === expected, mobileRunId)
    await page.getByRole('button', {name: 'My tasks', exact: true}).click()
    await page.getByRole('combobox', {name: 'Working as'}).selectOption('kim')
    await page.getByRole('spinbutton', {name: 'Package count*'}).fill('4')
    await page.getByRole('button', {name: 'Complete & submit'}).click()

    // Exercise the public WebMCP tool implementation against assignee evidence.
    // A fabricated value/route must be refused without mutating the decision;
    // the matching route then unlocks Park's task.
    const refused = await page.evaluate(() => window.__understudy.call('resolve_decision', {
      stepId: 'route', branchTo: 'bulk', reason: 'claim bulk despite submitted count', measurements: {packageCount: 8},
    }))
    assert.equal(refused.ok, false)
    assert.match(refused.error, /^evidence_conflict:/)
    const beforeDecision = await page.evaluate(() => window.__understudy.call('get_process_progress'))
    assert.equal(beforeDecision.branching_steps.find(step => step.id === 'route')?.chosen, null)
    assert.equal(beforeDecision.awaiting_decision?.id, 'route')
    const resolved = await page.evaluate(() => window.__understudy.call('resolve_decision', {
      stepId: 'route', branchTo: 'handoff', reason: 'submitted count uses standard handoff', measurements: {packageCount: 4},
    }))
    assert.equal(resolved.ok, true)
    await page.evaluate(() => window.Understudy.flushRun?.())
    await page.getByRole('combobox', {name: 'Working as'}).selectOption('park')
    await page.getByRole('textbox', {name: 'Handoff code*'}).fill('MOBILE-42')
    await page.getByRole('button', {name: 'Complete & submit'}).click()
    await page.getByText('Review requested — waiting for the assigned reviewer.').waitFor()

    await page.getByRole('combobox', {name: 'Working as'}).selectOption('lee')
    await page.getByRole('navigation', {name: 'Workspace'}).getByRole('button', {name: /^Reviews/}).click()
    await page.getByRole('button', {name: 'Approve'}).click()
    await page.getByRole('button', {name: 'My tasks', exact: true}).click()
    await page.getByText(/Run complete/).waitFor()
    assert.equal(await page.evaluate(() => window.Understudy.getRunSyncError?.()), null,
      'a server-owned final approval must not leave a stale Retry saving progress warning')
    assert.equal(await page.getByRole('button', {name: 'Retry saving progress'}).count(), 0)
    const runId = await page.evaluate(() => window.Understudy.currentRunId?.())

    await page.reload()
    await page.getByRole('navigation', {name: 'Workspace'}).waitFor()
    await page.waitForFunction(() => !window.Understudy.getLoadedProcess?.() && !window.Understudy.currentRunId?.())
    assert.equal(await page.getByRole('textbox', {name: 'Describe your work'}).isVisible(), true,
      'a completed run stays in history instead of occupying the new-work start screen')
    await page.getByText('Choose an existing run').click()
    await page.locator('details.recent-runs button.secondary').filter({hasText: title}).filter({hasText: `#${runId}`}).click()
    await page.waitForFunction((expected) => window.Understudy.currentRunId?.() === expected && window.Understudy.isRunComplete?.() === true, runId)
    assert.equal(await page.evaluate(() => window.Understudy.getRunSyncError?.()), null)
    assert.equal(await page.getByRole('button', {name: 'Retry saving progress'}).count(), 0)
    assert.equal(await page.evaluate(() => window.Understudy.getLoadedProcess()?.version), 2)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
    assert.deepEqual(browserErrors, [], `browser emitted errors:\n${browserErrors.join('\n')}`)
  } finally {
    await browser?.close()
    server.kill()
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve))
  }
})

test('all unfinished interview drafts survive saved-process transitions and reload', {skip: !chromeAvailable && !strictBrowserGate, timeout: 60_000}, async()=>{
  assert.ok(chromeAvailable, `Chrome is required for the browser E2E gate; set CHROME_PATH (looked for ${chrome})`)
  let base = ''
  let stderr = ''
  const server = spawn(process.execPath, ['server/index.js'], {
    env: {...process.env, DATABASE_URL: '', PORT: '0'},
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr.on('data', chunk => { stderr += String(chunk) })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => {
      const match = String(chunk).match(/listening on :(\d+)/)
      if (match) { base = `http://127.0.0.1:${match[1]}`; resolve() }
    })
    server.once('exit', code => reject(Error(stderr || `server exited ${code}`)))
  })

  let browser
  try {
    browser = await chromium.launch({executablePath: chrome, headless: true})
    const context = await browser.newContext({viewport: {width: 1280, height: 900}})
    const page = await context.newPage()
    await page.goto(base)
    await page.getByRole('button', {name: /Enter demo workspace/}).click()
    await page.getByRole('navigation', {name: 'Workspace'}).waitFor()
    const panel = page.locator('#understudy-panel-host')

    // Seed one saved process so the three real transition surfaces can replace
    // the panel while an unrelated interview remains unfinished.
    const savedTitle = `Draft transition sentinel ${Date.now()}`
    await page.evaluate(title => window.Understudy.draftProcess({
      title,
      appliesWhen: {kind: 'routine work', keywords: ['parcel', 'handoff']},
      steps: [
        {id: 'work', label: 'Complete the saved parcel handoff', type: 'task', role: 'Contributor', humanOnly: true},
      ],
    }), savedTitle)
    await panel.getByRole('button', {name: 'Confirm & save to library'}).click()
    await page.waitForFunction(title => {
      const map = window.Understudy.getLoadedProcess?.()
      return map?.title === title && map.confirmed === true && Boolean(map.sourceProcessId)
    }, savedTitle)
    await page.getByRole('button', {name: 'Start a separate work entry'}).click()
    await page.waitForFunction(() => !window.Understudy.getLoadedProcess?.())

    const taskA = 'I inspect one outgoing parcel before handoff.'
    const taskB = 'I inspect a separate customer return before restocking.'
    await page.getByRole('textbox', {name: 'Describe your work'}).fill(taskA)
    await page.getByRole('button', {name: 'Save starting point'}).click()
    await page.getByText('Optional page help · add what happens before').click()
    await page.getByRole('textbox', {name: 'Add preparation context (optional)'}).fill('Kim checks the order and packed quantity first.')
    await page.getByRole('button', {name: 'Save optional note'}).click()
    await page.getByText('Optional page help · add what happens after').click()
    await page.getByRole('textbox', {name: 'Add handoff context (optional)'}).fill('Park records receipt, then Lee reviews the handoff evidence.')
    await page.getByRole('button', {name: 'Save optional note'}).click()
    await page.getByText('No connected AI chat? Use the page-only fallback').click()
    await page.getByRole('button', {name: 'Continue interview on this page'}).click()
    await panel.getByText(/Evidence-only starter · work log/).waitFor()
    await panel.getByRole('button', {name: 'Optional: show one question here'}).waitFor()
    const sourceA = await page.evaluate(() => window.Understudy.getLoadedProcess()?.sourceWorklogId)
    assert.ok(sourceA)

    const exactAnswers = [
      'Parcel 104 had a crushed lower corner, so I stopped the normal handoff.',
    ]
    for (let index = 0; index < exactAnswers.length; index++) {
      const answer = panel.locator('input.freetext').last()
      if (await answer.count() === 0) {
        await panel.getByRole('button', {name: 'Optional: show one question here'}).click()
      }
      await answer.waitFor()
      await answer.fill(exactAnswers[index])
      await answer.press('Enter')
      await page.waitForFunction(expected => {
        const map = window.Understudy.getLoadedProcess?.()
        return (map?.steps.reduce((total, step) => total + (step.elicitation?.answers?.length ?? 0), 0) ?? 0) >= expected
      }, index + 1)
    }
    // A -> B -> resume A establishes two independent unfinished sessions.
    await page.getByRole('button', {name: 'Start a separate work entry'}).click()
    await page.waitForFunction(() => !window.Understudy.getLoadedProcess?.())
    await page.getByRole('textbox', {name: 'Describe your work'}).fill(taskB)
    await page.getByRole('button', {name: 'Save starting point'}).click()
    await page.getByText(taskA).last().waitFor()
    await page.locator('.paused-draft').filter({hasText: taskA}).getByRole('button', {name: 'Continue editing'}).click()
    await page.waitForFunction(id => window.Understudy.getLoadedProcess?.()?.sourceWorklogId === id, sourceA)

    const assertBothDrafts = async () => {
      const storedTasks = await page.evaluate(() => JSON.parse(sessionStorage.getItem('understudy.workspace') ?? '{}')
        .pausedDrafts?.map(draft => ({key: draft.key, task: draft.task, title: draft.title, sourceWorklogId: draft.map?.sourceWorklogId})) ?? [])
      assert.deepEqual(storedTasks.map(draft => draft.task).sort(), [taskA, taskB].sort(), JSON.stringify(storedTasks, null, 2))
      const loadedIdentity = await page.evaluate(() => {
        const map = window.Understudy.getLoadedProcess?.()
        const workspace = JSON.parse(sessionStorage.getItem('understudy.workspace') ?? '{}')
        return {title: map?.title, sourceProcessId: map?.sourceProcessId, sourceWorklogId: map?.sourceWorklogId,
          captureContext: workspace.captureContext, visiblePaused: document.querySelectorAll('.paused-draft').length}
      })
      await page.getByText(taskA).last().waitFor({timeout: 5_000}).catch(error => {
        throw new Error(`${error.message}\nloaded=${JSON.stringify(loadedIdentity)}`)
      })
      await page.getByText(taskB).last().waitFor({timeout: 5_000})
      assert.equal(await page.locator('.paused-draft').count(), 2)
    }
    const resumeAAndCheckEvidence = async () => {
      await page.locator('.paused-draft').filter({hasText: taskA}).getByRole('button', {name: 'Continue editing'}).click()
      await page.waitForFunction(id => window.Understudy.getLoadedProcess?.()?.sourceWorklogId === id, sourceA)
      assert.deepEqual(await page.evaluate(() => window.Understudy.getLoadedProcess().steps
        .flatMap(step => step.elicitation?.answers ?? []).map(answer => answer.answer)), exactAnswers)
    }

    // 1) Playbooks library.
    await page.getByRole('navigation', {name: 'Workspace'}).getByRole('button', {name: 'Use a playbook'}).click()
    await page.getByRole('button', {name: new RegExp(savedTitle)}).click()
    await page.getByRole('button', {name: 'Run this playbook'}).click()
    await page.waitForFunction(title => window.Understudy.getLoadedProcess?.()?.title === title && Boolean(window.Understudy.currentRunId?.()), savedTitle)
    await page.getByRole('navigation', {name: 'Workspace'}).getByRole('button', {name: 'Create process'}).click()
    await assertBothDrafts()
    await resumeAAndCheckEvidence()

    // 2) Contextual suggestion card.
    await page.getByRole('button', {name: 'Start a separate work entry'}).click()
    await page.waitForFunction(() => !window.Understudy.getLoadedProcess?.())
    await page.getByRole('textbox', {name: 'Describe your work'}).fill('Another parcel handoff needs the saved route.')
    await page.getByRole('button', {name: 'Follow this playbook'}).click()
    await page.waitForFunction(title => window.Understudy.getLoadedProcess?.()?.title === title && Boolean(window.Understudy.currentRunId?.()), savedTitle)
    await page.getByRole('navigation', {name: 'Workspace'}).getByRole('button', {name: 'Create process'}).click()
    await assertBothDrafts()
    await resumeAAndCheckEvidence()

    // 3) Existing-run picker.
    await page.getByRole('navigation', {name: 'Workspace'}).getByRole('button', {name: 'Use a playbook'}).click()
    await page.getByText('Choose an existing run').click()
    const runChoice = page.locator('details.recent-runs button.secondary').filter({hasText: savedTitle}).filter({hasText: 'active'}).first()
    await runChoice.waitFor()
    await runChoice.click()
    await page.waitForFunction(title => window.Understudy.getLoadedProcess?.()?.title === title && Boolean(window.Understudy.currentRunId?.()), savedTitle)
    await page.getByRole('navigation', {name: 'Workspace'}).getByRole('button', {name: 'Create process'}).click()
    await assertBothDrafts()
    await resumeAAndCheckEvidence()

    // The active draft is restored from the same registry after a full reload;
    // the other unfinished entry remains selectable and all source answers are exact.
    await page.reload()
    await page.getByRole('navigation', {name: 'Workspace'}).waitFor()
    await page.waitForFunction(id => window.Understudy.getLoadedProcess?.()?.sourceWorklogId === id, sourceA)
    assert.deepEqual(await page.evaluate(() => window.Understudy.getLoadedProcess().steps
      .flatMap(step => step.elicitation?.answers ?? []).map(answer => answer.answer)), exactAnswers)
    await page.getByText(taskB).last().waitFor()
    assert.equal(await page.locator('.paused-draft').filter({hasText: taskB}).count(), 1)
  } finally {
    await browser?.close()
    server.kill()
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve))
  }
})
