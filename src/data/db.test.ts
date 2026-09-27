import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Dexie from "dexie";
import { KiranaBillDB, type LocalShopProduct } from "./db";

describe("KiranaBillDB", () => {
  let db: KiranaBillDB;

  beforeEach(() => {
    db = new KiranaBillDB(`test-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  describe("bills (local-first)", () => {
    it("a written bill is immediately readable back", async () => {
      await db.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "draft",
        syncStatus: "pending",
        receiptNumber: "KB-0001",
        receiptNumberSource: "block",
        customerName: "Cash",
        customerMobile: null,
        subtotalPaise: 15000,
        totalPaise: 15000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: new Date().toISOString(),
        finalizedAt: null,
        syncedAt: null,
      });

      const found = await db.bills.get("bill-1");
      expect(found?.receiptNumber).toBe("KB-0001");
      expect(found?.syncStatus).toBe("pending");
    });

    it("[shopId+status] index finds a shop's drafts without a full scan", async () => {
      await db.bills.bulkAdd([
        {
          localId: "bill-1",
          shopId: "shop-1",
          status: "draft",
          syncStatus: "pending",
          receiptNumber: "KB-0001",
          receiptNumberSource: "block",
          customerName: "Cash",
          customerMobile: null,
          subtotalPaise: 1000,
          totalPaise: 1000,
          schemaVersion: 1,
          deviceId: "device-1",
          createdAt: new Date().toISOString(),
          finalizedAt: null,
          syncedAt: null,
        },
        {
          localId: "bill-2",
          shopId: "shop-1",
          status: "final",
          syncStatus: "synced",
          receiptNumber: "KB-0002",
          receiptNumberSource: "block",
          customerName: "Cash",
          customerMobile: null,
          subtotalPaise: 2000,
          totalPaise: 2000,
          schemaVersion: 1,
          deviceId: "device-1",
          createdAt: new Date().toISOString(),
          finalizedAt: new Date().toISOString(),
          syncedAt: new Date().toISOString(),
        },
      ]);

      const drafts = await db.bills.where({ shopId: "shop-1", status: "draft" }).toArray();
      expect(drafts.map((b) => b.localId)).toEqual(["bill-1"]);
    });

    it("customerName and createdAt are indexed for S5's offline search", async () => {
      await db.bills.add({
        localId: "bill-1",
        shopId: "shop-1",
        status: "final",
        syncStatus: "synced",
        receiptNumber: "KB-0001",
        receiptNumberSource: "block",
        customerName: "Ramesh Kumar",
        customerMobile: null,
        subtotalPaise: 1000,
        totalPaise: 1000,
        schemaVersion: 1,
        deviceId: "device-1",
        createdAt: "2026-09-20T10:00:00.000Z",
        finalizedAt: "2026-09-20T10:00:00.000Z",
        syncedAt: null,
      });

      const byName = await db.bills.where("customerName").equals("Ramesh Kumar").toArray();
      expect(byName).toHaveLength(1);

      const byDate = await db.bills.where("createdAt").equals("2026-09-20T10:00:00.000Z").toArray();
      expect(byDate).toHaveLength(1);
    });
  });

  describe("billItems (no independent sync columns)", () => {
    it("[billLocalId+lineNo] uniqueness matches the server's own constraint", async () => {
      await db.billItems.add({
        billLocalId: "bill-1",
        shopId: "shop-1",
        lineNo: 1,
        shopProductId: null,
        displayName: "Chawal",
        spokenName: "chawal",
        qty: 5,
        unit: "kg",
        ratePaise: 3000,
        rateUnit: "kg",
        totalPaise: 15000,
        priceType: "rate",
        source: "voice",
        reviewFlags: [],
        wasEdited: false,
      });

      await expect(
        db.billItems.add({
          billLocalId: "bill-1",
          shopId: "shop-1",
          lineNo: 1, // duplicate within the same bill
          shopProductId: null,
          displayName: "Besan",
          spokenName: null,
          qty: 1,
          unit: "kg",
          ratePaise: 9000,
          rateUnit: "kg",
          totalPaise: 9000,
          priceType: "rate",
          source: "manual",
          reviewFlags: [],
          wasEdited: false,
        }),
      ).rejects.toThrow();
    });

    it("finds all items for a bill via the billLocalId index", async () => {
      await db.billItems.bulkAdd([
        {
          billLocalId: "bill-1",
          shopId: "shop-1",
          lineNo: 1,
          shopProductId: null,
          displayName: "Chawal",
          spokenName: null,
          qty: 5,
          unit: "kg",
          ratePaise: 3000,
          rateUnit: "kg",
          totalPaise: 15000,
          priceType: "rate",
          source: "voice",
          reviewFlags: [],
          wasEdited: false,
        },
        {
          billLocalId: "bill-1",
          shopId: "shop-1",
          lineNo: 2,
          shopProductId: null,
          displayName: "Besan",
          spokenName: null,
          qty: 1,
          unit: "kg",
          ratePaise: 9000,
          rateUnit: "kg",
          totalPaise: 9000,
          priceType: "rate",
          source: "voice",
          reviewFlags: [],
          wasEdited: false,
        },
      ]);

      const items = await db.billItems.where("billLocalId").equals("bill-1").toArray();
      expect(items).toHaveLength(2);
    });
  });

  describe("shopProducts / baseProducts (read-cache, pull-only)", () => {
    it("has no syncStatus or localId field - never created locally", () => {
      const row: LocalShopProduct = {
        id: "sp-1",
        shopId: "shop-1",
        baseProductId: null,
        displayName: "Chini",
        category: null,
        unit: "kg",
        pricePaise: 4500,
        aliases: ["chini", "sugar"],
        source: "custom",
        useCount: 0,
        sku: null,
        barcode: null,
        isActive: true,
      };
      expect("syncStatus" in row).toBe(false);
      expect("localId" in row).toBe(false);
    });

    it("*aliases multi-entry index finds a product by any of its aliases, matching catalogIndex.ts's own access pattern", async () => {
      await db.shopProducts.add({
        id: "sp-1",
        shopId: "shop-1",
        baseProductId: null,
        displayName: "Chini",
        category: null,
        unit: "kg",
        pricePaise: 4500,
        aliases: ["chini", "sugar", "शक्कर"],
        source: "custom",
        useCount: 0,
        sku: null,
        barcode: null,
        isActive: true,
      });

      const byAlias = await db.shopProducts.where("aliases").equals("sugar").toArray();
      expect(byAlias.map((p) => p.id)).toEqual(["sp-1"]);

      const byDevanagariAlias = await db.shopProducts.where("aliases").equals("शक्कर").toArray();
      expect(byDevanagariAlias.map((p) => p.id)).toEqual(["sp-1"]);
    });

    it("shopId index narrows the scan, isActive filters in memory (booleans cannot be an IndexedDB index key)", async () => {
      await db.shopProducts.bulkAdd([
        {
          id: "sp-1",
          shopId: "shop-1",
          baseProductId: null,
          displayName: "Active Product",
          category: null,
          unit: "kg",
          pricePaise: 1000,
          aliases: [],
          source: "custom",
          useCount: 0,
          sku: null,
          barcode: null,
          isActive: true,
        },
        {
          id: "sp-2",
          shopId: "shop-1",
          baseProductId: null,
          displayName: "Inactive Product",
          category: null,
          unit: "kg",
          pricePaise: 1000,
          aliases: [],
          source: "custom",
          useCount: 0,
          sku: null,
          barcode: null,
          isActive: false,
        },
      ]);

      const active = await db.shopProducts
        .where("shopId")
        .equals("shop-1")
        .and((p) => p.isActive)
        .toArray();
      expect(active.map((p) => p.id)).toEqual(["sp-1"]);
    });
  });

  describe("receiptNumberBlocks (hybrid)", () => {
    it("arrives synced (server-created) and can be locally mutated to pending as nextNumber is consumed", async () => {
      await db.receiptNumberBlocks.add({
        id: "block-1",
        shopId: "shop-1",
        deviceId: "device-1",
        blockStart: 1,
        blockEnd: 50,
        nextNumber: 1,
        allocatedAt: new Date().toISOString(),
        syncStatus: "synced",
      });

      await db.receiptNumberBlocks.update("block-1", { nextNumber: 2, syncStatus: "pending" });

      const block = await db.receiptNumberBlocks.get("block-1");
      expect(block?.nextNumber).toBe(2);
      expect(block?.syncStatus).toBe("pending");
    });
  });

  describe("shops (local settings cache)", () => {
    it("caches the fields a receipt needs to render offline", async () => {
      await db.shops.add({
        id: "shop-1",
        syncStatus: "synced",
        name: "Sharma Kirana",
        phone: "9876543210",
        address: null,
        logoUrl: null,
        catalogMode: "custom_only",
        billLanguage: "hi",
        receiptPrefix: "KB",
        updatedAt: new Date().toISOString(),
      });

      const shop = await db.shops.get("shop-1");
      expect(shop?.name).toBe("Sharma Kirana");
      expect(shop?.billLanguage).toBe("hi");
    });
  });

  describe("syncState", () => {
    it("tracks table-level freshness for pull-only tables", async () => {
      await db.syncState.add({
        tableName: "shopProducts",
        lastSyncedAt: "2026-09-20T10:00:00.000Z",
        cursor: null,
        pendingCount: 0,
      });

      const state = await db.syncState.get("shopProducts");
      expect(state?.lastSyncedAt).toBe("2026-09-20T10:00:00.000Z");
    });
  });
});

// Schema-version-upgrade rehearsal. NOT a real migration being shipped -
// there is nothing to migrate yet, this is the first version. SD-012
// names Dexie's schema versioning as the real risk of choosing Dexie
// ("getting transactions and schema versioning wrong here would corrupt
// bill data") - a CRUD test alone doesn't exercise that risk at all. This
// proves the upgrade mechanism itself: a populated v1 database, opened
// against a v2 schema with a new indexed field and an upgrade() backfill,
// survives with its existing data correctly typed and the new field
// correctly defaulted - not silently dropped or wrongly typed by
// structured-clone across the version bump.
describe("schema version upgrade (rehearsal of the Dexie mechanism, not a real migration)", () => {
  const upgradeDbName = `test-upgrade-${crypto.randomUUID()}`;

  afterEach(async () => {
    await Dexie.delete(upgradeDbName);
  });

  it("a v1 row survives a v2 upgrade with the new field correctly backfilled", async () => {
    interface V1Bill {
      localId: string;
      shopId: string;
      totalPaise: number;
    }
    interface V2Bill extends V1Bill {
      // Synthetic addition for this test only: a new indexed field that
      // didn't exist in v1 and must be backfilled during the upgrade.
      isOfflineCreated: boolean;
    }

    const v1 = new Dexie(upgradeDbName);
    v1.version(1).stores({ bills: "&localId, shopId" });
    await v1.open();
    await (v1 as unknown as { bills: Dexie.Table<V1Bill, string> }).bills.add({
      localId: "bill-1",
      shopId: "shop-1",
      totalPaise: 15000,
    });
    v1.close();

    const v2 = new Dexie(upgradeDbName);
    v2.version(1).stores({ bills: "&localId, shopId" });
    v2.version(2)
      .stores({ bills: "&localId, shopId, isOfflineCreated" })
      .upgrade((tx) =>
        tx
          .table("bills")
          .toCollection()
          .modify((bill: V1Bill & Partial<V2Bill>) => {
            bill.isOfflineCreated = false;
          }),
      );
    await v2.open();

    const upgraded = await (v2 as unknown as { bills: Dexie.Table<V2Bill, string> }).bills.get(
      "bill-1",
    );
    expect(upgraded).toEqual({
      localId: "bill-1",
      shopId: "shop-1",
      totalPaise: 15000,
      isOfflineCreated: false,
    });

    v2.close();
  });
});

// KB-110b: the REAL version 1 -> version 2 upgrade KiranaBillDB ships.
// A database written by the v1 schema (the exact v1 stores() string from
// db.ts) is opened by the current KiranaBillDB class; its upgrade() must
// backfill LocalBill.receiptNumberSource and LocalBillItem.rateUnit.
describe("KB-110b: KiranaBillDB version 1 -> 2 upgrade (real)", () => {
  const name = `test-v1-v2-${crypto.randomUUID()}`;

  afterEach(async () => {
    await Dexie.delete(name);
  });

  it("backfills receiptNumberSource (fallback iff the number embeds a UUID - D23) and rateUnit (the line's unit iff it has a rate)", async () => {
    const v1 = new Dexie(name);
    v1.version(1).stores({
      bills: "&localId, shopId, status, syncStatus, createdAt, customerName, totalPaise, [shopId+status]",
      billItems: "++id, billLocalId, &[billLocalId+lineNo]",
      learnedAliases: "&localId, shopId, syncStatus",
      provisionalProducts: "&localId, shopId, syncStatus",
      priceObservations: "&localId, shopId, syncStatus",
      learningEvents: "&localId, shopId, syncStatus",
      shopProducts: "&id, shopId, displayName, *aliases",
      baseProducts: "&id, displayName, *aliases",
      receiptNumberBlocks: "&id, shopId, syncStatus, [shopId+nextNumber]",
      shops: "&id, syncStatus",
      syncState: "&tableName",
    });
    await v1.open();
    const deviceUuid = "550e8400-e29b-41d4-a716-446655440000";
    const bill = (localId: string, receiptNumber: string) => ({
      localId, shopId: "shop-1", status: "final", syncStatus: "pending", receiptNumber,
      customerName: "Cash", customerMobile: null, subtotalPaise: 100, totalPaise: 100, schemaVersion: 1,
      deviceId: deviceUuid, createdAt: "2026-09-27T10:00:00.000Z", finalizedAt: "2026-09-27T10:00:00.000Z", syncedAt: null,
    });
    await v1.table("bills").bulkAdd([bill("b-block", "KB-000042"), bill("b-fallback", `KB-${deviceUuid}-3`)]);
    const line = (lineNo: number, ratePaise: number | null, unit: string) => ({
      billLocalId: "b-block", shopId: "shop-1", lineNo, shopProductId: null, displayName: "x", spokenName: null,
      qty: 1, unit, ratePaise, totalPaise: 100, priceType: ratePaise === null ? "total" : "rate", source: "manual",
      reviewFlags: [], wasEdited: false,
    });
    await v1.table("billItems").bulkAdd([line(1, 4500, "kg"), line(2, null, "piece")]);
    v1.close();

    const db = new KiranaBillDB(name);
    await db.open();
    expect(db.verno).toBe(3); // upgrades through v2 (this backfill) and v3 (KB-315 meta table)
    expect((await db.bills.get("b-block"))?.receiptNumberSource).toBe("block");
    expect((await db.bills.get("b-fallback"))?.receiptNumberSource).toBe("fallback");
    const items = await db.billItems.where("billLocalId").equals("b-block").sortBy("lineNo");
    expect(items.map((i) => i.rateUnit)).toEqual(["kg", null]);
    db.close();
  });
});
