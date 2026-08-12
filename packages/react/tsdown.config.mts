import { defineConfig } from "tsdown";

const config: ReturnType<typeof defineConfig> = defineConfig({
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
  dts: true,
  sourcemap: true,
  shims: false,
  css: {
    fileName: "style.css",
    minify: true,
  },
  deps: {
    neverBundle: ["react", "react/jsx-runtime", "react-dom", "@worksplit/core"],
  },
  exports: {
    customExports(exports, { isPublish }) {
      exports["./style.css"] = isPublish ? "./dist/style.css" : "./src/style.css";
      return exports;
    },
    devExports: "development",
  },
});

export default config;
