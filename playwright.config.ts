import { defineConfig, devices } from '@playwright/test'

const appPort = Number(process.env.E2E_APP_PORT || 3001)
const mockPort = Number(process.env.E2E_MOCK_PORT || 8409)
const baseURL = `http://127.0.0.1:${appPort}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node tests/e2e/mock-ersatztv.mjs',
      env: {
        MOCK_ERSATZTV_PORT: String(mockPort),
      },
      url: `http://127.0.0.1:${mockPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'node tests/e2e/start-app.mjs',
      env: {
        E2E_APP_PORT: String(appPort),
        E2E_MOCK_PORT: String(mockPort),
      },
      url: `${baseURL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
})
