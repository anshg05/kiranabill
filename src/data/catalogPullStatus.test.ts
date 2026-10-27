import { describe, expect, it, vi } from "vitest";
import { noteCatalogPulled, subscribeCatalogPulled } from "./catalogPullStatus";

// KB-350: a sync pull that changed the catalog tells the billing screen (per shop database, by name).
describe("catalogPullStatus", () => {
  it("tells only the listeners of that database, and stops after unsubscribe", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeCatalogPulled("db-a", a);
    subscribeCatalogPulled("db-b", b);
    noteCatalogPulled("db-a");
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 0]);
    offA();
    noteCatalogPulled("db-a");
    expect(a.mock.calls.length).toBe(1);
  });
});
