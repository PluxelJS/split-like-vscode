import { defineConfig } from "vite-plus";

export default defineConfig({
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
    dts: { sourcemap: true },
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
            { pattern: "../../tsconfig.base.json", base: "package" },
            { pattern: "../../mise.toml", base: "package" },
            { pattern: "mise.toml", base: "workspace" },
          ],
          env: ["CI", "NODE_ENV"],
          output: ["dist/**"],
        },
      },
      "check-tests": {
        command: "vp test run --maxWorkers=2",
        cache: {
          input: [
            { auto: true },
            { pattern: "../../tsconfig.base.json", base: "package" },
            { pattern: "../../mise.toml", base: "package" },
            { pattern: "mise.toml", base: "workspace" },
          ],
          env: ["CI", "NODE_ENV"],
          output: [],
        },
      },
      "check-types": {
        command: "tsc -p tsconfig.json --noEmit",
        cache: {
          input: [
            { auto: true },
            { pattern: "../../tsconfig.base.json", base: "package" },
            { pattern: "../../mise.toml", base: "package" },
            { pattern: "mise.toml", base: "workspace" },
          ],
          env: ["CI", "NODE_ENV"],
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
