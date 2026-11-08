import { expect, test } from '@playwright/test'
import { fixture } from '../tests/fixture.ts'

function uploadFiles() {
  const { network, ops, csv } = fixture((asset, metric, _step, value) => asset === 'A/pump' && metric === 'status' ? 2 : value)
  return [
    { name: 'network.json', mimeType: 'application/json', buffer: Buffer.from(network) },
    { name: 'ops.json', mimeType: 'application/json', buffer: Buffer.from(ops) },
    { name: 'telemetry.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) },
  ]
}

test('renders the practice network and replays the shared-fleet demo', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'NIGHTWATCH' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No active alerts' })).toBeVisible()
  const canvas = page.locator('.map-container canvas')
  await expect(canvas).toBeVisible({ timeout: 25000 })
  expect(await canvas.evaluate((element: HTMLCanvasElement) => Boolean(element.getContext('webgl2')))).toBe(true)
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/network.png' })
  await page.getByRole('button', { name: 'Start Demo' }).click()
  await page.getByRole('button', { name: 'Replay the lead-up' }).click()
  await expect(page.getByText('A pump has failed')).toBeVisible({ timeout: 12000 })
  await page.getByText('Detection evidence', { exact: true }).click()
  await expect(page.getByText('Pump status reports fault (2).')).toBeVisible()
  await page.getByRole('button', { name: 'Show shared fleet pressure' }).click()
  await expect(page.getByText('Three failures are competing for one fleet')).toBeVisible({ timeout: 15000 })
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/incident.png' })
  await page.getByRole('button', { name: 'Compare responses' }).click()
  const lab = page.getByRole('dialog', { name: 'Decision Lab' })
  await expect(lab).toBeVisible()
  await expect(lab.getByText(/less than the manual response/)).toBeVisible()
  await expect(lab.getByText('Simulated · +0 min')).toBeVisible()
  await expect(lab.getByRole('img', { name: 'Operator plan schematic truck and tank playback' })).toBeVisible()
  const status = await page.request.get('/api/nemotron')
  expect(status.ok()).toBeTruthy()
  expect(typeof (await status.json()).configured).toBe('boolean')
  await lab.getByRole('button', { name: 'Play simulation' }).click()
  await expect(lab.getByText('Simulated · +0 min')).toBeHidden()
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/decision.png' })
  await page.keyboard.press('Escape')
  await expect(lab).toBeHidden()
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('mock_test_2026-10-10T1530')
  await expect(page.getByRole('button', { name: /Pump failure S5_PUMP_C/ })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(uploadFiles())
  await page.getByRole('navigation', { name: 'Network breadcrumb' }).getByRole('button', { name: 'All systems' }).click()
  const labels = page.locator('.scene-label-overlay')
  await expect(labels.getByRole('button')).toHaveCount(1)
  await expect(labels.getByRole('button', { name: /new\/region/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('imports unseen IDs, keeps the list usable without WebGL, and rejects a broken file set', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return /webgl/.test(type) ? null : Reflect.apply(getContext, this, [type, ...args])
    } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'No active alerts' })).toBeVisible()
  const upload = page.locator('input[type=file]')
  await upload.setInputFiles(uploadFiles())
  await expect(page.getByRole('combobox', { name: 'Dataset' })).toHaveValue('Imported dataset')
  await expect(page.getByText('List view · WebGL unavailable')).toBeVisible()
  await page.getByRole('navigation', { name: 'Network breadcrumb' }).getByRole('button', { name: 'All systems' }).click()
  await expect(page.getByRole('region', { name: 'Water network' }).getByRole('button', { name: 'new/region 3 facilities' })).toBeVisible()
  await page.getByRole('button', { name: /Pump failure A\/pump/ }).click()
  await expect(page.getByRole('heading', { name: 'A/pump' })).toBeVisible()
  await page.getByRole('button', { name: 'Compare response plans' }).click()
  const lab = page.getByRole('dialog')
  await lab.getByRole('button', { name: 'Add job' }).click()
  await lab.getByRole('button', { name: 'Add job' }).click()
  await lab.getByLabel('Truck', { exact: true }).last().fill('1')
  await lab.getByRole('button', { name: 'Run simulation' }).click()
  await expect(lab.getByRole('alert')).toContainText('still assigned')
  await page.keyboard.press('Escape')
  await upload.setInputFiles(uploadFiles().slice(0, 1))
  await expect(page.getByRole('alert')).toContainText('Select exactly one ops.json')
  await expect(page.getByRole('heading', { name: 'A/pump' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('authorizes field enrollment, opens the assignment link, and syncs progress to control', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('snapshot_2026-10-10T0900')
  await expect(page.getByRole('heading', { name: 'S4_PUMP_A' })).toBeVisible()
  const breadcrumb = page.getByRole('navigation', { name: 'Network breadcrumb' })
  await expect(breadcrumb.getByRole('button', { name: 'S4_PUMP_A' })).toHaveAttribute('aria-current', 'location')
  await expect(page.getByRole('button', { name: 'Recorded timeline' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(768)
  expect((await page.request.get('/api/workflow')).status()).toBe(401)
  expect((await page.request.post('/api/nemotron', { data: {} })).status()).toBe(403)
  await breadcrumb.getByRole('button', { name: 'All systems' }).click()
  await page.getByRole('button', { name: 'List view' }).click()
  await page.getByRole('region', { name: 'Water network' }).getByRole('button', { name: 'S2 3 facilities' }).click()
  await expect(page.getByText('No active incidents in S2 · 3 elsewhere')).toBeVisible()
  await page.getByRole('button', { name: 'Go to priority' }).click()

  const workflow = page.locator('.workflow-fold')
  await workflow.locator(':scope > summary').click()
  await workflow.getByLabel('Control-room code').fill('playwright-control-code')
  await workflow.getByRole('button', { name: 'Sign in' }).click()
  await expect(workflow.getByRole('button', { name: 'Begin review' })).toBeVisible()
  expect((await page.request.post('/api/nemotron', { data: {} })).status()).toBe(503)
  await workflow.getByRole('button', { name: 'Begin review' }).click()
  const enrollment = workflow.getByText('Enroll a demo field device')
  await enrollment.click()
  async function enroll(role: 'foreman' | 'lease') {
    await workflow.getByLabel('Synthetic account').selectOption(role)
    await workflow.getByRole('button', { name: 'Create one-time code' }).click()
    const code = await workflow.locator('.field-invite code').textContent()
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const field = await context.newPage()
    await field.addInitScript(() => {
      let permission: NotificationPermission = 'default'
      Object.defineProperty(Notification, 'permission', { get: () => permission })
      Notification.requestPermission = async () => { permission = 'granted'; return permission }
      let current: { toJSON: () => object; unsubscribe: () => Promise<boolean> } | null = null
      Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { get: () => ({
        getSubscription: async () => current,
        subscribe: async () => {
          current = {
            toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/mock-browser-test', keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) } }),
            unsubscribe: async () => { current = null; return true },
          }
          return current
        },
      }) })
    })
    await field.goto('http://127.0.0.1:4173/field')
    await field.getByLabel('Field sign-in code').fill(code!)
    await field.getByRole('button', { name: 'Sign in' }).click()
    await expect(field.getByRole('heading', { name: 'My assignments' })).toBeVisible()
    return { context, field }
  }

  const foreman = await enroll('foreman')
  const lease = await enroll('lease')
  await expect(foreman.field.getByText('No approved assignments in your scope.')).toBeVisible()
  await foreman.field.locator('.field-notifications summary').click()
  await foreman.field.getByRole('button', { name: 'Enable notifications' }).click()
  await expect(foreman.field.getByRole('status')).toContainText('This device is registered')
  await foreman.field.getByRole('button', { name: 'Disable notifications' }).click()
  await expect(foreman.field.getByRole('status')).toContainText('Push is disabled')
  await workflow.getByLabel('Reason for confirmation').fill('Fault status and zero discharge were recorded.')
  await workflow.getByRole('button', { name: 'Confirm incident' }).click()
  await foreman.field.reload()
  await expect(foreman.field.getByText('No approved assignments in your scope.')).toBeVisible()
  await workflow.getByLabel('Field instructions').fill('Inspect this recorded fault.')
  await workflow.getByRole('button', { name: 'Approve and notify' }).click()
  await expect(workflow.getByText('Inbox only · no subscribed device')).toBeVisible({ timeout: 10000 })
  await foreman.field.reload()
  const link = foreman.field.getByRole('link').filter({ hasText: 'S4_FACILITY_A' })
  await expect(link).toBeVisible()
  const assignment = (await link.getAttribute('href'))!
  const assignmentApi = '/api/workflow/assignments/' + assignment.split('/').at(-1)
  expect((await lease.field.request.get(assignmentApi)).status()).toBe(404)
  await link.click()
  await expect(foreman.field.locator('.field-instructions').getByText('Inspect this recorded fault.', { exact: true })).toBeVisible()
  await expect(foreman.field.locator('.field-facts > p').filter({ hasText: 'Fault status and zero discharge were recorded.' })).toBeVisible()
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await foreman.field.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/field-assignment.png' })
  await foreman.field.getByRole('button', { name: 'Acknowledge' }).click()
  await foreman.field.getByRole('button', { name: 'Assign to lease operator' }).click()
  await lease.field.goto('http://127.0.0.1:4173' + assignment)
  await lease.field.getByRole('button', { name: 'Acknowledge' }).click()
  await lease.field.getByRole('button', { name: 'Start work' }).click()
  await lease.field.getByLabel('Work note').fill('Working through inspection.')
  await lease.field.getByRole('button', { name: 'Post progress update' }).click()
  await expect(lease.field.getByText('Workflow history · 8')).toBeVisible()
  await expect(workflow.getByText('In progress', { exact: true })).toBeVisible({ timeout: 10000 })
  await lease.field.getByLabel('Work note').fill('Inspection complete.')
  await lease.field.getByRole('button', { name: 'Mark resolved' }).click()
  await lease.field.reload()
  await expect(lease.field.getByText('Resolved', { exact: true })).toBeVisible()
  await expect(workflow.getByText('Resolved', { exact: true })).toBeVisible({ timeout: 10000 })
  expect(await lease.field.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await foreman.context.close()
  await lease.context.close()
})
test('shows the running-only degradation evidence and inspection response', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('snapshot_2026-10-08T1200')
  await page.getByRole('button', { name: /Pump degradation S3_PUMP_A/ }).click()
  const inspector = page.getByRole('complementary', { name: 'Asset inspector' })
  await expect(inspector.getByRole('img', { name: 'Discharge as % of rated flow during running samples' })).toBeVisible()
  await expect(inspector.getByText('Observed duration')).toBeVisible()
  await expect(inspector.getByRole('heading', { name: 'Field inspection' })).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'Compare response plans' })).toBeHidden()
})
