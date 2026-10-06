import { defineConfig } from "playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

const evidenceDirectory = process.env.SILVER_GUIDE_QA_DIR ?? path.join(tmpdir(), "silver-guide-qa");
const port = process.env.SILVER_GUIDE_TEST_PORT ?? "4187";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.mjs",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["json", { outputFile: path.join(evidenceDirectory, "results.json") }]],
  outputDir: path.join(evidenceDirectory, "test-results"),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 900 },
    contextOptions: { reducedMotion: "reduce" },
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 10_000,
    env: { SILVER_GUIDE_TEST_PORT: port }
  }
});
