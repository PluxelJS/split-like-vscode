import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 100,
    semi: true,
    singleQuote: false,
    sortImports: true,
    sortPackageJson: true,
    trailingComma: "all",
    ignorePatterns: ["node_modules", "dist", "coverage", "**/*.tsbuildinfo"],
  },
  lint: {
    options: { typeAware: false, typeCheck: false, reportUnusedDisableDirectives: "error" },
    categories: { correctness: "error", perf: "error", suspicious: "error" },
    env: { browser: true, builtin: true, node: true },
    ignorePatterns: ["node_modules", "dist", "coverage", "**/*.tsbuildinfo"],
    plugins: ["import", "jsx-a11y", "promise", "react", "typescript", "vitest", "unicorn", "oxc"],
    rules: {
      // React Compiler adoption is separate from the tool migration. Keep the existing
      // Hooks checks while leaving newly enabled compiler diagnostics out of this policy.
      "react/exhaustive-effect-dependencies": "off",
      "react/globals": "off",
      "react/immutability": "off",
      "react/incompatible-library": "off",
      "react/memo-dependencies": "off",
      "react/no-deriving-state-in-effects": "off",
      "react/preserve-manual-memoization": "off",
      "react/purity": "off",
      "react/refs": "off",
      "react/set-state-in-effect": "off",
      "react/use-memo": "off",
      eqeqeq: "error",
      "import/no-named-export": "off",
      "import/no-unassigned-import": "off",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/prefer-tag-over-role": "off",
      "jsx-a11y/role-has-required-aria-props": "error",
      "no-console": "error",
      "prefer-const": "error",
      "react/jsx-key": "error",
      "react/react-in-jsx-scope": "off",
      "react/self-closing-comp": "error",
      "vitest/no-importing-vitest-globals": "off",
      "vitest/prefer-expect-assertions": "off",
    },
    settings: { react: { version: "19.3.0" } },
  },
  run: {
    cache: { scripts: false, tasks: true },
    tasks: {
      "workspace:build": {
        command: "node scripts/check-source-declarations.mjs",
        dependsOn: [
          "@worksplit/core#compile",
          "@worksplit/react#compile",
          "@worksplit/demo#compile",
        ],
        cache: false,
      },
      "workspace:test": {
        command: [],
        dependsOn: ["@worksplit/core#check-tests", "@worksplit/react#check-tests"],
      },
      "check-tools": { command: "tsc -p tsconfig.typecheck.json --noEmit", cache: false },
      "workspace:types": {
        command: [],
        dependsOn: [
          "check-tools",
          "@worksplit/core#check-types",
          "@worksplit/react#check-types",
          "@worksplit/demo#check-types",
        ],
      },
    },
  },
});
