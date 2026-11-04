import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  resolve: { conditions: ["development"] },
  build: {
    outDir: "dist/public-api",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        publicApi: fileURLToPath(new URL("./public-api.html", import.meta.url)),
      },
    },
  },
});
