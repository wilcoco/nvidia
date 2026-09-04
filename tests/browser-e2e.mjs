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
    await page.getByRole('button', {name: /Enter demo workspace/}).click()
    await page.getByRole('navigation', {name: 'Workspace'}).waitFor()

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

    const panel = page.locator('#understudy-panel-host')
    assert.equal(await panel.getByText(/auto-approve/i).count(), 0, 'the panel must not expose a global mutation bypass')
    const agenda = await page.evaluate(() => window.__understudy.call('get_map_gaps'))
    const incidentGap = agenda.gaps.find(gap => gap.stepId === 'route' && gap.kind === 'knowledge_incident')
    assert.equal(incidentGap.resolves_gap, 'knowledge_incident:route')
    await page.evaluate((resolvesGap) => window.__understudy.call('ask_user', {
      question: 'Tell me about one recent parcel where experience changed the route decision.',
      resolves_gap: resolvesGap,
    }), incidentGap.resolves_gap)
    const sourceAnswer = panel.locator('input.freetext')
    await sourceAnswer.fill('A normal package count hid a crushed corner, so I stopped standard handoff.')
    await sourceAnswer.press('Enter')
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
    await panel.locator('details.knowledge').locator('summary').click()
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
    const runId = await page.evaluate(() => window.Understudy.currentRunId?.())

    await page.reload()
    await page.getByRole('navigation', {name: 'Workspace'}).waitFor()
    await page.waitForFunction((expected) => window.Understudy.currentRunId?.() === expected && window.Understudy.isRunComplete?.() === true, runId)
    assert.equal(await page.evaluate(() => window.Understudy.getLoadedProcess()?.version), 2)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
    assert.deepEqual(browserErrors, [], `browser emitted errors:\n${browserErrors.join('\n')}`)
  } finally {
    await browser?.close()
    server.kill()
    await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve))
  }
})
