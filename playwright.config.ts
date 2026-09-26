import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false, // Run sequentially for CRM database and storage consistency
  forbidOnly: !!process.env.CI,
  retries: 0, // Do not mask flaky bugs or intermittent failures
  workers: 1, // Single worker avoids localStorage collision between CRM tests
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ['json', { outputFile: 'playwright-report/test-results.json' }]
  ],
  use: {
    baseURL: 'http://localhost:5173/billing/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: 'chromium-mobile',
      testMatch: /.*mobile.*\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
  webServer: {
    command: 'npx vite --port 5173',
    url: 'http://localhost:5173/billing/',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
