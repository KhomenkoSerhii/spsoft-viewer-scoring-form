import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-spsoft',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 180_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'cross-env OHIF_OPEN=false yarn dev:viewer',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 360_000,
    },
    {
      command: 'yarn dev:host',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
