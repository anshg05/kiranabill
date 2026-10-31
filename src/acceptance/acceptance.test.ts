import { describe, expect, it } from "vitest";
import { CATEGORIES, TOTAL_ORDERS, slots } from "./categories";
import { blobToBase64, buildSessionFile, extensionFor, parseSessionFile } from "./sessionFile";

// KB-364: the coverage list, and the file the phone exports for the PC.

describe("the coverage list", () => {
  it("is 62 orders: the ten groups of 30 Oct, plus the twelve long orders of KB-370 (31 Oct)", () => {
    expect(TOTAL_ORDERS).toBe(62);
    expect(CATEGORIES.map((c) => c.id)).toEqual([
      "short-priced", "short-priceless", "long-priced", "long-priceless", "mixed", "number-words", "units-fractions", "repeated", "unclear-words", "unreadable-price", "long-30-90s",
    ]);
  });
  it("gives every slot a stable id A01..A62, in category order, with its position in the group", () => {
    const all = slots();
    expect(all).toHaveLength(62);
    expect(all[0]).toEqual({ id: "A01", category: "short-priced", nth: 1 });
    expect(all[6]).toEqual({ id: "A07", category: "short-priceless", nth: 1 });
    expect(all[49]).toEqual({ id: "A50", category: "unreadable-price", nth: 4 });
    // KB-370: the long orders come AFTER the first 50, so A01-A50 keep their ids (the recordings and the sheet use them)
    expect(all[50]).toEqual({ id: "A51", category: "long-30-90s", nth: 1 });
    expect(all[61]).toEqual({ id: "A62", category: "long-30-90s", nth: 12 });
    expect(new Set(all.map((s) => s.id)).size).toBe(62);
  });
});

describe("the session file", () => {
  const clip = (id: string) => ({ id, category: "mixed", mime: "audio/webm;codecs=opus", durationMs: 4100, audioBase64: "AAAA" });

  it("round-trips, clips sorted by id", () => {
    const file = buildSessionFile([clip("A12"), clip("A03")], "ua", new Date("2026-10-30T10:00:00Z"));
    expect(file.clips.map((c) => c.id)).toEqual(["A03", "A12"]);
    expect(parseSessionFile(JSON.stringify(file))).toEqual(file);
  });
  it.each([
    ["not JSON", "{oops"],
    ["wrong version", JSON.stringify({ version: 2, clips: [] })],
    ["a bad id", JSON.stringify({ version: 1, clips: [{ ...clip("B1") }] })],
    ["a duplicate id", JSON.stringify({ version: 1, clips: [clip("A01"), clip("A01")] })],
    ["not audio", JSON.stringify({ version: 1, clips: [{ ...clip("A01"), mime: "text/plain" }] })],
    ["an empty clip", JSON.stringify({ version: 1, clips: [{ ...clip("A01"), audioBase64: "" }] })],
  ])("refuses %s - nothing is half-imported", (_label, text) => {
    expect(() => parseSessionFile(text)).toThrow();
  });
  it("names the file extension from the recorded type", () => {
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/ogg")).toBe("ogg");
    expect(extensionFor("audio/x-unknown")).toBe("bin");
  });
  it("turns audio into base64 that decodes back to the same bytes", async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251); // longer than one 0x8000 chunk
    const b64 = await blobToBase64(new Blob([bytes]));
    expect(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});
