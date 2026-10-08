import { defineConfig } from "pncat";

export default defineConfig({
  saveExact: false,
  depFields: { peerDependencies: false },
  catalogRules: [
    {
      name: "frontend",
      match: ["react", "react-dom", "@types/react", "@types/react-dom", "lucide-react"],
      priority: 20,
    },
    { name: "test", match: ["@testing-library/react", "vitest"], priority: 20 },
    { name: "dev", match: ["jsdom"], priority: 20 },
    {
      name: "tooling",
      match: [
        "@tsdown/css",
        "@types/node",
        "@vitejs/plugin-react",
        "oxfmt",
        "oxlint",
        "pncat",
        "tsdown",
        "turbo",
        "typescript",
        "vite",
      ],
      priority: 10,
    },
  ],
});
