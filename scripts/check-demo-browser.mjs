import { checkDemoInteractions } from "./check-demo-interactions.mjs";
import { checkPublicApiBrowser } from "./check-public-api-browser.mjs";
import { checkWorkBenchBrowser } from "./check-workbench-browser.mjs";
await checkPublicApiBrowser({
  extra: async (page, context) => {
    await checkDemoInteractions(page, context);
    await checkWorkBenchBrowser(page, context);
  },
});
