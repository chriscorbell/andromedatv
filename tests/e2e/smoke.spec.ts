import { expect, test } from '@playwright/test'

test('homepage loads and expanded schedule details are visible', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('img', { name: 'andromeda' })).toBeVisible()
  await expect(page.getByText('schedule')).toBeVisible()

  const angelCopButton = page.getByRole('button', { name: /angel cop/i })
  await expect(angelCopButton).toBeVisible()
  await angelCopButton.click()

  await expect(page.getByText('S01E02 The Beginning')).toBeVisible()
  await expect(page.getByText('Pilot & more')).toBeVisible()
})

test('chat register flow works and user can sign out again', async ({ page }, testInfo) => {
  await page.goto('/')

  const nickname = `smoke${Date.now().toString().slice(-6)}${testInfo.retry}`

  await page.getByRole('button', { name: /need an account\? create one/i }).click()
  await page.getByLabel('Username').fill(nickname)
  await page.getByLabel('Password').fill('hunter2')
  await page.getByRole('button', { name: 'create account' }).click()

  await expect(page.getByText(/signed in as/i)).toContainText(nickname)
  await expect(page.getByRole('button', { name: 'sign out' })).toBeVisible()

  await page.getByRole('button', { name: 'sign out' }).click()

  await expect(page.getByRole('button', { name: 'sign in' })).toBeVisible()
})

test('admin can open and close the admin menu dialog', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Username').fill('andromedatv')
  await page.getByLabel('Password').fill('supersecret')
  await page.getByRole('button', { name: 'sign in' }).click()

  await expect(page.getByText(/signed in as/i)).toContainText('andromedatv')

  await page.getByRole('button', { name: 'Open admin menu' }).click()

  const dialog = page.getByRole('dialog', { name: 'admin' })
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
