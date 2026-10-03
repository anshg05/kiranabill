import Dexie, { type EntityTable } from "dexie";
import type { StoredReviewFlag } from "@/domain/finalBill";

// KB-109: the local IndexedDB layer. Three genuinely different roles
// hide under "mirror the server tables" (docs/03-DATA-MODEL.md section 6):
//
// - Local-first (push): bills, billItems, and the four learning tables.
//   Written locally first, real per-row syncStatus, pushed by the sync
//   worker (KB-110).
// - Read-cache (pull-only): shopProducts, baseProducts. Per
//   03-DATA-MODEL.md section 0's own rule - every write goes to Postgres,
//   the cache is downstream, never the other way round. No syncStatus,
//   no localId - these rows are never created locally, only ever written
//   by the sync worker pulling from Postgres, keyed by the server's own id.
// - Hybrid: receiptNumberBlocks - created via a real online round-trip
//   (never offline), then locally mutated (nextNumber decremented) while
//   offline. Reuses syncStatus, but it means something different here:
//   rows always arrive "synced" (server-created), and only flip to
//   "pending" when nextNumber is locally decremented - there is no
//   local-first insert path for this table, only a local mutation path.
//
// shops is also cached locally (not stated as an IndexedDB requirement
// anywhere until this ticket - see 03-DATA-MODEL.md section 6's addendum)
// - a receipt must render offline, which only works if shop settings are
//   cached the same way any other synced setting is.
//
// Money/quantity are stored as plain numbers (paise as number, not a
// branded domain/money.ts type) - converted via domain/money.ts's own
// functions at the read/write boundary. Same reasoning as Postgres's own
// bigint choice: IndexedDB's structured-clone storage doesn't preserve a
// custom class's prototype cleanly across a schema version bump.

export type SyncStatus = "pending" | "synced" | "conflict";

export interface LocalBill {
  /** Must be a UUID (crypto.randomUUID() - KB-307 generates it): bills.local_id
   * is uuid and push_bill casts it, so anything else is a permanent 22P02
   * conflict (docs/07-DECISIONS.md D37). */
  localId: string;
  serverId?: string;
  shopId: string;
  status: "draft" | "final" | "cancelled";
  syncStatus: SyncStatus;
  receiptNumber: string;
  /** KB-110b / KI-31: which allocation path produced receiptNumber (D24) -
   * receiptNumbers.ts consumeNextNumber() returns it; KB-307 stores it here.
   * Pushed as bills.receipt_number_source; a permanent label, never a
   * trigger for renumbering. */
  receiptNumberSource: "block" | "fallback";
  customerName: string;
  customerMobile: string | null;
  subtotalPaise: number;
  totalPaise: number;
  schemaVersion: number;
  deviceId: string;
  createdAt: string;
  finalizedAt: string | null;
  syncedAt: string | null;
}

export interface LocalBillItem {
  id?: number;
  billLocalId: string;
  shopId: string;
  lineNo: number;
  shopProductId: string | null;
  displayName: string;
  spokenName: string | null;
  qty: number | null;
  unit: string | null;
  ratePaise: number | null;
  /** KB-110b / D36: the unit ratePaise is per (ParsedItem.rateUnit). null
   * exactly when ratePaise is null - bill_items_rate_unit_iff_rate. */
  rateUnit: string | null;
  totalPaise: number;
  priceType: "rate" | "total" | "default" | "unknown";
  source: "voice" | "fastpath" | "manual";
  /** KB-307 (owner): each flag the line carried at finalise, with its severity
   * and whether the shopkeeper said "Theek hai" - so "saw and confirmed"
   * survives finalise. bill_items.review_flags (jsonb). */
  reviewFlags: StoredReviewFlag[];
  wasEdited: boolean;
}

export interface LocalLearnedAlias {
  localId: string;
  serverId?: string;
  shopId: string;
  syncStatus: SyncStatus;
  alias: string;
  shopProductId: string;
  hitCount: number;
  confidence: number;
  source: "correction" | "confirmation";
  updatedAt: string;
  deviceId: string;
}

export interface LocalProvisionalProduct {
  localId: string;
  serverId?: string;
  shopId: string;
  syncStatus: SyncStatus;
  spokenName: string;
  seenCount: number;
  suggestedUnit: string | null;
  suggestedPricePaise: number | null;
  promotedAt: string | null;
  promotedShopProductId: string | null;
  updatedAt: string;
  deviceId: string;
}

export interface LocalPriceObservation {
  localId: string;
  serverId?: string;
  shopId: string;
  syncStatus: SyncStatus;
  shopProductId: string;
  observedPricePaise: number;
  occurredAt: string;
  updatedAt: string;
  deviceId: string;
}

export interface LocalLearningEvent {
  localId: string;
  serverId?: string;
  shopId: string;
  syncStatus: SyncStatus;
  /**
   * References bills.localId, NOT the server bill id - a finalised bill
   * may not have synced yet when its learning event fires (finalisation
   * is local-first too), so the local id is the only reference guaranteed
   * to exist at write time. KB-110 translates this when pushing.
   */
  billLocalId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
}

export interface LocalShopProduct {
  id: string;
  shopId: string;
  baseProductId: string | null;
  displayName: string;
  category: string | null;
  unit: string;
  pricePaise: number;
  aliases: string[];
  source: "base" | "custom" | "learned";
  useCount: number;
  sku: string | null;
  barcode: string | null;
  isActive: boolean;
}

