import { expect, test } from '@playwright/test'
import { fixture } from '../tests/fixture.ts'

for (const clears of [false, true]) {
  test('historical dispatch offers a recovery action when the fault ' + (clears ? 'has cleared' : 'is still active'), async ({ page }) => {
    await page.request.post('/api/session', { data: { code: 'playwright-control-code' } })
    const source = fixture((id, metric, step, value) => id === 'A/pump' && metric === 'status' && step >= 2 && (!clears || step === 2) ? 2 : value)
    let updates = 0
    page.on('request', (request) => { if (request.url().endsWith('/api/workflow') && request.method() === 'POST') updates++ })
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
    const workflow = page.locator('.workflow-fold')
    await workflow.locator(':scope > summary').click()
    await expect(workflow.getByRole('heading', { name: 'Historical recording — dispatch paused' })).toBeVisible()
    await expect(workflow.locator('.field-connection-hint')).toHaveCount(0)
    await expect(workflow.getByRole('button', { name: 'Begin review' })).toHaveCount(0)
    await workflow.getByRole('button', { name: 'Go to latest recording' }).click()
    await expect(page.getByText('Latest recording', { exact: true })).toBeVisible()
    if (clears) await expect(page.getByText('No active incidents at the latest recording. Historical faults can be investigated, but cannot receive new field assignments.')).toBeVisible()
    else await expect(workflow.getByRole('button', { name: 'Begin review' })).toBeVisible()
    expect(updates).toBe(0)
  })
}

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
