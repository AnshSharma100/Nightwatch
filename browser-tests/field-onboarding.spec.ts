import { expect, test } from '@playwright/test'
import { beginning, fixture } from '../tests/fixture.ts'

for (const clears of [false, true]) {
  test('dispatches from the selected recording when the fault ' + (clears ? 'has cleared later' : 'is still active later'), async ({ page, browser }) => {
    await page.request.post('/api/session', { data: { code: 'playwright-control-code' } })
    const source = fixture((id, metric, step, value) => id === 'A/pump' && metric === 'status' && step >= 2 && (!clears || step === 2) ? 2 : value)
    await page.goto('/')
    await page.locator('input[type=file]').setInputFiles([
      { name: 'network.json', mimeType: 'application/json', buffer: Buffer.from(source.network) },
      { name: 'ops.json', mimeType: 'application/json', buffer: Buffer.from(source.ops) },
      { name: 'telemetry.csv', mimeType: 'text/csv', buffer: Buffer.from(source.csv) },
    ])
    await expect(page.getByRole('combobox', { name: 'Dataset' })).toHaveValue('Imported dataset')
    await page.getByRole('button', { name: 'Recorded timeline', exact: true }).click()
    const slider = page.getByRole('slider', { name: 'Recorded timestamp' })
    await slider.focus()
    const frame = page.waitForResponse((response) => response.url().includes('/snapshot?at=') && response.ok())
    await slider.press('ArrowLeft')
    await frame
    await page.getByRole('button', { name: /Pump failure A\/pump/ }).click()
    if (clears) {
      await page.getByRole('button', { name: 'Compare response plans' }).click()
      const lab = page.getByRole('main', { name: 'Decision Lab' })
      await lab.getByRole('button', { name: 'Copy to operator plan' }).click()
      await expect(lab.locator('.branch-choice.operator')).toHaveAttribute('aria-pressed', 'true')
      await lab.getByRole('button', { name: 'Use this plan for approval' }).click()
    }
    const workflow = page.locator('.workflow-fold')
    if (!clears) await workflow.locator(':scope > summary').click()
    await expect(workflow.getByRole('button', { name: 'Go to latest recording' })).toHaveCount(0)
    await expect(workflow.getByText(/Demo assignment · evidence recorded at Nov 7, 00:10 UTC/)).toBeVisible()
    const reviewResponse = page.waitForResponse((response) => response.url().endsWith('/api/workflow') && response.request().method() === 'POST')
    await workflow.getByRole('button', { name: 'Begin review' }).click()
    const reviewed = await reviewResponse
    expect(reviewed.ok()).toBeTruthy()
    const update = reviewed.request().postDataJSON()
    expect(update.incident.observedAt).toBe(beginning + 600)
    // Removing the latest-only policy must not allow forged timestamps or incidents.
    for (const changed of [{ observedAt: beginning + 601 }, { assetId: 'unrelated/pump' }]) {
      expect((await page.request.post('/api/workflow', { data: {
        ...update, incident: { ...update.incident, ...changed },
      } })).status()).toBe(422)
    }
    if (clears) expect((await page.request.post('/api/workflow', { data: {
      ...update, incident: { ...update.incident, observedAt: beginning + 900 },
    } })).status()).toBe(422)
    await workflow.getByRole('button', { name: 'Create connection link' }).click()
    const link = await workflow.getByLabel('Field connection link').inputValue()
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    try {
      const field = await context.newPage()
      await field.goto(link)
      await field.getByRole('button', { name: 'Connect this device' }).click()
      await field.getByRole('button', { name: 'Clock in' }).click()
      await expect(field.getByRole('heading', { name: 'Available', exact: true })).toBeVisible()
      await workflow.getByLabel('Reason for confirmation').fill('Confirmed from the selected demo recording.')
      await workflow.getByRole('button', { name: 'Confirm incident' }).click()
      await workflow.getByLabel('Available engineer').selectOption({ label: 'Facility engineer · A · Available' })
      await workflow.getByLabel('Field instructions').fill('Inspect the pump in this recorded demo scenario.')
      const assignmentResponse = page.waitForResponse((response) => response.url().endsWith('/api/workflow') && response.request().method() === 'POST')
      await workflow.getByRole('button', { name: 'Send to Field', exact: true }).click()
      const sent = await assignmentResponse
      expect(sent.ok()).toBeTruthy()
      const saved = await sent.json()
      expect(saved.incident.observedAt).toBe(beginning + 600)
      expect(saved.incident.readings).toContain('Tank fill · 69.8%')
      if (clears) expect(saved.assignment.approvalPlan.at).toBe(beginning + 600)
      const retried = await page.request.post('/api/workflow', { data: sent.request().postDataJSON() })
      expect(retried.ok()).toBeTruthy()
      expect((await retried.json()).history).toHaveLength(3)
      await field.goto('/field/assignments/' + saved.assignment.id)
      await expect(field.getByText(/Demo assignment · evidence recorded at Nov 7, 00:10 UTC/)).toBeVisible()
      await field.getByRole('button', { name: 'Acknowledge' }).click()
      await expect(workflow.getByText('Acknowledged', { exact: true })).toBeVisible()
      await expect(page.getByRole('slider', { name: 'Recorded timestamp' })).toHaveValue('2')
      if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/dispatch-recorded-' + clears + '.png' })
    } finally { await context.close() }
  })
}

