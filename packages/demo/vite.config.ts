import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
  resolve: {
    conditions: command === "serve" ? ["development"] : ["module", "browser", "production"],
  },
  server: { host: "0.0.0.0", port: 5188, strictPort: true },
}));
