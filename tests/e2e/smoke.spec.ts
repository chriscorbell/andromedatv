import { expect, test } from '@playwright/test'

test('homepage loads and expanded schedule details are visible', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('img', { name: 'andromeda' })).toBeVisible()
  await expect(page.getByText('schedule', { exact: true })).toBeVisible()

  const acceptanceSeriesButton = page.getByRole('button', {
    name: /acceptance series.*live/i,
  })
  await expect(acceptanceSeriesButton).toBeVisible()
  await acceptanceSeriesButton.click()

  await expect(
    page.locator('.schedule-details[data-expanded="true"]').getByText('episode-01'),
  ).toBeVisible()
})

test('internal playback acceptance uses the generated schedule and HLS route', async ({
  page,
  request,
}) => {
  const hlsResponsePromise = page.waitForResponse((response) => {
    return (
      response.url().includes('/iptv/session/1/hls.m3u8') &&
      response.status() === 200
    )
  })

  await page.goto('/')

  const liveAcceptanceSeriesButton = page.getByRole('button', {
    name: /acceptance series.*live/i,
  })
  await expect(liveAcceptanceSeriesButton).toBeVisible()
  await liveAcceptanceSeriesButton.click()
  await expect(
    page.locator('.schedule-details[data-expanded="true"]').getByText('episode-01'),
  ).toBeVisible()

  const hlsResponse = await hlsResponsePromise
  expect(hlsResponse.headers()['content-type']).toMatch(/mpegurl/)

  const statusResponse = await request.get('/api/status')
  expect(statusResponse.ok()).toBe(true)
  const status = await statusResponse.json()
  expect(status.internalSchedule.configured).toBe(true)
  expect(status.internalSchedule.seriesAllowlist).toEqual(['Acceptance Series'])
  expect(status.internalPlayout.activeAssetTitle).toBe('episode-01')
  expect(status.iptv.lastProxyRequestPath).toBeNull()

  const completedEpisode = await request.post('/__e2e/complete-playout')
  expect(completedEpisode.ok()).toBe(true)
  await expect
    .poll(async () => {
      const response = await request.get('/api/schedule')
      const payload = await response.json()
      return payload.schedule[0]?.episode
    })
    .toBe('episode-02')

  await page.reload()
  await expect(page.getByText('01-bump')).toBeHidden()
  await expect(
    page.locator('.schedule-row').filter({ hasText: 'Acceptance Series' }).first(),
  ).toBeVisible()

  const bumpHlsResponse = await request.get('/iptv/session/1/hls.m3u8')
  expect(bumpHlsResponse.ok()).toBe(true)
  expect(bumpHlsResponse.headers()['content-type']).toMatch(/mpegurl/)

  const completedBump = await request.post('/__e2e/complete-playout')
  expect(completedBump.ok()).toBe(true)
  await expect
    .poll(async () => {
      const response = await request.get('/api/schedule')
      const payload = await response.json()
      return payload.schedule[0]?.live
    })
    .toBe(true)

  await page.reload()
  const nextEpisodeButton = page.getByRole('button', {
    name: /acceptance series.*live/i,
  })
  await expect(nextEpisodeButton).toBeVisible()
  await nextEpisodeButton.click()
  await expect(
    page.locator('.schedule-details[data-expanded="true"]').getByText('episode-02'),
  ).toBeVisible()
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
