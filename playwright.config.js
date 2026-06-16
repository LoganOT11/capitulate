// Imported from `playwright/test` (provided by the globally-installed Playwright)
// rather than `@playwright/test`, so no local test-runner install is needed.
const { defineConfig, devices } = require('playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'node server.js',
    port: 8080,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
