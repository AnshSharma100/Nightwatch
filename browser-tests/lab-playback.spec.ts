import { expect, test } from '@playwright/test'
import { fixture } from '../tests/fixture.ts'
import type { PlanComparison } from '../packages/contracts/operations.ts'

const snapshot = '/decision-lab?recording=practice-snapshot_2026-10-10T0900&system=S4&at=' + Date.parse('2026-10-10T09:00:00Z') / 1000

for (const kind of ['well stops', 'repeat trips'] as const) {
  test('copies recommended ' + kind + ' exactly and recalculates identical operator outcomes', async ({ page }) => {
    let route = snapshot
    if (kind === 'repeat trips') {
      const source = fixture((id, metric, _step, value) => id === 'A/pump' && metric === 'status' ? 2 : value)
      const ops = JSON.parse(source.ops)
      ops.expected_repair_hours.pump_failure = 6
      const imported = await page.request.post('/api/datasets/import', { data: {
        network: source.network, ops: JSON.stringify(ops), telemetry: source.csv,
      } })
      expect(imported.ok()).toBeTruthy()
      const recording = await imported.json()
      route = '/decision-lab?recording=' + recording.id + '&system=' + encodeURIComponent('new/region') + '&at=' + recording.latest.at
    }
    const originalRequest = page.waitForResponse((response) => response.url().endsWith('/compare') && response.ok())
    await page.goto(route)
    const original = await (await originalRequest).json() as PlanComparison
    const expected = original.search.best
    if (kind === 'well stops') expect(expected.plan.shutIns.length).toBeGreaterThan(0)
    else expect(expected.plan.jobs.some((job) => job.trips > 1)).toBe(true)
    const lab = page.getByRole('main', { name: 'Decision Lab' })
    // Overwrite an existing draft rather than appending recommended jobs to it.
    await lab.getByRole('button', { name: 'Add job' }).click()
    await lab.getByRole('button', { name: 'Add job' }).click()
    const copiedRequest = page.waitForResponse((response) => response.url().endsWith('/compare') && response.ok())
    await lab.getByRole('button', { name: 'Copy to operator plan' }).click()
    const copiedResponse = await copiedRequest
    expect(copiedResponse.request().postDataJSON().plan).toEqual(expected.plan)
    const copied = await copiedResponse.json() as PlanComparison
    expect(copied.operator).toEqual(expected)
    await expect(lab.locator('.branch-choice.operator')).toHaveAttribute('aria-pressed', 'true')
    await expect(lab.getByText('Operator and recommended plans tie', { exact: true })).toBeVisible()
    await expect(lab.getByRole('button', { name: 'Play simulation' })).toBeVisible()
    await expect(lab.getByRole('slider', { name: 'Simulated minutes after decision' })).toHaveValue('0')
    const trips = lab.getByLabel('Trips', { exact: true })
    await expect(trips).toHaveCount(expected.plan.jobs.length)
    for (let i = 0; i < expected.plan.jobs.length; i++) await expect(trips.nth(i)).toHaveValue(String(expected.plan.jobs[i].trips))
    await expect(lab.getByLabel('Well', { exact: true })).toHaveCount(expected.plan.shutIns.length)
    if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/copy-' + kind.replace(' ', '-') + '.png' })
  })
}

test('Butterfly Effect waits for decisions, advances at a readable speed, and pauses for editing', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-08T12:00:00Z') })
  await page.goto(snapshot)
  const lab = page.getByRole('main', { name: 'Decision Lab' })
  await expect(lab.getByRole('heading', { name: 'Butterfly Effect' })).toBeVisible()
  const playhead = lab.getByRole('slider', { name: 'Simulated minutes after decision' })
  const play = lab.getByRole('button', { name: 'Play simulation' })
  await expect(play).toBeVisible()
  await expect(playhead).toHaveValue('0')
  await page.clock.pauseAt(new Date('2026-11-08T13:00:00Z'))
  await page.clock.fastForward(3000)
  await expect(playhead).toHaveValue('0')
  const bounds = await lab.locator('.lab-stage').boundingBox()

  await play.click()
  // Advance one timer tick per second without rendering every WebGL frame on
  // software-only CI runners. The real-time scene regression is separate.
  await page.clock.fastForward(1000)
  await expect(playhead).toHaveValue('1')
  await page.clock.fastForward(1000)
  await expect(playhead).toHaveValue('2')
  expect(await lab.locator('.lab-stage').boundingBox()).toEqual(bounds)
  await lab.getByRole('button', { name: 'No action', exact: false }).click()
  await expect(play).toBeVisible()
  await page.clock.fastForward(2000)
  await expect(playhead).toHaveValue('2')

  await lab.getByRole('button', { name: 'Next simulation event' }).click()
  expect(Number(await playhead.inputValue())).toBeGreaterThan(2)
  await expect(lab.locator('.lab-playback-note')).toContainText('reaches automatic shut-in')
  await expect(play).toBeVisible()
  await lab.getByRole('button', { name: 'Restart simulation playback' }).click()
  await expect(playhead).toHaveValue('0')

  await lab.getByRole('combobox', { name: 'Simulation playback speed' }).selectOption('5')
  await play.click()
  await page.clock.fastForward(1000)
  await expect(playhead).toHaveValue('5')
  await page.clock.fastForward(1000)
  await expect(playhead).toHaveValue('10')
  await lab.getByRole('button', { name: 'Add job' }).click()
  await expect(play).toBeVisible()
  await page.clock.fastForward(2000)
  await expect(playhead).toHaveValue('10')
  await lab.getByRole('button', { name: 'Run simulation' }).click()
  await expect(lab.getByRole('button', { name: /Operator plan Your simulated intervention/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(playhead).toHaveValue('0')
  await expect(play).toBeVisible()
  await page.clock.fastForward(3000)
  await expect(playhead).toHaveValue('0')
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/butterfly-controls.png' })
})

test('Butterfly Effect controls stay usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto(snapshot)
  const lab = page.getByRole('main', { name: 'Decision Lab' })
  await expect(lab.getByRole('heading', { name: 'Butterfly Effect' })).toBeVisible()
  const footer = lab.locator('footer[aria-label="Simulated timeline"]')
  await expect(footer.getByRole('button', { name: 'Play simulation' })).toBeInViewport()
  await expect(footer.getByRole('button', { name: 'Next simulation event' })).toBeInViewport()
  await expect(footer.getByRole('combobox', { name: 'Simulation playback speed' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375)
  const initial = await footer.boundingBox()
  await footer.getByRole('button', { name: 'Next simulation event' }).click()
  expect(await footer.boundingBox()).toEqual(initial)
  if (process.env.NIGHTWATCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.NIGHTWATCH_SCREENSHOT_DIR + '/butterfly-phone.png' })
})
