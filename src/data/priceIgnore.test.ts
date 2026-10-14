import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KiranaBillDB, type LocalLearningEvent, type LocalShopProduct } from "./db";
import { PRICE_SUGGESTION_IGNORE_MS } from "@/domain/learning";
import {
  PRICE_IGNORE_EVENT,
  ignorePriceSuggestionFor,
  listIgnoredPriceSuggestions,
  listPendingPriceSuggestions,
  resetLearning,
} from "./learningAudit";

// KB-329 (D78, owner decision 21): [Ignore] on a price suggestion. The ignore is an APPEND-ONLY learning event
// (`price_suggestion_ignored`, payload { shopProductId, ignoredUntil }) - saved locally, pushed and pulled like other
// learning state. The effective ignore of a product is the LATEST ignoredUntil among the shop's events; every ignore is
// "tap + 90 days", so that is last-write-wins by tap time (D74) without an updatable row. It never changes a price.

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-14T06:00:00.000Z");
const SHOP = "shop-1";

let db: KiranaBillDB;
beforeEach(() => {
  db = new KiranaBillDB(`test-price-ignore-${crypto.randomUUID()}`);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

async function observe(shopId: string, productId: string, pricePaise: number, count: number, atMs: number) {
  for (let i = 0; i < count; i++) {
    await db.priceObservations.add({
      localId: `${shopId}-${productId}-${pricePaise}-${atMs}-${i}`, shopId, syncStatus: "synced", shopProductId: productId,
      observedPricePaise: pricePaise, occurredAt: new Date(atMs - i * 1000).toISOString(), updatedAt: new Date(atMs).toISOString(), deviceId: "d1",
    });
  }
}
const ids = async (nowMs: number, shopId = SHOP) => (await listPendingPriceSuggestions(db, shopId, nowMs)).map((s) => s.catalogId).sort();
const ignoreEvents = (shopId = SHOP) => db.learningEvents.where("shopId").equals(shopId).filter((e) => e.eventType === PRICE_IGNORE_EVENT).toArray();

describe("ignorePriceSuggestionFor", () => {
  it("hides that product's suggestion and only that product's", async () => {
    await observe(SHOP, "p1", 5500, 3, NOW);
    await observe(SHOP, "p2", 9100, 3, NOW);
    expect(await ids(NOW)).toEqual(["p1", "p2"]);
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-a", NOW);
    expect(await ids(NOW)).toEqual(["p2"]);
  });

  it("writes ONE pending learning event: type, product, ignoredUntil = tap + 90 days, no bill, this device", async () => {
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-a", NOW);
    const [event] = await ignoreEvents();
    expect(PRICE_SUGGESTION_IGNORE_MS).toBe(90 * DAY);
    expect(event).toMatchObject<Partial<LocalLearningEvent>>({
      shopId: SHOP, syncStatus: "pending", billLocalId: "", eventType: "price_suggestion_ignored", deviceId: "dev-a", createdAt: new Date(NOW).toISOString(),
      payload: { shopProductId: "p1", ignoredUntil: new Date(NOW + 90 * DAY).toISOString() },
    });
    expect(await ignoreEvents()).toHaveLength(1);
  });

  it("never changes a price (hard rule 7) - the shop's product row is untouched", async () => {
    const product: LocalShopProduct = {
      id: "p1", shopId: SHOP, baseProductId: null, displayName: "Besan", category: null, unit: "kg", pricePaise: 9000, aliases: [],
      source: "custom", useCount: 0, sku: null, barcode: null, isActive: true,
    };
    await db.shopProducts.put(product);
    await observe(SHOP, "p1", 9500, 3, NOW);
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-a", NOW);
    expect(await db.shopProducts.get("p1")).toEqual(product);
  });

  it("holds for 90 days: still hidden at day 89 even with fresh observations; back at day 91 when 3 fresh ones exist", async () => {
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-a", NOW);
    await observe(SHOP, "p1", 5500, 3, NOW + 89 * DAY);
    expect(await ids(NOW + 89 * DAY)).toEqual([]);
    await observe(SHOP, "p1", 5500, 3, NOW + 91 * DAY);
    expect(await ids(NOW + 91 * DAY)).toEqual(["p1"]);
  });

  it("expiry alone does not bring a stale suggestion back - only observations inside the 30-day window do", async () => {
    await observe(SHOP, "p1", 5500, 3, NOW);
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-a", NOW);
    expect(await ids(NOW + 91 * DAY)).toEqual([]); // the 3 old observations are older than 30 days by then
  });

  it("several ignores of one product: the LATEST end date rules (a second phone's later tap extends, never shortens)", async () => {
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-a", NOW);
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-b", NOW + 10 * DAY);
    await observe(SHOP, "p1", 5500, 3, NOW + 95 * DAY);
    expect(await ids(NOW + 95 * DAY)).toEqual([]); // first alone would have ended at day 90
    await observe(SHOP, "p1", 5500, 3, NOW + 101 * DAY);
    expect(await ids(NOW + 101 * DAY)).toEqual(["p1"]);
  });

  it.each([
    ["the later ignore has the smaller id (read first)", "a-later", "z-earlier"],
    ["the later ignore has the larger id (read last)", "z-later", "a-earlier"],
  ])("the LATEST end date rules whatever order the events are read in: %s", async (_label, laterId, earlierId) => {
    const at = (ms: number) => new Date(ms).toISOString();
    const event = (localId: string, until: number) => ({
      localId, shopId: SHOP, syncStatus: "synced" as const, billLocalId: "", eventType: PRICE_IGNORE_EVENT,
      payload: { shopProductId: "p1", ignoredUntil: at(until) }, createdAt: at(NOW), updatedAt: at(NOW), deviceId: "d",
    });
    await db.learningEvents.bulkAdd([event(earlierId, NOW + 90 * DAY), event(laterId, NOW + 100 * DAY)]);
    await observe(SHOP, "p1", 5500, 3, NOW + 95 * DAY);
    expect(await ids(NOW + 95 * DAY)).toEqual([]); // inside the later end date, past the earlier one
  });

  it("is per shop: another shop's ignore of the same id changes nothing here (hard rule 12)", async () => {
    await observe(SHOP, "p1", 5500, 3, NOW);
    await observe("shop-2", "p1", 5500, 3, NOW);
    await ignorePriceSuggestionFor(db, "shop-2", "p1", "dev-a", NOW);
    expect(await ids(NOW, SHOP)).toEqual(["p1"]);
    expect(await ids(NOW, "shop-2")).toEqual([]);
  });

  it("an ignore event that arrived by pull (synced, from another phone) counts exactly like a local one", async () => {
    await observe(SHOP, "p1", 5500, 3, NOW);
    await db.learningEvents.add({
      localId: crypto.randomUUID(), serverId: "srv-1", shopId: SHOP, syncStatus: "synced", billLocalId: "", eventType: PRICE_IGNORE_EVENT,
      payload: { shopProductId: "p1", ignoredUntil: new Date(NOW + 90 * DAY).toISOString() }, createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), deviceId: "phone-b",
    });
    expect(await ids(NOW)).toEqual([]);
  });

  it("a malformed payload is ignored, not fatal", async () => {
    await observe(SHOP, "p1", 5500, 3, NOW);
    await db.learningEvents.add({
      localId: crypto.randomUUID(), shopId: SHOP, syncStatus: "synced", billLocalId: "", eventType: PRICE_IGNORE_EVENT, payload: { shopProductId: 7, ignoredUntil: "not a date" },
      createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), deviceId: "phone-b",
    });
    expect(await ids(NOW)).toEqual(["p1"]);
  });
});

