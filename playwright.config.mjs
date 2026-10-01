import { defineConfig } from '@playwright/test';
import { browserSettings } from './tests/helpers/browser-test-config.mjs';

const { baseURL } = browserSettings();
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: {
    command: 'node tests/helpers/browser-test-server.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
