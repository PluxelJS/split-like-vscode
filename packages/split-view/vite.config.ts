import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

function resolvePackageRoot(packageName: string) {
  return dirname(require.resolve(packageName));
}

const reactRoot = resolvePackageRoot("react");
const reactDomRoot = resolvePackageRoot("react-dom");

import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    minify: true,
    entry: {
      index: "src/index.ts",
      style: "src/style.css",
    },
    outDir: "dist",
    format: "esm",
    platform: "neutral",
    target: "esnext",
    clean: true,
    dts: { sourcemap: true },
    sourcemap: true,
    shims: false,
    css: {
      fileName: "style.css",
      minify: true,
    },
    deps: {
      neverBundle: ["react", "react/jsx-runtime", "react-dom"],
    },
    exports: {
      customExports(exports, { isPublish }) {
        exports["./style.css"] = isPublish ? "./dist/style.css" : "./src/style.css";
        return exports;
      },
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
        command: "vp test run --maxWorkers=1 --no-file-parallelism",
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
    alias: [
      { find: /^react$/, replacement: reactRoot },
      { find: /^react\/(.*)$/, replacement: `${reactRoot}/$1` },
      { find: /^react-dom$/, replacement: reactDomRoot },
      { find: /^react-dom\/(.*)$/, replacement: `${reactDomRoot}/$1` },
    ],
    conditions: ["development"],
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
  },
});
