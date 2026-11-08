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
  await expect(page.getByRole('heading', { name: 'Water operations' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No active alerts' })).toBeVisible()
  const canvas = page.locator('.map-container canvas')
  await expect(canvas).toBeVisible({ timeout: 25000 })
  expect(await canvas.evaluate((element: HTMLCanvasElement) => Boolean(element.getContext('webgl2')))).toBe(true)
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/network.png' })
  await page.getByRole('button', { name: 'Start Demo' }).click()
  await page.getByRole('button', { name: 'Replay the lead-up' }).click()
  await expect(page.getByText('A pump has failed')).toBeVisible({ timeout: 12000 })
  await expect(page.getByText('Pump status reports fault (2).')).toBeVisible()
  await page.getByRole('button', { name: 'Show shared fleet pressure' }).click()
  await expect(page.getByText('Three failures are competing for one fleet')).toBeVisible({ timeout: 15000 })
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/incident.png' })
  await page.getByRole('button', { name: 'Compare responses' }).click()
  const lab = page.getByRole('dialog', { name: 'Decision Lab' })
  await expect(lab).toBeVisible()
  await expect(lab.getByText(/less than the manual response/)).toBeVisible()
  await expect(lab.getByText('Simulated · +0 min')).toBeVisible()
  await expect(lab.getByRole('img', { name: 'Manual schematic truck and tank playback' })).toBeVisible()
  const status = await page.request.get('/api/nemotron')
  expect(status.ok()).toBeTruthy()
  expect(typeof (await status.json()).configured).toBe('boolean')
  await lab.getByRole('button', { name: 'Play simulation' }).click()
  await expect(lab.getByText('Simulated · +0 min')).toBeHidden()
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/decision.png' })
  await page.keyboard.press('Escape')
  await expect(lab).toBeHidden()
  await page.getByRole('combobox', { name: 'DATA SOURCE' }).selectOption('mock_test_2026-10-10T1530')
  await expect(page.getByRole('button', { name: /Pump failure S5_PUMP_C/ })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(uploadFiles())
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
  await expect(page.getByRole('combobox', { name: 'DATA SOURCE' })).toHaveValue('Imported dataset')
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Water network' }).getByRole('button', { name: 'new/region 3 facilities' })).toBeVisible()
  await page.getByRole('button', { name: /Pump failure A\/pump/ }).click()
  await expect(page.getByRole('heading', { name: 'A/pump' })).toBeVisible()
  await page.getByRole('button', { name: 'Open Decision Lab' }).click()
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
