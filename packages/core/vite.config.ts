import { defineConfig } from "vite-plus";

import packConfig from "./tsdown.config.mts";

export default defineConfig({
  pack: packConfig,
  run: {
    tasks: {
      compile: {
        command: "vp pack",
        cache: {
          input: [{ auto: true }, "../../tsconfig.base.json"],
          env: ["CI", "NODE_ENV"],
          output: ["dist/**"],
        },
      },
      "check-tests": {
        command: "vp test run",
        cache: {
          input: [{ auto: true }, "../../tsconfig.base.json"],
          env: ["CI", "NODE_ENV"],
          output: [],
        },
      },
      "check-types": {
        command: "tsc -p tsconfig.json --noEmit",
        cache: {
          input: [{ auto: true }, "../../tsconfig.base.json"],
          env: ["CI", "NODE_ENV"],
          output: [],
        },
      },
    },
  },
});
