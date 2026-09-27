// KB-101 / docs/07-DECISIONS.md D16: domain/ must never import from data/,
// providers/, or ui/ (docs/02-ARCHITECTURE.md section 10).
//
// KB-316 (docs/12-PARKED.md KI-36): every TypeScript file is linted - src/,
// netlify/, eval/, scripts/, vite.config.ts - with five of ESLint's own core
// correctness rules (owner decision: no new dependency, no style rules; they
// rarely fire, and never as noise). A TypeScript-aware rule set is SG-10.

import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["legacy/**", "dist/**", "node_modules/**", "supabase/**", ".netlify/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "netlify/**/*.{ts,mts}", "eval/**/*.ts", "scripts/**/*.ts", "vite.config.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-debugger": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-else-if": "error",
      "no-self-assign": "error",
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/data/**", "**/providers/**", "**/ui/**"],
              message: "domain/ must never import from data/, providers/, or ui/ (docs/02-ARCHITECTURE.md section 10, docs/07-DECISIONS.md D16).",
            },
          ],
        },
      ],
    },
  },
];
