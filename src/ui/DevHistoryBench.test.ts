import { afterEach, describe, expect, it, vi } from "vitest";
import { benchId } from "./DevHistoryBench";

// KB-310 (owner, 7 Oct 2026): the dev-only phone bench is opened over plain
// http://<laptop-ip>:5173 - not a secure context, where Chrome hides
// crypto.randomUUID (the phone failed with "crypto.randomUUID is not a
// function"). Its ids come from crypto.getRandomValues, which works there.

afterEach(() => vi.unstubAllGlobals());

describe("DevHistoryBench - ids without a secure context", () => {
  it("benchId works with crypto.randomUUID absent: UUID-shaped (v4) and distinct", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    expect((globalThis.crypto as Crypto & { randomUUID?: unknown }).randomUUID).toBeUndefined();
    const ids = Array.from({ length: 1000 }, benchId);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(1000);
  });
});
