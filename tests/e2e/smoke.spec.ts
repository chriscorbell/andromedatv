import { expect, test } from '@playwright/test'

test('homepage loads and expanded schedule details are visible', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('img', { name: 'andromeda' })).toBeVisible()
  await expect(page.getByText('schedule', { exact: true })).toBeVisible()

  const angelCopButton = page.getByRole('button', { name: /angel cop/i })
  await expect(angelCopButton).toBeVisible()
  await angelCopButton.click()

  await expect(page.getByText('S01E02 – The Beginning')).toBeVisible()
  await expect(page.getByText('Pilot & more')).toBeVisible()
})

test('fallback schedule remains usable while schedule refresh is offline', async ({ page }) => {
  await page.route('**/api/schedule', async (route) => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Failed to load schedule' }),
    })
  })

  await page.goto('/')

  await expect(
    page.getByRole('alert').filter({ hasText: 'Schedule unavailable' }),
  ).toBeVisible()

  const angelCopButton = page.getByRole('button', { name: /angel cop/i })
  await angelCopButton.click()

  await expect(angelCopButton).toHaveAttribute('aria-expanded', 'true')
})

test('chat register flow works and user can log out again', async ({ page }, testInfo) => {
  await page.goto('/')

  const nickname = `smoke${Date.now().toString().slice(-6)}${testInfo.retry}`

  await page.getByRole('button', { name: 'create account' }).click()
  await page.getByLabel('Username').fill(nickname)
  await page.getByLabel('Password').fill('hunter2')
  await page.locator('form button[type="submit"]').click()

  await expect(page.getByText(/logged in as/i)).toContainText(nickname)
  await expect(page.getByRole('button', { name: 'Log Out' })).toBeVisible()

  await page.getByRole('button', { name: 'Log Out' }).click()

  await expect(page.getByRole('button', { name: 'log in' })).toBeVisible()
})

test('admin can open and close the admin menu dialog', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'log in' }).click()
  await page.getByLabel('Username').fill('andromedatv')
  await page.getByLabel('Password').fill('supersecret')
  await page.locator('form button[type="submit"]').click()

  await expect(page.getByText(/logged in as/i)).toContainText('andromedatv')

  await page.getByRole('button', { name: 'Open admin menu' }).click()

  const dialog = page.getByRole('dialog', { name: /admin/i })
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
