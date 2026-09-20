import Dexie, { type EntityTable } from "dexie";

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
  localId: string;
  serverId?: string;
  shopId: string;
  status: "draft" | "final" | "cancelled";
  syncStatus: SyncStatus;
  receiptNumber: string;
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
  totalPaise: number;
  priceType: "rate" | "total" | "default" | "unknown";
  source: "voice" | "fastpath" | "manual";
  reviewFlags: string[];
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

  constructor(name = "kiranabill") {
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
  }
}

export const db = new KiranaBillDB();
