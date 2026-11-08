import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

test('rehearses official file import, all incident categories and an alternative without NVIDIA', async ({ page }) => {
  const upstream = existsSync('../.eog-reference') ? '../.eog-reference' : '.eog-reference'
  const folder = join(upstream, 'history', 'snapshot_2026-10-08T1200')
  // Only the three judging input files enter the application. No answer key.
  const files = ['network.json', 'ops.json', 'telemetry.csv'].map((name) => ({
    name, mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/json', buffer: readFileSync(join(folder, name)),
  }))
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(files)
  await expect(page.getByRole('combobox', { name: 'Dataset' })).toHaveValue('Imported dataset')
  const inspector = page.getByRole('complementary', { name: 'Asset inspector' })
  for (const [label, id] of [['Pump degradation', 'S3_PUMP_A'], ['Pipeline leak', 'S5_PIPELINE_B']]) {
    await page.getByRole('button', { name: new RegExp(label + ' ' + id) }).click()
    await expect(inspector.getByRole('heading', { name: 'Field inspection' })).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Compare response plans' })).toHaveCount(0)
  }
  await page.getByRole('button', { name: /Pump failure S2_PUMP_B/ }).click()
  await page.getByRole('button', { name: 'Compare response plans' }).click()
  const lab = page.getByRole('main', { name: 'Decision Lab' })
  await lab.getByRole('button', { name: 'Add job' }).click()
  await lab.getByRole('button', { name: 'Run simulation' }).click()
  await expect(lab.locator('.branch-choice.operator')).toHaveAttribute('aria-pressed', 'true')
  await expect(lab.getByRole('region', { name: 'Decision consequences' })).toContainText('modeled repair horizon')
  await lab.locator('.consequence-review > details > summary').click()
  await expect(lab.getByRole('region', { name: 'Decision consequences' })).toContainText('Lost production:')
  await expect(lab.getByRole('button', { name: 'Use this plan for approval' })).toBeEnabled()
  expect((await (await page.request.get('/api/nemotron')).json()).configured).toBe(false)
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/judging-import.png' })
})
