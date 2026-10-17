import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// KB-332 (D84): a screen that has been migrated to the catalog holds no English the shopkeeper reads. Two fixed lists: the
// files a checkpoint has migrated (Checkpoint A below; B adds its own), and the few literals that are meant to stay.

const MIGRATED = [
  "BillingScreen.tsx", "OfflineUi.tsx", "SignInScreen.tsx", "AddItemSheet.tsx", "ShareBar.tsx",
  // Checkpoint B
  "HistoryScreen.tsx", "CancelBillSheet.tsx", "CatalogScreen.tsx", "AddProductSheet.tsx", "EditProductSheet.tsx", "OnboardingScreen.tsx", "../app/App.tsx",
];
// Words that stay as they are in every language (brand, units, the owner's fixed phrases, symbols).
const STAYS = new Set(["KiranaBill", "Bill Banao", "Theek hai", "Cash", "WhatsApp", "PDF", "SMS", "REVIEW", "MEDIUM", "LOW", "HIGH", "Escape", "Enter", "Receipt", "Promise"]);

const stripExpressions = (s: string): string => {
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\{[^{}]*\}/g, " ");
  }
  return s;
};
const readableText = (src: string): string[] => {
  const out: string[] = [];
  for (const m of src.matchAll(/>([^<>]*[A-Za-z][^<>]*)</gs)) out.push(stripExpressions(m[1]!).replace(/\s+/g, " ").trim());
  for (const m of src.matchAll(/(?:aria-label|placeholder|title)="([^"]*[A-Za-z][^"]*)"/g)) out.push(m[1]!);
  return out.filter((s) => s && !STAYS.has(s));
};
const jsxOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// Text that is code, not words: generics, type annotations and expressions caught by the crude tag scan.
const looksLikeCode = (s: string) => /[=;()[\]|&]|\buse[A-Z]|=>|\bnew \w|^[a-z][\w.]*$/.test(s) || /^[^A-Za-z]*$/.test(s) || s.length < 2;

describe("no hard-coded English in a migrated screen", () => {
  for (const file of MIGRATED) {
    it(file, () => {
      const left = readableText(jsxOnly(readFileSync(join(__dirname, file), "utf8"))).filter((s) => !looksLikeCode(s));
      expect(left).toEqual([]);
    });
  }
});

describe("the choice never leaves this phone", () => {
  it("only screens read it - no data, sync, backup or receipt code mentions the screen language", () => {
    for (const f of ["data/sync.ts", "data/billMetrics.ts", "data/finalise.ts", "domain/receipt.ts", "domain/receiptText.ts", "domain/receiptLayout.ts", "ui/Receipt.tsx"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/screenLanguage|kb\.screenLanguage/);
    }
  });
});
