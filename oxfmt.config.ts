import type { OxfmtConfig } from "vite-plus/fmt";

export default {
  printWidth: 100,
  semi: true,
  singleQuote: false,
  sortImports: true,
  sortPackageJson: true,
  trailingComma: "all",
  ignorePatterns: ["node_modules", "dist", "coverage", "packages/*/dist", "**/*.tsbuildinfo"],
} satisfies OxfmtConfig;
