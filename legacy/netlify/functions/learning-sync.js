var fs = require("fs");
var path = require("path");
var cors = require("./_cors");

var MAX_BODY_CHARS = 800000;
var MAX_PRODUCTS = 4000;
var MAX_PROVISIONAL_PRODUCTS = 4000;
var MAX_CORRECTIONS = 12000;
var MAX_ALIASES_PER_PRODUCT = 16;
var MAX_NAME_CHARS = 120;
var MAX_ALIAS_CHARS = 120;
var DEFAULT_SCOPE_ID = "global";
var FILE_STORE_PATH = process.env.LEARNING_SYNC_FILE_PATH
  ? path.resolve(process.cwd(), process.env.LEARNING_SYNC_FILE_PATH)
  : path.join(process.cwd(), "netlify", "functions", ".learning-sync-store.json");
var BLOB_STORE_NAME = String(process.env.LEARNING_BLOB_STORE || "kiranabill-learning").trim();

var blobsModule = null;
try {
  blobsModule = require("@netlify/blobs");
} catch (error) {
  blobsModule = null;
}

function normalizeLearnedKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeScopeId(value) {
  var cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return cleaned || DEFAULT_SCOPE_ID;
}

function asOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  var parsed = Number(value);
  return isNaN(parsed) ? null : parsed;
}

