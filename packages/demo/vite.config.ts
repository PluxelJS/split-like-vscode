import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig(({ command }) => ({
  test: {
    include: ["src/examples/editor-store.test.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
  },
  plugins: [react()],
  run: {
    tasks: {
      "dev:server": { command: "vp dev --config vite.config.ts", cache: false },
      compile: {
        command: "vp build",
        dependsOn: ["@worksplit/react#compile", "@worksplit/split-view#compile"],
        cache: {
          input: [
            { auto: true },
            { pattern: "../../tsconfig.base.json", base: "package" },
            { pattern: "../../mise.toml", base: "package" },
            { pattern: "mise.toml", base: "workspace" },
          ],
          output: ["dist/**"],
        },
      },
      "check-tests": { command: "vp test run --maxWorkers=1 --no-file-parallelism", cache: false },
      "check-types": {
        command: "tsc -p tsconfig.json --noEmit",
        dependsOn: ["@worksplit/react#compile", "@worksplit/split-view#compile"],
        cache: {
          input: [
            { auto: true },
            { pattern: "../../tsconfig.base.json", base: "package" },
            { pattern: "../../mise.toml", base: "package" },
            { pattern: "mise.toml", base: "workspace" },
          ],
          output: [],
        },
      },
    },
  },
  resolve: {
    // Embedded workspace installs must share the demo's React and provider contexts.
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-hotkeys"],
    conditions: command === "serve" ? ["development"] : ["module", "browser", "production"],
  },
  server: { host: "127.0.0.1", port: Number(process.env.PORT ?? 5188), strictPort: true },
}));
