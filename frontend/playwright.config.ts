import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: '../reports/playwright-report.json' }]],
  webServer: [
    {
      command: 'npm run build && node --experimental-sqlite dist/index.js',
      cwd: '../backend',
      env: {
        NODE_ENV: 'development',
        PORT: '3001',
        DB_PATH: './data/e2e-dashboard.db',
        SESSION_SECRET: 'ci-session-secret-minimum-32-chars',
        ENCRYPTION_KEY: 'swami-dashboard-local-key-123456',
        JIRA_API_TOKEN_ID: ''
      },
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 120_000
    }
  ],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});