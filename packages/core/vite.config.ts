import { defineConfig } from "vite-plus";

const config: ReturnType<typeof defineConfig> = defineConfig({
  pack: {
    minify: true,
    entry: {
      index: "src/index.ts",
    },
    outDir: "dist",
    format: "esm",
    platform: "neutral",
    target: "esnext",
    clean: true,
    dts: true,
    sourcemap: true,
    shims: false,
    exports: {
      devExports: "development",
    },
  },
  run: {
    tasks: {
      compile: {
        command: "vp pack",
        cache: {
          input: [
            { auto: true },
            { pattern: "!**/node_modules/.vite/**", base: "workspace" },
            { pattern: "!**/node_modules/.vitest-cache/**", base: "workspace" },
            { pattern: "../../tsconfig.base.json", base: "package" },
          ],
          output: ["dist/**"],
        },
      },
      "check-tests": {
        command: "vp test run --maxWorkers=2",
        cache: {
          input: [
            { auto: true },
            { pattern: "!**/node_modules/.vite/**", base: "workspace" },
            { pattern: "!**/node_modules/.vitest-cache/**", base: "workspace" },
            { pattern: "../../tsconfig.base.json", base: "package" },
          ],
          output: [],
        },
      },
      "check-types": {
        command: "tsc -p tsconfig.json --noEmit",
        cache: {
          input: [
            { auto: true },
            { pattern: "!**/node_modules/.vite/**", base: "workspace" },
            { pattern: "!**/node_modules/.vitest-cache/**", base: "workspace" },
            { pattern: "../../tsconfig.base.json", base: "package" },
          ],
          output: [],
        },
      },
    },
  },
  root: import.meta.dirname,
  resolve: {
    conditions: ["development"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});

export default config;
