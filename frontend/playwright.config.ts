import { defineConfig, devices } from '@playwright/test'

// The service worker only exists in production builds (`devOptions.enabled:
// false`), so the offline suite runs against the embedded Go binary, not the
// Vite dev server. `make e2e` builds it and provisions the database first.
const PORT = process.env.E2E_PORT ?? '8082'
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgres://aisleflow:aisleflow@localhost:5434/aisleflow_e2e?sslmode=disable'

export default defineConfig({
  testDir: './e2e',
  // Each spec owns the whole server-side list collection, and the offline
  // tests flip the browser context online/offline; running them in parallel
  // would have them tug at each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'line' : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: '../backend/server',
    url: `http://localhost:${PORT}/api/healthz`,
    env: { PORT, DATABASE_URL },
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  },
})
