// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { ParsedItem } from "@/domain/grammar";
import { parseTranscript } from "@/data/voiceApi";
import { useBillLines } from "./useBillLines";
import { useOrderResolver, type OrderResolver, type UtteranceReport } from "./useOrderResolver";

// KB-404 (D80): every utterance that reaches the resolver is REPORTED once - the path that produced its lines (the fast
// path or Layer 2), or 'failed' when nothing reached the bill - with transcript -> items-on-screen in whole ms. The report
// is a write-only sink: the lines on the bill are the same with or without a listener (a metric never changes a bill).

afterEach(cleanup);

const catalog = SEED_PARSER_CATALOG.entries;
const MISS = "2 kuch naya"; // Layer 1 parses it but matches no product -> Gemini (Layer 2)
const HIT = "2 kilo chini"; // Layer 1 hit - never calls /voice
const naya: ParsedItem = { spokenName: "kuch naya", catalogId: null, isCustom: true, matchStatus: "none", qty: 2, unit: "", rate: null, rateUnit: null, total: null, priceType: "unknown" };
const ok = () => new Response(JSON.stringify({ transcript: MISS, items: [naya] }), { status: 200 });
const status = (code: number) => new Response(JSON.stringify({ error: "x" }), { status: code });

function setup(fetchMock: ReturnType<typeof vi.fn>, onUtterance?: (r: UtteranceReport) => void) {
  const api: MutableRefObject<{ resolver: OrderResolver; rows: () => number } | null> = { current: null };
  function Harness() {
    const bill = useBillLines(catalog);
    const resolver = useOrderResolver({
      shop: SEED_PARSER_CATALOG,
      bill,
      parse: (text, catalogSlice) => parseTranscript(text, { accessToken: "jwt", catalogSlice, fetchImpl: fetchMock as unknown as typeof fetch }),
      onUtterance,
    });
    api.current = { resolver, rows: () => bill.rows.length };
    return null;
  }
  render(<Harness />);
  return api;
}
const say = async (api: ReturnType<typeof setup>, t: string) => {
  let err: unknown = null;
  await act(async () => {
    await api.current!.resolver.onTranscript(t).catch((e: unknown) => (err = e));
  });
  return err;
};

describe("onUtterance", () => {
  it("a fast-path hit: path 'fastpath', the billed lines, whole-ms transcript -> items; /voice is never called", async () => {
    const fetchMock = vi.fn();
    const reports: UtteranceReport[] = [];
    const api = setup(fetchMock, (r) => reports.push(r));
    await say(api, HIT);
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reports[0]).toMatchObject({ path: "fastpath", transcript: HIT });
    expect(reports[0]!.lines).toEqual([{ name: "Chini", qty: 2, unit: "kg", rate: 4500, total: 9000 }]);
    expect(Number.isInteger(reports[0]!.transcriptToItemsMs)).toBe(true);
    expect(reports[0]!.transcriptToItemsMs).toBeGreaterThanOrEqual(0);
  });

  it("a Layer 2 success: path 'voice'", async () => {
    const reports: UtteranceReport[] = [];
    const api = setup(vi.fn().mockResolvedValueOnce(ok()), (r) => reports.push(r));
    await say(api, MISS);
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({ path: "voice", transcript: MISS });
    expect(reports[0]!.lines).toHaveLength(1);
    expect(reports[0]!.transcriptToItemsMs).not.toBeNull();
  });

  it("a retryable failure (502): path 'failed', no lines, no items time - and it is reported once, not again on Retry", async () => {
    const reports: UtteranceReport[] = [];
    const fetchMock = vi.fn().mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok());
    const api = setup(fetchMock, (r) => reports.push(r));
    await say(api, MISS);
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({ path: "failed", lines: [], transcriptToItemsMs: null });
    expect(api.current!.rows()).toBe(0);
  });

  it("a non-retryable failure (401) is 'failed' too; a transcript that yields no item is 'failed'", async () => {
    const reports: UtteranceReport[] = [];
    const nothing = { ...naya, qty: null };
    const fetchMock = vi.fn().mockResolvedValueOnce(status(401)).mockResolvedValueOnce(new Response(JSON.stringify({ items: [nothing] }), { status: 200 }));
    const api = setup(fetchMock, (r) => reports.push(r));
    await say(api, MISS);
    await say(api, "3 aur kuch");
    await waitFor(() => expect(reports).toHaveLength(2));
    expect(reports.map((r) => r.path)).toEqual(["failed", "failed"]);
  });

  it("a metric never changes a bill: the same lines with and without a listener, and a throwing listener changes nothing", async () => {
    const without = setup(vi.fn(), undefined);
    await say(without, HIT);
    const rowsWithout = without.current!.rows();
    cleanup();
    const throwing = setup(vi.fn(), () => {
      throw new Error("boom");
    });
    const err = await say(throwing, HIT);
    expect(err).toBeNull();
    expect(throwing.current!.rows()).toBe(rowsWithout);
  });
});
