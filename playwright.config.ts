import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./packages/demo/tests",
  workers: 1,
  timeout: 30000,
  reporter: [["list"], ["json", { outputFile: "refactor/acceptance/browser-results.json" }]],
  use: {
    baseURL: process.env.WORKSPLIT_URL ?? "http://127.0.0.1:5188",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @worksplit/demo dev --port 5188 --strictPort",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: true,
  },
});
