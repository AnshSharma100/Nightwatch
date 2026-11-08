import { expect, test } from '@playwright/test'
import { fixture } from '../tests/fixture.ts'

test('AI questions and suggestions remain usable before signing in', async ({ page }) => {
  // This checks interaction and authorization guidance with a controlled status fixture.
  // It does not claim a real NVIDIA inference request.
  await page.route('**/api/nemotron', (route) => route.fulfill({ json: { configured: true, authorized: false } }))
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('snapshot_2026-10-10T0900')
  const investigator = page.locator('#asset-inspector .investigator')
  await investigator.locator(':scope > summary').click()
  const question = investigator.getByRole('textbox', { name: 'Investigation question' })
  await question.fill('Why is this facility at risk?')
  await expect(question).toHaveValue('Why is this facility at risk?')
  await investigator.getByRole('button', { name: 'Test two trucks here' }).click()
  await expect(question).toHaveValue(/Compare sending both trucks to S4_FACILITY_A/)
  await investigator.getByRole('button', { name: 'Draft field briefing', exact: true }).click()
  await expect(question).toHaveValue(/Draft a field briefing/)
  await expect(investigator.getByRole('button', { name: 'Investigate with Nemotron' })).toBeDisabled()
  await investigator.locator(':scope > summary').click()
  await investigator.locator(':scope > summary').click()
  await expect(question).toHaveValue(/Draft a field briefing/)
  await investigator.getByRole('button', { name: 'Open Control room' }).click()
  await expect(page.locator('.control-account').getByLabel('Control-room code')).toBeFocused()
})

test('recording updates preserve the investigator and label the actual investigation time', async ({ page }) => {
  let investigatedAt: number | undefined
  expect((await page.request.post('/api/session', { data: { code: 'playwright-control-code' } })).ok()).toBeTruthy()
  await page.route('**/api/nemotron', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, authorized: true } })
    investigatedAt = route.request().postDataJSON().at
    await route.fulfill({ json: { summary: 'Controlled test response from the frozen recording.', trace: [] } })
  })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('snapshot_2026-10-10T0900')
  const investigator = page.locator('#asset-inspector .investigator')
  await investigator.locator(':scope > summary').click()
  const question = investigator.getByRole('textbox', { name: 'Investigation question' })
  await question.fill('Keep this question while the recording changes.')
  await question.evaluate((element) => element.setAttribute('data-original-control', 'yes'))
  await investigator.getByRole('button', { name: 'Investigate with Nemotron' }).click()
  await expect(investigator.getByText('Controlled test response from the frozen recording.')).toBeVisible()
  expect(investigatedAt).toBeGreaterThan(0)

  const disclosure = page.locator('.timeline-disclosure')
  if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click()
  const timestamp = page.getByRole('slider', { name: 'Recorded timestamp' })
  await timestamp.focus()
  const snapshot = page.waitForResponse((response) => response.url().includes('/snapshot?at=') && response.ok())
  await timestamp.press('ArrowLeft')
  await snapshot
  await expect(question).toHaveValue('Keep this question while the recording changes.')
  await expect(question).toHaveAttribute('data-original-control', 'yes')
  await expect(investigator.getByText('Controlled test response from the frozen recording.')).toBeVisible()
  await expect(investigator.locator('.investigator-snapshot')).toContainText('Replay has moved')
})

test('a different recording with the same asset IDs clears the previous investigation', async ({ page }) => {
  await page.route('**/api/nemotron', (route) => route.fulfill({ json: { configured: false, authorized: false } }))
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Dataset' })).toBeEnabled()
  const files = (extraFill: number) => {
    const { network, ops, csv } = fixture((asset, metric, _step, value) => {
      if (asset === 'A/pump' && metric === 'status') return 2
      if (metric === 'level_pct') return value + extraFill
      return value
    })
    return [
      { name: 'network.json', mimeType: 'application/json', buffer: Buffer.from(network) },
      { name: 'ops.json', mimeType: 'application/json', buffer: Buffer.from(ops) },
      { name: 'telemetry.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) },
    ]
  }
  await page.locator('input[type=file]').setInputFiles(files(0))
  await expect(page.getByRole('heading', { name: 'A/pump' })).toBeVisible()
  const investigator = page.locator('#asset-inspector .investigator')
  await investigator.locator(':scope > summary').click()
  await investigator.getByRole('textbox', { name: 'Investigation question' }).fill('This belongs to the first recording.')
  const imported = page.waitForResponse((response) => response.url().endsWith('/api/datasets/import') && response.request().method() === 'POST' && response.ok())
  await page.locator('input[type=file]').setInputFiles(files(2))
  await imported
  await expect(investigator).not.toHaveAttribute('open', '')
  await investigator.locator(':scope > summary').click()
  await expect(investigator.getByRole('textbox', { name: 'Investigation question' })).toHaveValue('')
})
