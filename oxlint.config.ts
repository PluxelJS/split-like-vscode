import type { OxlintConfig } from "vite-plus/lint";

export default {
  options: { reportUnusedDisableDirectives: "error" },
  categories: {
    correctness: "error",
    perf: "error",
    suspicious: "error",
  },
  env: {
    browser: true,
    builtin: true,
    node: true,
  },
  ignorePatterns: ["node_modules", "dist", "coverage", "packages/*/dist", "**/*.tsbuildinfo"],
  plugins: ["import", "jsx-a11y", "promise", "react", "typescript", "vitest", "unicorn", "oxc"],
  rules: {
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
  settings: {
    react: {
      version: "19.3.0",
    },
  },
} satisfies OxlintConfig;
