import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@worksplit\/core$/,
        replacement: fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      },
      {
        find: /^@worksplit\/react$/,
        replacement: fileURLToPath(new URL("../react/src/index.ts", import.meta.url)),
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: process.env.PORT === undefined ? 5174 : Number(process.env.PORT),
    strictPort: true,
    allowedHosts: [".localhost"],
  },
  run: {
    tasks: {
      "dev:server": { command: "vp dev", cache: false },
      compile: {
        command: "vp build",
        dependsOn: ["check-types"],
        cache: {
          input: [
            { auto: true },
            { pattern: "../{core,react}/src/**", base: "package" },
            { pattern: "../../tsconfig.base.json", base: "package" },
          ],
          output: ["dist/**"],
        },
      },
      "check-types": {
        command: "tsc -p tsconfig.json --noEmit",
        dependsOn: ["@worksplit/core#compile", "@worksplit/react#compile"],
        cache: {
          input: [{ auto: true }, { pattern: "../../tsconfig.base.json", base: "package" }],
          output: [],
        },
      },
    },
  },
});
