// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalLearningEvent, type LocalShopProduct } from "@/data/db";
import { CatalogScreen } from "./CatalogScreen";

// KB-321 (owner, 17 Oct 2026): the Catalog's "most used first" - counted from this shop's own bills of the last 30 days -
// and KB-323 (D81): "Learned names" - every phrase the app has learned, the product it maps to, how sure it is, and one
// tap to remove it.

const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;
const product = (p: Partial<LocalShopProduct> & Pick<LocalShopProduct, "displayName">): LocalShopProduct => ({
  id: p.displayName.toLowerCase(), shopId, baseProductId: null, category: null, unit: "kg", pricePaise: 4_000, aliases: [p.displayName],
  source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...p,
});
let n = 0;
const confirm = (alias: string, productId: string, layer = "fastpath"): LocalLearningEvent => ({
  localId: `e${n++}`, shopId, syncStatus: "synced", billLocalId: "", eventType: "alias_confirmed", payload: { alias, shop_product_id: productId, source_layer: layer },
  createdAt: new Date(Date.now() - 1000 * (50 - n)).toISOString(), updatedAt: new Date().toISOString(), deviceId: "d",
});
async function bill(localId: string, productIds: string[]) {
  const at = new Date().toISOString();
  await db.bills.add({ localId, serverId: `s-${localId}`, shopId, status: "final", syncStatus: "synced", receiptNumber: localId, receiptNumberSource: "block", customerName: "Cash", customerMobile: null, subtotalPaise: 0, totalPaise: 0, schemaVersion: 1, deviceId: "d", createdAt: at, finalizedAt: at, syncedAt: null });
  await db.billItems.bulkAdd(productIds.map((p, i) => ({ billLocalId: localId, shopId, lineNo: i + 1, shopProductId: p, displayName: p, spokenName: p, qty: 1, unit: "kg", ratePaise: 100, rateUnit: "kg", totalPaise: 100, priceType: "rate" as const, source: "fastpath" as const, reviewFlags: [], wasEdited: false })));
}
const noop = async () => ({ ok: true as const });

beforeEach(async () => {
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => true);
  db = new KiranaBillDB(`ui-cat-learned-${crypto.randomUUID()}`);
  await db.shopProducts.bulkPut([product({ displayName: "Alpha" }), product({ displayName: "Beta" }), product({ displayName: "Gamma" })]);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

async function open(removeAlias?: (alias: string, productId: string) => Promise<void>, onChanged = vi.fn()) {
  render(<CatalogScreen localDb={db} shopId={shopId} save={noop} add={noop} removeAlias={removeAlias} onChanged={onChanged} onClose={() => {}} />);
  await screen.findByRole("list", { name: "Products" });
  return { onChanged };
}
const names = () => within(screen.getByRole("list", { name: "Products" })).getAllByRole("listitem").map((r) => within(r).getByTestId("name").textContent);

describe("KB-321: most used first", () => {
  it("products are ordered by the bills of the last 30 days (then name), and say how often", async () => {
    await bill("b1", ["gamma", "beta"]);
    await bill("b2", ["gamma"]);
    await bill("b3", ["gamma", "beta"]);
    await open();
    expect(names()).toEqual(["Gamma", "Beta", "Alpha"]);
    const list = within(screen.getByRole("list", { name: "Products" }));
    expect(list.getByText("Used 3 times in the last 30 days")).toBeTruthy();
    expect(list.getByText("Used 2 times in the last 30 days")).toBeTruthy();
    expect(list.getByText("Not used yet")).toBeTruthy();
  });
  it("with no bills it is the old order: by name", async () => {
    await open();
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
  });
});

describe("KB-323: Learned names", () => {
  it("lists each learned phrase with its product and how sure the app is; 'in use' only from 0.8", async () => {
    await db.learningEvents.bulkAdd([confirm("pale ji", "alpha"), confirm("pale ji", "alpha"), confirm("pale ji", "alpha"), confirm("bhoora", "beta")]);
    await open(async () => {});
    const section = screen.getByRole("region", { name: "Learned names" });
    const items = within(section).getAllByRole("listitem").map((li) => li.textContent);
    expect(items.some((t) => t!.includes("pale ji") && t!.includes("Alpha") && t!.includes("In use"))).toBe(true);
    expect(items.some((t) => t!.includes("bhoora") && t!.includes("Beta") && t!.includes("Still learning"))).toBe(true);
  });

  it("no section when nothing is learned, and no Remove button when no writer is given", async () => {
    await open();
    expect(screen.queryByRole("region", { name: "Learned names" })).toBeNull();
    await db.learningEvents.bulkAdd([confirm("pale ji", "alpha")]);
    cleanup();
    await open();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("Remove forgets one phrase: the writer is called, the list reloads without it, and billing is told", async () => {
    await db.learningEvents.bulkAdd([confirm("pale ji", "alpha"), confirm("pale ji", "alpha"), confirm("pale ji", "alpha")]);
    const removeAlias = vi.fn(async (alias: string, productId: string) => {
      await db.learningEvents.add({ ...confirm(alias, productId), localId: "rm", eventType: "alias_removed" });
    });
    const { onChanged } = await open(removeAlias);
    fireEvent.click(screen.getByRole("button", { name: "Remove “pale ji” (Alpha)" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Learned names" })).toBeNull());
    expect(removeAlias).toHaveBeenCalledWith("pale ji", "alpha");
    expect(onChanged).toHaveBeenCalled();
  });
});
