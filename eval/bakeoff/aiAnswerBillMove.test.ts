import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiAnswerBill } from "../../src/domain/aiAnswerBill";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog";
import type { ParsedItem } from "../../src/domain/grammar";
import { checksOf, warnedLinesOf } from "../acceptance/compare";
import { nocatBill } from "./pipeline";

// KB-384a step 4 (owner, 9 Nov 2026): the AI answer's bill chain (our price fill, the checks, the totals) moves from eval/ into
// src/domain so the PHONE builds the same bill the replay measures. The fingerprint of every one of the 85 saved V3 answers' bills was
// recorded from the eval code BEFORE the move; the domain function must give exactly the same lines and checks.

const saved = JSON.parse(readFileSync(path.join(__dirname, "results-v2-2026-11-09.json"), "utf8")) as { results: { candidate: string; id: string; run: number; transcript: string | null; items: ParsedItem[] | null }[] };
const runs = saved.results.filter((r) => r.candidate === "nocat-v2" && r.items && r.transcript !== null);
const fingerprint = (bill: { lines: readonly unknown[]; checks: number; warnedLines?: readonly number[] }) =>
  createHash("sha256").update(JSON.stringify({ lines: bill.lines, checks: bill.checks, warned: bill.warnedLines ?? [] })).digest("hex").slice(0, 16);

describe("the AI answer's bill chain moved to src/domain - identical bills on all 85 saved V3 answers", () => {
  it("the eval chain's bills (recorded before the move)", () => {
    expect(runs).toHaveLength(85);
    expect(Object.fromEntries(runs.map((r) => [`${r.id} run ${r.run}`, fingerprint(nocatBill(r.transcript!, r.items!, SEED_PARSER_CATALOG))]))).toMatchSnapshot();
  });

  it("src/domain's aiAnswerBill gives exactly those bills", () => {
    const domain = Object.fromEntries(
      runs.map((r) => {
        const { lines, flags } = aiAnswerBill(r.transcript!, r.items!, SEED_PARSER_CATALOG);
        return [`${r.id} run ${r.run}`, fingerprint({ lines, checks: checksOf(flags, lines.length), warnedLines: lines.length ? warnedLinesOf(flags, lines.length) : [] })];
      }),
    );
    expect(domain).toEqual(Object.fromEntries(runs.map((r) => [`${r.id} run ${r.run}`, fingerprint(nocatBill(r.transcript!, r.items!, SEED_PARSER_CATALOG))])));
  });
});
