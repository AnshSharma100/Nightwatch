import { expect, test } from '@playwright/test'

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