describe("listIgnoredPriceSuggestions - for Developer mode", () => {
  it("lists the suggestions that are hidden right now, with their end date; not expired ones, not other shops'", async () => {
    await observe(SHOP, "p1", 5500, 3, NOW);
    await observe(SHOP, "p2", 9100, 3, NOW);
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-a", NOW);
    expect(await listIgnoredPriceSuggestions(db, SHOP, NOW)).toEqual([
      { suggestion: { catalogId: "p1", suggestedPricePaise: 5500, observationCount: 3 }, ignoredUntilMs: NOW + 90 * DAY },
    ]);
    expect(await listIgnoredPriceSuggestions(db, SHOP, NOW + 91 * DAY)).toEqual([]);
    expect(await listIgnoredPriceSuggestions(db, "shop-2", NOW)).toEqual([]);
  });
});

describe("Reset learning clears the ignores like the rest - but keeps the bill markers", () => {
  it("deletes this shop's ignore events only; the bill_learned marker, another shop's ignore and the reset event stay/appear", async () => {
    await observe(SHOP, "p1", 5500, 3, NOW);
    await ignorePriceSuggestionFor(db, SHOP, "p1", "dev-a", NOW);
    await ignorePriceSuggestionFor(db, "shop-2", "p9", "dev-a", NOW);
    await db.learningEvents.add({
      localId: "marker-1", shopId: SHOP, syncStatus: "synced", billLocalId: "bill-1", eventType: "bill_learned", payload: {},
      createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), deviceId: "dev-a",
    });
    await resetLearning(db, SHOP, NOW + 1000, "dev-a");
    expect(await ignoreEvents(SHOP)).toEqual([]);
    expect(await ignoreEvents("shop-2")).toHaveLength(1);
    const types = (await db.learningEvents.where("shopId").equals(SHOP).toArray()).map((e) => e.eventType).sort();
    expect(types).toEqual(["bill_learned", "learning_reset"]);
  });
});
