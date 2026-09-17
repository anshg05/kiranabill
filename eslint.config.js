// KB-101 / docs/07-DECISIONS.md D16. Enforces exactly one rule: domain/
// must never import from data/, providers/, or ui/ (docs/02-ARCHITECTURE.md
// section 10). No formatting/style rules, no other correctness rules -
// this exists solely to catch what manual review could miss on a day
// things move fast, now that Phase 1 is putting real code into folders
// that were empty (and therefore safe to import from accidentally) during
// Phase 0.

import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/domain/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
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