function asNonNegativeInt(value) {
  var parsed = Number(value);
  if (isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function asTimestamp(value) {
  var parsed = Number(value);
  if (isNaN(parsed) || parsed <= 0) {
    return Date.now();
  }
  return Math.floor(parsed);
}

function sanitizeText(value, maxChars) {
  return String(value || "").trim().slice(0, maxChars || 120);
}

function uniqueTrimmedTexts(items, maxItems, maxChars) {
  var map = {};
  var output = [];

  (items || []).forEach(function(item) {
    var text = sanitizeText(item, maxChars || MAX_ALIAS_CHARS);
    if (!text) {
      return;
    }
    if (map[text]) {
      return;
    }
    map[text] = true;
    output.push(text);
  });

  return output.slice(0, maxItems || MAX_ALIASES_PER_PRODUCT);
}

function normalizePromotedProduct(product) {
  if (!product || !product.displayName) {
    return null;
  }

  var displayName = sanitizeText(product.displayName, MAX_NAME_CHARS);
  if (!displayName) {
    return null;
  }

  var key = normalizeLearnedKey(displayName).replace(/\s+/g, "-").slice(0, 64);

  return {
    id: sanitizeText(product.id, 140) || ("shop-" + key),
    displayName: displayName,
    names: uniqueTrimmedTexts([displayName].concat(Array.isArray(product.names) ? product.names : []), MAX_ALIASES_PER_PRODUCT, MAX_ALIAS_CHARS),
    unit: sanitizeText(product.unit || "piece", 24).toLowerCase() || "piece",
    price: asOptionalNumber(product.price),
    useCount: asNonNegativeInt(product.useCount),
    lastUsedAt: asTimestamp(product.lastUsedAt),
    source: "promoted"
  };
}

function normalizeProvisionalProduct(product) {
  if (!product || !product.displayName) {
    return null;
  }

  var displayName = sanitizeText(product.displayName, MAX_NAME_CHARS);
  if (!displayName) {
    return null;
  }

  var key = normalizeLearnedKey(displayName).replace(/\s+/g, "-").slice(0, 64);

  return {
    id: sanitizeText(product.id, 140) || ("prov-" + key),
    displayName: displayName,
    names: uniqueTrimmedTexts([displayName].concat(Array.isArray(product.names) ? product.names : []), MAX_ALIASES_PER_PRODUCT, MAX_ALIAS_CHARS),
    unit: sanitizeText(product.unit || "piece", 24).toLowerCase() || "piece",
    price: asOptionalNumber(product.price),
    seenCount: asNonNegativeInt(product.seenCount || product.useCount),
    lastSeenAt: asTimestamp(product.lastSeenAt || product.lastUsedAt),
    source: "provisional"
  };
}

function normalizeCorrection(correction) {
  if (!correction || !correction.alias || !correction.displayName) {
    return null;
  }

  var alias = sanitizeText(correction.alias, MAX_ALIAS_CHARS);
  var displayName = sanitizeText(correction.displayName, MAX_NAME_CHARS);
  var aliasKey = normalizeLearnedKey(alias);

  if (!alias || !displayName || !aliasKey) {
    return null;
  }

  return {
    alias: alias,
    aliasKey: aliasKey,
    displayName: displayName,
    unit: sanitizeText(correction.unit, 24).toLowerCase(),
    useCount: asNonNegativeInt(correction.useCount),
    lastUsedAt: asTimestamp(correction.lastUsedAt)
  };
}

function mergeByKey(items, keyFn, mergeFn) {
  var map = {};

  (items || []).forEach(function(item) {
    if (!item) {
      return;
    }

    var key = keyFn(item);
    if (!key) {
      return;
    }

    if (!map[key]) {
      map[key] = item;
      return;
    }

    map[key] = mergeFn(map[key], item);
  });

  return Object.keys(map).map(function(key) {
    return map[key];
  });
}

function mergePromotedProducts(existing, incoming) {
  return mergeByKey(
    (existing || []).concat(incoming || []).map(normalizePromotedProduct).filter(Boolean),
    function(item) {
      return normalizeLearnedKey(item.displayName);
    },
    function(left, right) {
      return {
        id: left.id || right.id,
        displayName: left.displayName || right.displayName,
        names: uniqueTrimmedTexts((left.names || []).concat(right.names || []), MAX_ALIASES_PER_PRODUCT, MAX_ALIAS_CHARS),
        unit: right.unit || left.unit,
        price: right.price !== null && right.price !== undefined ? right.price : left.price,
        useCount: Math.max(asNonNegativeInt(left.useCount), asNonNegativeInt(right.useCount)),
        lastUsedAt: Math.max(asTimestamp(left.lastUsedAt), asTimestamp(right.lastUsedAt)),
        source: "promoted"
      };
    }
  ).sort(function(a, b) {
    return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
  }).slice(0, MAX_PRODUCTS);
}

function mergeProvisionalProducts(existing, incoming) {
  return mergeByKey(
    (existing || []).concat(incoming || []).map(normalizeProvisionalProduct).filter(Boolean),
    function(item) {
      return normalizeLearnedKey(item.displayName);
    },
    function(left, right) {
      return {
        id: left.id || right.id,
        displayName: left.displayName || right.displayName,
        names: uniqueTrimmedTexts((left.names || []).concat(right.names || []), MAX_ALIASES_PER_PRODUCT, MAX_ALIAS_CHARS),
        unit: right.unit || left.unit,
        price: right.price !== null && right.price !== undefined ? right.price : left.price,
        seenCount: Math.max(asNonNegativeInt(left.seenCount), asNonNegativeInt(right.seenCount)),
        lastSeenAt: Math.max(asTimestamp(left.lastSeenAt), asTimestamp(right.lastSeenAt)),
        source: "provisional"
      };
    }
  ).sort(function(a, b) {
    return (b.lastSeenAt || 0) - (a.lastSeenAt || 0);
  }).slice(0, MAX_PROVISIONAL_PRODUCTS);
}

function mergeCorrections(existing, incoming) {
  return mergeByKey(
    (existing || []).concat(incoming || []).map(normalizeCorrection).filter(Boolean),
    function(item) {
      return item.aliasKey;
    },
    function(left, right) {
      return {
        alias: right.alias || left.alias,
        aliasKey: left.aliasKey || right.aliasKey,
        displayName: right.displayName || left.displayName,
        unit: right.unit || left.unit,
        useCount: Math.max(asNonNegativeInt(left.useCount), asNonNegativeInt(right.useCount)),
        lastUsedAt: Math.max(asTimestamp(left.lastUsedAt), asTimestamp(right.lastUsedAt))
      };
    }
  ).sort(function(a, b) {
    return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
  }).slice(0, MAX_CORRECTIONS);
}

function getEmptySnapshot() {
  return {
    promotedProducts: [],
    provisionalProducts: [],
    corrections: [],
    revision: 0,
    updatedAt: 0
  };
}

function normalizeSnapshot(snapshot) {
  var safe = snapshot && typeof snapshot === "object" ? snapshot : {};

  return {
    promotedProducts: (Array.isArray(safe.promotedProducts) ? safe.promotedProducts : []).map(normalizePromotedProduct).filter(Boolean).slice(0, MAX_PRODUCTS),
    provisionalProducts: (Array.isArray(safe.provisionalProducts) ? safe.provisionalProducts : []).map(normalizeProvisionalProduct).filter(Boolean).slice(0, MAX_PROVISIONAL_PRODUCTS),
    corrections: (Array.isArray(safe.corrections) ? safe.corrections : []).map(normalizeCorrection).filter(Boolean).slice(0, MAX_CORRECTIONS),
    revision: Number(safe.revision || 0) || 0,
    updatedAt: Number(safe.updatedAt || 0) || 0
  };
}

function mergeSnapshots(existing, incoming) {
  var base = normalizeSnapshot(existing);
  var next = normalizeSnapshot(incoming);
  var merged = {
    promotedProducts: mergePromotedProducts(base.promotedProducts, next.promotedProducts),
    provisionalProducts: mergeProvisionalProducts(base.provisionalProducts, next.provisionalProducts),
    corrections: mergeCorrections(base.corrections, next.corrections),
    revision: Date.now(),
    updatedAt: Date.now()
  };

  return merged;
}

function safeParseJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch (error) {
    return null;
  }
}

function ensureFileStoreDir() {
  var dir = path.dirname(FILE_STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readFileStoreMap() {
  try {
    if (!fs.existsSync(FILE_STORE_PATH)) {
      return { scopes: {} };
    }
    var parsed = safeParseJson(fs.readFileSync(FILE_STORE_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.scopes !== "object") {
      return { scopes: {} };
    }
    return parsed;
  } catch (error) {
    return { scopes: {} };
  }
}

function writeFileStoreMap(mapData) {
  ensureFileStoreDir();
  fs.writeFileSync(FILE_STORE_PATH, JSON.stringify(mapData || { scopes: {} }, null, 2));
}

async function getBlobStore() {
  if (!blobsModule || typeof blobsModule.getStore !== "function") {
    return null;
  }

  try {
    return blobsModule.getStore({ name: BLOB_STORE_NAME });
  } catch (error) {
    try {
      return blobsModule.getStore(BLOB_STORE_NAME);
    } catch (innerError) {
      return null;
    }
  }
}

async function readSnapshotFromBlob(scopeId) {
  var store = await getBlobStore();
  if (!store) {
    return null;
  }

  try {
    if (typeof store.getJSON === "function") {
      return normalizeSnapshot(await store.getJSON(scopeId));
    }
  } catch (error) {}

  try {
    if (typeof store.get === "function") {
      var data = await store.get(scopeId, { type: "json" });
      if (data && typeof data === "object") {
        return normalizeSnapshot(data);
      }
      if (typeof data === "string") {
        return normalizeSnapshot(safeParseJson(data));
      }
    }
  } catch (error) {}

  try {
    if (typeof store.get === "function") {
      var text = await store.get(scopeId);
      if (typeof text === "string" && text) {
        return normalizeSnapshot(safeParseJson(text));
      }
    }
  } catch (error) {}

  return null;
}

async function writeSnapshotToBlob(scopeId, snapshot) {
  var store = await getBlobStore();
  if (!store) {
    return false;
  }

  try {
    if (typeof store.setJSON === "function") {
      await store.setJSON(scopeId, snapshot);
      return true;
    }
  } catch (error) {}

  try {
    if (typeof store.set === "function") {
      await store.set(scopeId, snapshot, { type: "json" });
      return true;
    }
  } catch (error) {}

  try {
    if (typeof store.set === "function") {
      await store.set(scopeId, JSON.stringify(snapshot), { contentType: "application/json" });
      return true;
    }
  } catch (error) {}

  return false;
}

async function readSnapshot(scopeId) {
  var blobSnapshot = await readSnapshotFromBlob(scopeId);
  if (blobSnapshot) {
    return {
      snapshot: blobSnapshot,
      storage: "blobs"
    };
  }

  var fileStore = readFileStoreMap();
  var scopeSnapshot = normalizeSnapshot((fileStore.scopes || {})[scopeId]);

  return {
    snapshot: scopeSnapshot,
    storage: "file"
  };
}

async function writeSnapshot(scopeId, snapshot) {
  var normalized = normalizeSnapshot(snapshot);
  var blobSaved = await writeSnapshotToBlob(scopeId, normalized);
  if (blobSaved) {
    return "blobs";
  }

  var fileStore = readFileStoreMap();
  fileStore.scopes = fileStore.scopes || {};
  fileStore.scopes[scopeId] = normalized;
  fileStore.updatedAt = Date.now();
  writeFileStoreMap(fileStore);
  return "file";
}

function getScopeIdFromEvent(event, payloadScopeId) {
  var queryScope = event && event.queryStringParameters ? event.queryStringParameters.scope : "";
  return sanitizeScopeId(queryScope || payloadScopeId || DEFAULT_SCOPE_ID);
}

exports.handler = async function(event) {
  var corsHeaders = cors.buildCorsHeaders(event, true);

  if (!cors.isAllowedOrigin(event)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Origin not allowed" })
    };
  }

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    if (event.httpMethod === "GET") {
      var scopeId = getScopeIdFromEvent(event, "");
      var readResult = await readSnapshot(scopeId);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          scopeId: scopeId,
          storage: readResult.storage,
          global: readResult.snapshot || getEmptySnapshot()
        })
      };
    }

    if ((event.body || "").length > MAX_BODY_CHARS) {
      return {
        statusCode: 413,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Payload too large" })
      };
    }

    var body = safeParseJson(event.body || "{}");
    if (!body || typeof body !== "object") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid JSON body" })
      };
    }

    var scopeIdFromBody = body.scopeId || "";
    var scopeIdFromRequest = getScopeIdFromEvent(event, scopeIdFromBody);
    var incomingState = body.state && typeof body.state === "object" ? body.state : null;

    if (!incomingState) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "state is required" })
      };
    }

    var currentRead = await readSnapshot(scopeIdFromRequest);
    var mergedSnapshot = mergeSnapshots(currentRead.snapshot || getEmptySnapshot(), incomingState);
    var storage = await writeSnapshot(scopeIdFromRequest, mergedSnapshot);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        scopeId: scopeIdFromRequest,
        storage: storage,
        global: mergedSnapshot
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error && error.message ? error.message : "Learning sync failed"
      })
    };
  }
};
