import { describe, expect, it, vi } from "vitest";
import { REMOVE_BATCH, runCleanup, secretMatches, type CleanupDeps } from "./cleanup";

// KB-384a step 5 (owner, 9 Nov 2026; D105, D107): the 7-day deletion runs INSIDE Supabase. Files go through the Storage API (a SQL
// delete would leave the file itself behind); a row goes only after its file is gone, so a failed removal is retried the next day.

const due = (n: number, withRow = true) => Array.from({ length: n }, (_, i) => ({ recording_id: withRow ? `rec-${i}` : null, path: `shop/rec-${i}` }));

function deps(over: Partial<CleanupDeps> = {}) {
  return {
    due: vi.fn(async () => due(3)),
    removeFiles: vi.fn(async (_paths: string[]) => undefined),
    deleteRows: vi.fn(async (_ids: string[]) => undefined),
    ...over,
  } satisfies CleanupDeps;
}

describe("runCleanup", () => {
  it("removes every due file through Storage, then deletes those rows", async () => {
    const d = deps();
    expect(await runCleanup(d)).toEqual({ files: 3, rows: 3, failedBatches: 0 });
    expect(d.removeFiles).toHaveBeenCalledWith(["shop/rec-0", "shop/rec-1", "shop/rec-2"]);
    expect(d.deleteRows).toHaveBeenCalledWith(["rec-0", "rec-1", "rec-2"]);
    expect(d.removeFiles.mock.invocationCallOrder[0]!).toBeLessThan(d.deleteRows.mock.invocationCallOrder[0]!);
  });

  it("a file with NO row (left after a restore) is removed; there is no row to delete", async () => {
    const d = deps({ due: vi.fn(async () => due(2, false)) });
    expect(await runCleanup(d)).toEqual({ files: 2, rows: 0, failedBatches: 0 });
    expect(d.deleteRows).not.toHaveBeenCalled();
  });

  it(`batches of ${REMOVE_BATCH}; a batch Storage refuses keeps its rows (tried again tomorrow), the others go on`, async () => {
    expect(REMOVE_BATCH).toBe(100);
    let call = 0;
    const d = deps({
      due: vi.fn(async () => due(250)),
      removeFiles: vi.fn(async (_paths: string[]) => {
        if (call++ === 1) throw new Error("storage down");
      }),
    });
    expect(await runCleanup(d)).toEqual({ files: 150, rows: 150, failedBatches: 1 });
    expect(d.removeFiles).toHaveBeenCalledTimes(3);
    const deleted = d.deleteRows.mock.calls.flatMap((c) => c[0]);
    expect(deleted).toHaveLength(150);
    expect(deleted).not.toContain("rec-100"); // the refused batch's rows stay
  });

  it("nothing due: nothing is called", async () => {
    const d = deps({ due: vi.fn(async () => []) });
    expect(await runCleanup(d)).toEqual({ files: 0, rows: 0, failedBatches: 0 });
    expect(d.removeFiles).not.toHaveBeenCalled();
  });
});

describe("secretMatches - the daily call carries only the shared secret", () => {
  it("no secret configured: never open; a wrong or missing header: refused; the right one: accepted", () => {
    expect(secretMatches("anything", undefined)).toBe(false);
    expect(secretMatches("anything", "")).toBe(false);
    expect(secretMatches(null, "s3cret-value-123456")).toBe(false);
    expect(secretMatches("s3cret-value-12345X", "s3cret-value-123456")).toBe(false);
    expect(secretMatches("short", "s3cret-value-123456")).toBe(false);
    expect(secretMatches("s3cret-value-123456", "s3cret-value-123456")).toBe(true);
  });
});
