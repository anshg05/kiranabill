// KB-101 / docs/07-DECISIONS.md D16: domain/ must never import from data/,
// providers/, or ui/ (docs/02-ARCHITECTURE.md section 10).
//
// KB-316 (docs/12-PARKED.md KI-36): every TypeScript file is linted - src/,
// netlify/, eval/, scripts/, vite.config.ts - with five of ESLint's own core
// correctness rules (owner decision: no new dependency, no style rules; they
// rarely fire, and never as noise).
//
// KB-307 (SG-10; owner, 3 Oct 2026): three TYPE-AWARE rules where async code
// can lose a bill - src/data, src/ui and netlify/. An un-awaited promise in
// finalise or sync is a write that silently never happened. Only these three;
// no style rules (docs/09-WORKING-AGREEMENT.md B6, 11-STACK-DECISIONS.md).

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

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
      // KB-308 (hard rule 9): no raw HTML anywhere - React text is escaped,
      // these three are not. Reading outerHTML (test messages) stays allowed.
      "no-restricted-syntax": [
        "error",
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "Hard rule 9: no raw HTML - render text with React." },
        { selector: "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]", message: "Hard rule 9: no raw HTML - render text with React." },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "Hard rule 9: no raw HTML - render text with React." },
      ],
      "no-debugger": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-else-if": "error",
      "no-self-assign": "error",
    },
  },
  {
    files: ["src/data/**/*.{ts,tsx}", "src/ui/**/*.{ts,tsx}", "netlify/**/*.{ts,mts}"],
    plugins: { "@typescript-eslint": tsPlugin },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
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
