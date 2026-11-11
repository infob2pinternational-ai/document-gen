import { defineConfig, devices } from '@playwright/test';

// Browser tests for the Field Sales screens.
//
//   npx playwright test --config playwright.field-sales.config.ts --trace off
//
// The app is started with a Supabase URL that does not exist
// (http://127.0.0.1:54399). Every request to it is intercepted in the test and
// answered from an in-memory Postgres that has the live-shaped schema and the
// field-sales migrations applied (tests/helpers/field-sales-http.mjs). Nothing
// here can reach Supabase or any other remote service.
export default defineConfig({
  testDir: './tests',
  testMatch: /field-sales.*\.e2e\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5183/billing/',
    trace: 'off',
    // The app's service worker would send requests from outside the page, where the test cannot answer them.
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN'
  },
  projects: [
    { name: 'phone', testMatch: /field-sales-salesperson\.e2e\.ts/, use: { ...devices['Pixel 5'] } },
    { name: 'desktop', testMatch: /field-sales-office\.e2e\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } } }
  ],
  webServer: {
    command: 'npx vite --port 5183 --strictPort',
    url: 'http://localhost:5183/billing/',
    reuseExistingServer: false,
    timeout: 120000,
    env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54399', VITE_SUPABASE_ANON_KEY: 'test-anon-key' }
  }
});
