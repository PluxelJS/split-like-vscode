import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./packages/demo/tests",
  workers: 1,
  timeout: 30000,
  reporter: [["list"], ["json", { outputFile: "test-results/browser-results.json" }]],
  use: {
    baseURL: process.env.WORKSPLIT_URL ?? "http://127.0.0.1:5188",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: process.env.WORKSPLIT_URL
    ? undefined
    : {
        command: "vp run @worksplit/demo#dev:server --port 5188 --strictPort",
        url: "http://127.0.0.1:5188",
        reuseExistingServer: false,
      },
});
