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
        command: "playwright test",
        dependsOn: ["@worksplit/react#compile"],
        cache: false,
      },
      "check-package-consumer": {
        command: "node scripts/check-package-consumer.mjs",
        dependsOn: ["@worksplit/core#compile", "@worksplit/react#compile"],
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
          "@worksplit/core#compile",
          "@worksplit/react#compile",
          "@worksplit/demo#compile",
        ],
        cache: false,
      },
      "workspace:test": {
        command: [],
        dependsOn: ["@worksplit/core#check-tests", "@worksplit/react#check-tests"],
      },
      "check-tools": { command: "tsc -p tsconfig.typecheck.json --noEmit", cache: false },
      "workspace:types": {
        command: [],
        dependsOn: [
          "check-tools",
          "@worksplit/core#check-types",
          "@worksplit/react#check-types",
          "@worksplit/demo#check-types",
        ],
      },
    },
  },
});
