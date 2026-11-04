import { defineConfig } from "vite-plus";

import fmt from "./oxfmt.config";
import lint from "./oxlint.config";

export default defineConfig({
  fmt,
  lint,
  run: {
    cache: { scripts: false, tasks: true },
    tasks: {
      "check-files": { command: "vp check", cache: false },
      "check-browser": {
        command: "node scripts/check-demo-browser.mjs",
        dependsOn: ["@worksplit/react#compile", "@worksplit/split-view#compile"],
        cache: false,
      },
      "check-package-consumer": {
        command: "node scripts/check-package-consumer.mjs",
        dependsOn: ["@worksplit/split-view#compile", "@worksplit/react#compile"],
        cache: false,
      },
      "workspace:verify": {
        command: "node scripts/check-source-declarations.mjs",
        dependsOn: [
          "check-files",
          "workspace:build",
          "workspace:test",
          "workspace:types",
          "check-browser",
          "check-package-consumer",
        ],
        cache: false,
      },
      "workspace:build": {
        command: "node scripts/check-source-declarations.mjs",
        dependsOn: [
          "@worksplit/split-view#compile",
          "@worksplit/react#compile",
          "@worksplit/demo#compile",
        ],
        cache: false,
      },
      "workspace:test": {
        command: [],
        dependsOn: [
          "@worksplit/split-view#check-tests",
          "@worksplit/react#check-tests",
          "@worksplit/demo#check-tests",
        ],
      },
      "check-tools": {
        command: "tsc -p tsconfig.typecheck.json --noEmit",
        dependsOn: ["@worksplit/react#compile", "@worksplit/split-view#compile"],
        cache: false,
      },
      "workspace:types": {
        command: [],
        dependsOn: [
          "check-tools",
          "@worksplit/split-view#check-types",
          "@worksplit/react#check-types",
          "@worksplit/demo#check-types",
        ],
      },
    },
  },
});
