import { expect, test } from '@playwright/test'

test('slow forecast responses keep the workspace steady and preserve the AI form', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('snapshot_2026-10-10T0900')
  await expect(page.getByRole('heading', { name: 'S4_PUMP_A' })).toBeVisible()
  await page.getByRole('button', { name: 'Recorded timeline' }).click()
  const slider = page.getByRole('slider', { name: 'Recorded timestamp' })
  const max = Number(await slider.getAttribute('max'))
  const response = page.waitForResponse((value) => value.url().includes('/snapshot?at=') && value.ok())
  await slider.fill(String(max - 2))
  await response
  const investigator = page.locator('#asset-inspector .investigator')
  await investigator.locator(':scope > summary').click()
  const question = investigator.getByRole('textbox', { name: 'Investigation question' })
  await question.fill('Do not erase this question during playback.')
  await question.evaluate((element) => element.setAttribute('data-preserved', 'true'))
  await page.route('**/snapshot?at=*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700))
    await route.continue()
  })
  await page.getByRole('combobox', { name: 'Recorded playback speed' }).selectOption('250')
  await page.getByRole('button', { name: 'Play historical playback' }).click()
  const samples = await page.evaluate(async () => {
    const samples: { top: number; height: number; footer: number; count: number; risk: boolean }[] = []
    for (let i = 0; i < 55; i++) {
      const scene = document.querySelector('.operator-stage')!.getBoundingClientRect()
      samples.push({ top: scene.top, height: scene.height, footer: document.querySelector('.operator-timeline')!.getBoundingClientRect().top,
        count: document.querySelectorAll('[data-preserved="true"]').length,
        risk: !document.querySelector('.ops-strip')!.textContent!.includes('Loading') })
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return samples
  })
  expect(samples.every((sample) => sample.count === 1 && sample.risk)).toBe(true)
  for (const key of ['top', 'height', 'footer'] as const) {
    expect(Math.max(...samples.map((sample) => sample[key])) - Math.min(...samples.map((sample) => sample[key]))).toBeLessThanOrEqual(1)
  }
  await expect(slider).toHaveValue(String(max))
  await expect(page.getByRole('button', { name: 'Play historical playback' })).toBeVisible()
  await expect(question).toHaveValue('Do not erase this question during playback.')
  await expect(question).toHaveAttribute('data-preserved', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(768)
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/steady-operations.png' })
})

test('recorded replay leaves reading time and pauses when an operator works', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Dataset' }).selectOption('snapshot_2026-10-10T0900')
  await expect(page.getByRole('heading', { name: 'S4_PUMP_A' })).toBeVisible()
  await page.getByRole('button', { name: 'Recorded timeline' }).click()
  const slider = page.getByRole('slider', { name: 'Recorded timestamp' })
  const start = Number(await slider.getAttribute('max')) - 2
  const response = page.waitForResponse((value) => value.url().includes('/snapshot?at=') && value.ok())
  await slider.fill(String(start))
  await response
  await page.clock.pauseAt(new Date('2026-11-08T13:00:00Z'))
  await page.getByRole('button', { name: 'Play historical playback' }).click()
  await page.clock.runFor(3000)
  await expect(slider).toHaveValue(String(start))
  await page.locator('#asset-inspector .investigator > summary').click()
  const question = page.getByRole('textbox', { name: 'Investigation question' })
  await question.fill('Give me time to investigate.')
  await expect(page.getByRole('button', { name: 'Play historical playback' })).toBeVisible()
  await page.clock.runFor(6000)
  await expect(slider).toHaveValue(String(start))
  await expect(question).toHaveValue('Give me time to investigate.')
})
