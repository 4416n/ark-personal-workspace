import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: process.env.ARK_TEST_BASE_URL || "http://127.0.0.1:5174",
    headless: true,
    viewport: { width: 1440, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.ARK_TEST_BASE_URL
    ? undefined
    : {
        command: "node server/index.mjs --production",
        env: { ARK_LEGACY: "1", PORT: "5174" },
        url: "http://127.0.0.1:5174",
        reuseExistingServer: false,
        timeout: 30000,
      },
});
