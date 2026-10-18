import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: "demo-documents",
      configureServer(server) {
        server.middlewares.use("/api/documents", (req, res) => {
          const url = new URL(req.url ?? "/", "http://localhost");
          const id = decodeURIComponent(url.pathname.slice(1));
          const delay = Math.min(5000, Math.max(0, Number(url.searchParams.get("delay") ?? 0)));
          setTimeout(() => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ id, text: `This is routed document ${id}.` }));
          }, delay);
        });
      },
    },
  ],
  run: {
    tasks: {
      "dev:server": { command: "vp dev --config vite.config.ts", cache: false },
      compile: {
        command: "vp build",
        dependsOn: ["@worksplit/react#compile"],
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
      "check-types": {
        command: "tsc -p tsconfig.json --noEmit",
        dependsOn: ["@worksplit/react#compile"],
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
    conditions: command === "serve" ? ["development"] : ["module", "browser", "production"],
  },
  server: { host: "127.0.0.1", port: Number(process.env.PORT ?? 5188), strictPort: true },
}));
