import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://miseshare:miseshare@127.0.0.1:54329/miseshare';
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: '.playwright/test-results',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: '.playwright/report', open: 'never' }]]
    : 'line',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: externalBaseURL ? undefined : {
    command: 'npm start',
    url: `${baseURL}/health/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      ADMIN_PASSWORD: 'playwright-admin-password',
      ADMIN_SESSION_SECRET: 'playwright-session-secret-with-at-least-32-bytes',
      EMOTES_ENABLED: 'false',
      RATE_LIMIT_ENABLED: 'false',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
