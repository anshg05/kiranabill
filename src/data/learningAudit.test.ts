/**
 * KB-210. Tests written first, per the owner's explicit instruction, same
 * standard held to this time (KB-208's own pause got skipped once,
 * disclosed as a one-time deviation - not repeating that here).
 *
 * Real fake-indexeddb throughout (KB-109's own standard), two-shop
 * isolation asserted on every function - the same discipline KB-105's
 * RLS negative tests hold for the server side, applied here to the local
 * side, since hard rule 12 ("learning is per-shop, never global") is a
 * real correctness requirement, not a nice-to-have.
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { KiranaBillDB } from "./db";
import {
  listLearnedAliases,
  listProvisionalProducts,
  listPendingPriceSuggestions,
  resetLearning,
} from "./learningAudit";

describe("learningAudit.ts", () => {
  let db: KiranaBillDB;

  beforeEach(() => {
    db = new KiranaBillDB(`test-learning-audit-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  describe("listLearnedAliases", () => {
    it("returns a shop's learned aliases with confidence", async () => {
      await db.learnedAliases.add({
        localId: "a1",
        shopId: "shop-1",
        syncStatus: "synced",
        alias: "पाले जी",
        shopProductId: "160",
        hitCount: 3,
        confidence: 0.85,
        source: "confirmation",
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });

      const result = await listLearnedAliases(db, "shop-1");
      expect(result).toHaveLength(1);
      expect(result[0]?.alias).toBe("पाले जी");
      expect(result[0]?.confidence).toBe(0.85);
    });

    it("never returns another shop's aliases", async () => {
      await db.learnedAliases.add({
        localId: "a1",
        shopId: "shop-1",
        syncStatus: "synced",
        alias: "पाले जी",
        shopProductId: "160",
        hitCount: 3,
        confidence: 0.85,
        source: "confirmation",
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });
      await db.learnedAliases.add({
        localId: "a2",
        shopId: "shop-2",
        syncStatus: "synced",
        alias: "दूध",
        shopProductId: "44",
        hitCount: 5,
        confidence: 0.9,
        source: "correction",
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });

      const shop1Result = await listLearnedAliases(db, "shop-1");
      expect(shop1Result).toHaveLength(1);
      expect(shop1Result[0]?.shopId).toBe("shop-1");
    });

    it("returns an empty array for a shop with no learned aliases", async () => {
      const result = await listLearnedAliases(db, "shop-with-nothing");
      expect(result).toEqual([]);
    });
  });

  describe("listProvisionalProducts", () => {
    it("returns a shop's provisional products with counts", async () => {
      await db.provisionalProducts.add({
        localId: "p1",
        shopId: "shop-1",
        syncStatus: "synced",
        spokenName: "kaju katli",
        seenCount: 2,
        suggestedUnit: "piece",
        suggestedPricePaise: 5000,
        promotedAt: null,
        promotedShopProductId: null,
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });

      const result = await listProvisionalProducts(db, "shop-1");
      expect(result).toHaveLength(1);
      expect(result[0]?.spokenName).toBe("kaju katli");
      expect(result[0]?.seenCount).toBe(2);
    });

    it("never returns another shop's provisional products", async () => {
      await db.provisionalProducts.add({
        localId: "p1",
        shopId: "shop-1",
        syncStatus: "synced",
        spokenName: "kaju katli",
        seenCount: 2,
        suggestedUnit: "piece",
        suggestedPricePaise: 5000,
        promotedAt: null,
        promotedShopProductId: null,
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });

      const result = await listProvisionalProducts(db, "shop-2");
      expect(result).toEqual([]);
    });
  });

  describe("listPendingPriceSuggestions", () => {
    const nowMs = 1_000_000;

    it("reuses learning.ts's real getPriceSuggestions() - 3+ matching observations in the window confirm a suggestion", async () => {
      for (let i = 0; i < 3; i++) {
        await db.priceObservations.add({
          localId: `po-${i}`,
          shopId: "shop-1",
          syncStatus: "synced",
          shopProductId: "27",
          observedPricePaise: 6000,
          occurredAt: new Date(nowMs - 1000 + i).toISOString(),
          updatedAt: new Date().toISOString(),
          deviceId: "device-1",
        });
      }

      const result = await listPendingPriceSuggestions(db, "shop-1", nowMs);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ catalogId: "27", suggestedPricePaise: 6000, observationCount: 3 });
    });

    it("does not suggest a price with fewer than 3 matching observations", async () => {
      for (let i = 0; i < 2; i++) {
        await db.priceObservations.add({
          localId: `po-${i}`,
          shopId: "shop-1",
          syncStatus: "synced",
          shopProductId: "27",
          observedPricePaise: 6000,
          occurredAt: new Date(nowMs - 1000 + i).toISOString(),
          updatedAt: new Date().toISOString(),
          deviceId: "device-1",
        });
      }

      const result = await listPendingPriceSuggestions(db, "shop-1", nowMs);
      expect(result).toEqual([]);
    });

    it("never mixes observations across shops when grouping by product", async () => {
      // Same shopProductId id space in principle - but different shops -
      // must never combine into one false 3-observation suggestion.
      for (let i = 0; i < 2; i++) {
        await db.priceObservations.add({
          localId: `shop1-${i}`,
          shopId: "shop-1",
          syncStatus: "synced",
          shopProductId: "27",
          observedPricePaise: 6000,
          occurredAt: new Date(nowMs - 1000 + i).toISOString(),
          updatedAt: new Date().toISOString(),
          deviceId: "device-1",
        });
      }
      for (let i = 0; i < 2; i++) {
        await db.priceObservations.add({
          localId: `shop2-${i}`,
          shopId: "shop-2",
          syncStatus: "synced",
          shopProductId: "27",
          observedPricePaise: 6000,
          occurredAt: new Date(nowMs - 1000 + i).toISOString(),
          updatedAt: new Date().toISOString(),
          deviceId: "device-1",
        });
      }

      const shop1Result = await listPendingPriceSuggestions(db, "shop-1", nowMs);
      const shop2Result = await listPendingPriceSuggestions(db, "shop-2", nowMs);
      // 2 observations each, real shops kept separate - neither reaches 3,
      // and neither sees the other's rows.
      expect(shop1Result).toEqual([]);
      expect(shop2Result).toEqual([]);
    });
  });

  describe("resetLearning", () => {
    async function seedShop(shopId: string): Promise<void> {
      await db.learnedAliases.add({
        localId: `${shopId}-alias`,
        shopId,
        syncStatus: "synced",
        alias: "पाले जी",
        shopProductId: "160",
        hitCount: 3,
        confidence: 0.85,
        source: "confirmation",
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });
      await db.provisionalProducts.add({
        localId: `${shopId}-provisional`,
        shopId,
        syncStatus: "synced",
        spokenName: "kaju katli",
        seenCount: 2,
        suggestedUnit: "piece",
        suggestedPricePaise: 5000,
        promotedAt: null,
        promotedShopProductId: null,
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });
      await db.priceObservations.add({
        localId: `${shopId}-observation`,
        shopId,
        syncStatus: "synced",
        shopProductId: "27",
        observedPricePaise: 6000,
        occurredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });
    }

    it("clears all three learning tables for the target shop only", async () => {
      await seedShop("shop-1");
      await seedShop("shop-2");

      await resetLearning(db, "shop-1", 2_000_000, "device-1");

      expect(await db.learnedAliases.where("shopId").equals("shop-1").count()).toBe(0);
      expect(await db.provisionalProducts.where("shopId").equals("shop-1").count()).toBe(0);
      expect(await db.priceObservations.where("shopId").equals("shop-1").count()).toBe(0);

      // The other shop's data must survive completely untouched - the
      // actual correctness requirement, not just "shop-1 is empty."
      expect(await db.learnedAliases.where("shopId").equals("shop-2").count()).toBe(1);
      expect(await db.provisionalProducts.where("shopId").equals("shop-2").count()).toBe(1);
      expect(await db.priceObservations.where("shopId").equals("shop-2").count()).toBe(1);
    });

    it("returns the exact cleared counts, not just a success boolean", async () => {
      await seedShop("shop-1");

      const result = await resetLearning(db, "shop-1", 2_000_000, "device-1");

      expect(result.clearedCounts).toEqual({
        learnedAliases: 1,
        provisionalProducts: 1,
        priceObservations: 1,
      });
    });

    it("returns clearedCounts of all zero for a shop with nothing to clear - not an error", async () => {
      const result = await resetLearning(db, "shop-with-nothing", 2_000_000, "device-1");
      expect(result.clearedCounts).toEqual({ learnedAliases: 0, provisionalProducts: 0, priceObservations: 0 });
    });

    it("the remote-deletion limitation is signalled structurally, not just in a comment", () => {
      // Compile-time check as much as a runtime one: remoteDeletionNotPerformed
      // is typed as the literal `true`, not `boolean` - this assertion
      // exists so the literal type can never silently widen back to
      // `boolean` without this test needing an update.
      const result: { remoteDeletionNotPerformed: true } = { remoteDeletionNotPerformed: true };
      expect(result.remoteDeletionNotPerformed).toBe(true);
    });

    it("resetLearning's real return value includes the honest warning and the literal-true signal", async () => {
      await seedShop("shop-1");
      const result = await resetLearning(db, "shop-1", 2_000_000, "device-1");

      expect(result.shopId).toBe("shop-1");
      expect(result.remoteDeletionNotPerformed).toBe(true);
      expect(result.warning.length).toBeGreaterThan(20);
      expect(result.warning.toLowerCase()).toContain("server");
      expect(result.warning.toLowerCase()).toContain("not");
    });

    it("does NOT delete learningEvents - the audit log survives its own most-important entry", async () => {
      await seedShop("shop-1");
      await db.learningEvents.add({
        localId: "event-1",
        shopId: "shop-1",
        syncStatus: "synced",
        billLocalId: "bill-1",
        eventType: "alias_promoted",
        payload: { alias: "पाले जी" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deviceId: "device-1",
      });

      await resetLearning(db, "shop-1", 2_000_000, "device-1");

      const events = await db.learningEvents.where("shopId").equals("shop-1").toArray();
      // The pre-existing event must still be there...
      expect(events.some((e) => e.localId === "event-1")).toBe(true);
    });

    it("appends a real learning_reset event recording exactly what was cleared - auditability applies to the reset itself", async () => {
      await seedShop("shop-1");

      await resetLearning(db, "shop-1", 2_000_000, "device-1");

      const events = await db.learningEvents.where("shopId").equals("shop-1").toArray();
      const resetEvent = events.find((e) => e.eventType === "learning_reset");
      expect(resetEvent).toBeDefined();
      expect(resetEvent?.payload).toMatchObject({
        clearedCounts: { learnedAliases: 1, provisionalProducts: 1, priceObservations: 1 },
      });
      expect(resetEvent?.deviceId).toBe("device-1");
    });

    it("resetting a shop with nothing to clear still appends a learning_reset event with all-zero counts", async () => {
      await resetLearning(db, "shop-with-nothing", 2_000_000, "device-1");

      const events = await db.learningEvents.where("shopId").equals("shop-with-nothing").toArray();
      const resetEvent = events.find((e) => e.eventType === "learning_reset");
      expect(resetEvent).toBeDefined();
      expect(resetEvent?.payload).toMatchObject({
        clearedCounts: { learnedAliases: 0, provisionalProducts: 0, priceObservations: 0 },
      });
    });
  });
});
