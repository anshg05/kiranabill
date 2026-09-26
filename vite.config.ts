import { defineConfig } from "vite";
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
          exclude: [...configDefaults.exclude, "**/*.perf.test.ts"],
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
    ],
  },
});
