import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:3001'

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
      url: 'http://127.0.0.1:8409/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'node tests/e2e/start-app.mjs',
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