test('guided demo allows field review at its paused incident', async ({ page }) => {
  await page.request.post('/api/session', { data: { code: 'playwright-control-code' } })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start Demo', exact: true }).click()
  await page.getByRole('combobox', { name: 'Recorded playback speed' }).selectOption('250')
  await page.getByRole('button', { name: 'Replay the lead-up' }).click()
  await expect(page.getByText('A pump has failed', { exact: true })).toBeVisible({ timeout: 20000 })
  await page.getByRole('region', { name: 'Operator actions' }).getByRole('button', { name: '3 · Send to Field' }).click()
  await expect(page.getByText('Guided demo', { exact: true })).toBeVisible()
  const workflow = page.locator('.workflow-fold')
  await expect(workflow.getByRole('button', { name: 'Begin review' })).toBeEnabled()
  await expect(workflow.getByRole('button', { name: 'Go to latest recording' })).toHaveCount(0)
})

test('operator can find phone setup and generate a local QR using the configured public URL', async ({ page }) => {
  await page.request.post('/api/session', { data: { code: 'playwright-control-code' } })
  // A controlled public origin avoids exposing test enrollment credentials through a tunnel.
  await page.route('**/api/workflow/invite', async (route) => {
    const response = await route.fetch()
    expect(response.ok()).toBeTruthy()
    await route.fulfill({ json: { ...await response.json(), publicOrigin: 'https://phone.example.test' } })
  })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('snapshot_2026-10-10T0900')
  await page.getByRole('region', { name: 'Operator actions' }).getByRole('button', { name: '3 · Send to Field' }).click()
  const workflow = page.locator('.workflow-fold')
  // The shared test store may already contain a reviewed case.
  const review = workflow.getByRole('button', { name: 'Begin review' })
  if (await review.isVisible()) await review.click()
  const connection = workflow.getByRole('region', { name: 'Connect a field device' })
  await expect(connection).toBeVisible()
  await connection.getByRole('button', { name: 'Create connection link' }).click()
  await expect(connection.getByLabel('Field connection link')).toHaveValue(/^https:\/\/phone\.example\.test\/field#invite=/)
  const qr = connection.getByRole('img', { name: /Scan to connect/ })
  await expect(qr).toBeVisible()
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/)
  expect((await (await page.request.get('/api/session')).json()).person.role).toBe('control')
})

test('a connection link requires a deliberate action and an invalid invite leaves code entry available', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const sessionPosts: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/session') && request.method() === 'POST') sessionPosts.push(request.method())
  })
  await page.goto('/field#invite=' + 'A'.repeat(32))
  const connect = page.getByRole('button', { name: 'Connect this device' })
  await expect(connect).toBeEnabled()
  expect(new URL(page.url()).hash).toBe('')
  expect(sessionPosts).toHaveLength(0)
  await connect.click()
  await expect(page.getByRole('alert')).toContainText('invalid, expired, or already used')
  expect(sessionPosts).toHaveLength(1)
  await page.getByText('Have a one-time code instead?', { exact: true }).click()
  await expect(page.getByLabel('Field sign-in code')).toBeEditable()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
})

test('field inbox and clock-in remain available when this browser cannot receive push', async ({ page }) => {
  // Browser capability and account fixtures only; this does not verify push delivery.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'PushManager') })
  await page.route('**/api/session', (route) => route.fulfill({ json: {
    person: { id: 'field-fixture', role: 'lease', name: 'Facility engineer · Demonstration site' }, configured: true,
  } }))
  await page.route('**/api/workflow', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/shift', (route) => route.fulfill({ json: {
    status: 'off', clockedInAt: null, changedAt: null, expiresAt: null,
  } }))
  await page.goto('/field')
  await expect(page.getByRole('heading', { name: 'My assignments' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clock in' })).toBeEnabled()
  await expect(page.getByText('Unavailable in this browser', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable notifications' })).toHaveCount(0)
  await page.getByText('How does the phone get an assignment?', { exact: true }).click()
  await expect(page.getByText(/A phone alert opens the current assignment/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})
