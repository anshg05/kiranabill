import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * A drift test (money.test.ts) proves integer addition is safe, but it can't
 * catch someone reintroducing float money math later - e.g. writing
 * `Math.round(x * 100) / 100` to "round to 2 decimals" the way you would for
 * a plain float, which is exactly the bug integer paise exists to prevent
 * (docs/07-DECISIONS.md D11).
 *
 * This statically scans money.ts's source text (comments and string/template
 * literals stripped first, since those legitimately contain "/" in doc paths
 * and "₹" formatting) for the division operator and `parseFloat`. Neither
 * should ever appear in this file - every money computation here is done
 * with integer multiplication and string-digit slicing instead (see
 * roundMilliPaiseHalfUp and formatRupees in money.ts).
 */

const moneySourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "money.ts");

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments (incl. JSDoc)
    .replace(/\/\/.*$/gm, "") // line comments
    .replace(/`(?:[^`\\]|\\.)*`/g, "``") // template literals
    .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''"); // single-quoted strings
}

describe("money.ts has no float-money escape hatches", () => {
  const code = stripCommentsAndStrings(readFileSync(moneySourcePath, "utf8"));

  it("never uses the division operator", () => {
    expect(code.includes("/")).toBe(false);
  });

  it("never calls parseFloat", () => {
    expect(code.includes("parseFloat")).toBe(false);
  });

  it("sanity: the strip actually removed something (this file does have comments)", () => {
    const raw = readFileSync(moneySourcePath, "utf8");
    expect(code.length).toBeLessThan(raw.length);
  });
});
