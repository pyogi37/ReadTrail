// Playwright configuration for the extension e2e harness. Runs the unpacked
// extension in a persistent Chromium context; see tests/e2e/helpers.mjs.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.mjs$/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
