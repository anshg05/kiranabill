import { defineConfig, loadEnv } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  test: {
    globals: true,
    environment: "node",
    // docs/07-DECISIONS.md D35: perf tests run alone, after every other test
    // file. sequence.groupOrder runs groups one after another (each awaited
    // in turn), so "perf" never shares the CPU with "unit" - and it still
    // runs when "unit" has failures (failures are reported, not thrown).
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...configDefaults.exclude, "**/*.perf.test.ts", "**/*.e2e.test.ts"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "perf",
          include: ["**/*.perf.test.ts"],
          sequence: { groupOrder: 1 },
        },
      },
      // KB-110b: real local-Docker-stack tests (D21, D32 - call the shipped
      // code path). NOT part of `npm test` (which runs only unit + perf, so it
      // never needs Docker); run with `npm run test:e2e`. Required for any
      // sync or schema ticket. Only VITE_-prefixed values are loaded, and each
      // e2e file refuses to run against anything but 127.0.0.1/localhost.
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["**/*.e2e.test.ts"],
          env: loadEnv("test", process.cwd(), "VITE_"),
          testTimeout: 60_000,
          hookTimeout: 60_000,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
