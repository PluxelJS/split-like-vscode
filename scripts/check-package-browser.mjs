import { join, resolve } from "node:path";

import { checkDemoInteractions } from "./check-demo-interactions.mjs";
import { checkPublicApiBrowser } from "./check-public-api-browser.mjs";
import { checkWorkBenchBrowser } from "./check-workbench-browser.mjs";

/** The same real examples and browser assertions run from installed public tarballs. */
export function checkPackageBrowser(consumer) {
  return checkPublicApiBrowser({
    consumer,
    extra: async (page, context) => {
      await checkDemoInteractions(page, context);
      await checkWorkBenchBrowser(page, context);
    },
    configFile: join(consumer, "vite.config.ts"),
    entry: "/",
    build: false,
    reportFile: resolve(
      import.meta.dirname,
      "../test-results/packed-consumer/browser-results.json",
    ),
  });
}
