import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./packages/demo/tests",
  workers: 1,
  timeout: 30000,
  reporter: [["list"], ["json", { outputFile: "test-results/browser-results.json" }]],
  use: {
    ...(process.env.PLAYWRIGHT_WS_ENDPOINT
      ? {
          connectOptions: {
            wsEndpoint: process.env.PLAYWRIGHT_WS_ENDPOINT,
            exposeNetwork: "<loopback>",
          },
        }
      : {}),
    baseURL: process.env.WORKSPLIT_URL ?? "http://127.0.0.1:5188",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  ...(process.env.WORKSPLIT_URL
    ? {}
    : {
        webServer: {
          command: "vp run @worksplit/demo#dev:server --port 5188 --strictPort",
          url: "http://127.0.0.1:5188",
          reuseExistingServer: false,
        },
      }),
});