export interface LocalBaseProduct {
  id: string;
  catalogVersion: number;
  displayName: string;
  sourceCategory: string;
  guardCategory: string;
  defaultUnit: string;
  suggestedPricePaise: number;
  aliases: string[];
  isActive: boolean;
}

export interface LocalReceiptNumberBlock {
  id: string;
  shopId: string;
  deviceId: string;
  blockStart: number;
  blockEnd: number;
  nextNumber: number;
  allocatedAt: string;
  syncStatus: SyncStatus;
}

export interface LocalShop {
  id: string;
  syncStatus: SyncStatus;
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  catalogMode: "base_imported" | "custom_only";
  billLanguage: "en" | "hi" | "both";
  receiptPrefix: string | null;
  updatedAt: string;
}

/** KB-315: small per-user key/value store (e.g. activeShopId). */
export interface LocalMeta {
  key: string;
  value: string;
}

export interface LocalSyncState {
  tableName: string;
  lastSyncedAt: string | null;
  cursor: string | null;
  pendingCount: number;
}

export class KiranaBillDB extends Dexie {
  bills!: EntityTable<LocalBill, "localId">;
  billItems!: EntityTable<LocalBillItem, "id">;
  learnedAliases!: EntityTable<LocalLearnedAlias, "localId">;
  provisionalProducts!: EntityTable<LocalProvisionalProduct, "localId">;
  priceObservations!: EntityTable<LocalPriceObservation, "localId">;
  learningEvents!: EntityTable<LocalLearningEvent, "localId">;
  shopProducts!: EntityTable<LocalShopProduct, "id">;
  baseProducts!: EntityTable<LocalBaseProduct, "id">;
  receiptNumberBlocks!: EntityTable<LocalReceiptNumberBlock, "id">;
  shops!: EntityTable<LocalShop, "id">;
  syncState!: EntityTable<LocalSyncState, "tableName">;
  meta!: EntityTable<LocalMeta, "key">;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      bills:
        "&localId, shopId, status, syncStatus, createdAt, customerName, totalPaise, [shopId+status]",
      billItems: "++id, billLocalId, &[billLocalId+lineNo]",
      learnedAliases: "&localId, shopId, syncStatus",
      provisionalProducts: "&localId, shopId, syncStatus",
      priceObservations: "&localId, shopId, syncStatus",
      learningEvents: "&localId, shopId, syncStatus",
      // isActive is deliberately NOT indexed, compound or otherwise -
      // IndexedDB does not support boolean as an index key type at all
      // (only number/string/Date/arrays of those). Found by the schema
      // actually running against fake-indexeddb, not assumed to work
      // because Dexie's schema-string syntax accepted it silently.
      // shopId's own index is already selective enough (per-shop product
      // counts are capped at 10,000 before this project falls back to
      // server-side search per 03-DATA-MODEL.md section 0) - filtering
      // isActive in memory after that index narrows the scan is fine.
      shopProducts: "&id, shopId, displayName, *aliases",
      baseProducts: "&id, displayName, *aliases",
      // syncStatus added by KB-110, which needed to query pending blocks -
      // an oversight in the original KB-109 schema, caught only by
      // actually exercising the query against fake-indexeddb, not by the
      // schema string being "wrong" in an obviously-visible way.
      receiptNumberBlocks: "&id, shopId, syncStatus, [shopId+nextNumber]",
      shops: "&id, syncStatus",
      syncState: "&tableName",
    });

    // KB-110b: two new fields, no index changes (stores() is only needed for
    // index changes, so version 2 declares none - Dexie carries v1's forward).
    // The upgrade is defined even though nothing writes bills locally in
    // production yet (docs/12-PARKED.md KI-32), and is exercised in db.test.ts.
    this.version(2).upgrade(async (tx) => {
      // D23: a fallback receipt number embeds the full device UUID
      // ("{prefix}-{uuid}-{n}"); a block number never contains one. So this
      // is deterministic, not a guess.
      await tx.table("bills").toCollection().modify((bill: Partial<LocalBill>) => {
        if (bill.receiptNumberSource === undefined) {
          bill.receiptNumberSource = FALLBACK_RECEIPT_PATTERN.test(bill.receiptNumber ?? "") ? "fallback" : "block";
        }
      });
      // The pre-D36 meaning: a rate was per the line's own unit.
      await tx.table("billItems").toCollection().modify((item: Partial<LocalBillItem>) => {
        if (item.rateUnit === undefined) {
          item.rateUnit = item.ratePaise === null || item.ratePaise === undefined ? null : (item.unit ?? null);
        }
      });
    });

    // KB-315: per-user key/value meta (activeShopId). Additive - no upgrade needed.
    this.version(3).stores({ meta: "&key" });
  }
}

const FALLBACK_RECEIPT_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * KB-315 (docs/07-DECISIONS.md D38): one local database PER SIGNED-IN USER,
 * `kiranabill-<userId>`. Sign-out closes it and deletes nothing; the same user
 * signing back in continues (unsynced bills included); another user on the
 * same device gets a separate, empty database - no cross-shop data on the
 * device. Replaces the old module-level `db` (one shared "kiranabill"
 * database), which is abandoned, not deleted: nothing of value was ever
 * written to it (no bills - KI-32).
 */
export function shopDbName(userId: string): string {
  return `kiranabill-${userId}`;
}

export function openShopDb(userId: string): KiranaBillDB {
  return new KiranaBillDB(shopDbName(userId));
}
