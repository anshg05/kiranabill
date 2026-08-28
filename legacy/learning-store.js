var SHOP_CATALOG_KEY = "kb_shopCatalog";
var SHOP_PROVISIONAL_CATALOG_KEY = "kb_shopProvisionalCatalog";
var SHOP_CATALOG_VERSION_KEY = "kb_shopCatalogVersion";
var SHOP_CORRECTIONS_KEY = "kb_shopCorrections";
var LEARNING_CLIENT_ID_KEY = "kb_learningClientId";
var LEARNING_SCOPE_STORAGE_KEY = "kb_learningScopeId";

var PROVISIONAL_PROMOTION_THRESHOLD = 3;
var LEARNING_SYNC_ENDPOINT = "/.netlify/functions/learning-sync";
var LEARNING_SYNC_DEBOUNCE_MS = 3000;

var learningSyncTimer = null;
var learningSyncInFlight = false;
var learningSyncQueued = false;
var learningSyncInitialized = false;
var applyingRemoteLearningState = false;

function normalizeLearnedKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLearnedProductsVersion() {
  return localStorage.getItem(SHOP_CATALOG_VERSION_KEY) || "0";
}

function bumpLearnedCatalogVersion() {
  localStorage.setItem(SHOP_CATALOG_VERSION_KEY, String(Date.now()));
}

function buildUniqueAliasList(displayName, aliases) {
  var uniqueAliases = {};
  [displayName].concat(Array.isArray(aliases) ? aliases : []).forEach(function(alias) {
    var cleaned = String(alias || "").trim();
    if (cleaned) {
      uniqueAliases[cleaned] = true;
    }
  });

  return Object.keys(uniqueAliases);
}

function normalizePromotedProduct(product) {
  if (!product || !product.displayName) {
    return null;
  }

  var displayName = String(product.displayName).trim();

  return {
    id: product.id || ("shop-" + normalizeLearnedKey(displayName).replace(/\s+/g, "-") + "-" + Date.now()),
    displayName: displayName,
    names: buildUniqueAliasList(displayName, product.names),
    unit: String(product.unit || "piece").toLowerCase(),
    price: product.price === null || product.price === undefined || product.price === "" ? null : Number(product.price),
    useCount: Number(product.useCount || 0) || 0,
    lastUsedAt: Number(product.lastUsedAt || Date.now()) || Date.now(),
    source: "promoted"
  };
}

function normalizeProvisionalProduct(product) {
  if (!product || !product.displayName) {
    return null;
  }

  var displayName = String(product.displayName).trim();

  return {
    id: product.id || ("prov-" + normalizeLearnedKey(displayName).replace(/\s+/g, "-") + "-" + Date.now()),
    displayName: displayName,
    names: buildUniqueAliasList(displayName, product.names),
    unit: String(product.unit || "piece").toLowerCase(),
    price: product.price === null || product.price === undefined || product.price === "" ? null : Number(product.price),
    seenCount: Number(product.seenCount || product.useCount || 0) || 0,
    lastSeenAt: Number(product.lastSeenAt || product.lastUsedAt || Date.now()) || Date.now(),
    source: "provisional"
  };
}

function normalizeLearnedCorrection(correction) {
  if (!correction || !correction.alias || !correction.displayName) {
    return null;
  }

  return {
    alias: String(correction.alias).trim(),
    aliasKey: normalizeLearnedKey(correction.alias),
    displayName: String(correction.displayName).trim(),
    unit: correction.unit ? String(correction.unit).toLowerCase() : "",
    useCount: Number(correction.useCount || 0) || 0,
    lastUsedAt: Number(correction.lastUsedAt || Date.now()) || Date.now()
  };
}

function loadPromotedProducts() {
  try {
    var parsed = JSON.parse(localStorage.getItem(SHOP_CATALOG_KEY) || "[]");
    return (parsed || []).map(normalizePromotedProduct).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function savePromotedProducts(products) {
  var normalized = (products || []).map(normalizePromotedProduct).filter(Boolean);
  localStorage.setItem(SHOP_CATALOG_KEY, JSON.stringify(normalized));
  bumpLearnedCatalogVersion();
  scheduleLearningCloudSync("promoted-save");
}

function loadProvisionalProducts() {
  try {
    var parsed = JSON.parse(localStorage.getItem(SHOP_PROVISIONAL_CATALOG_KEY) || "[]");
    return (parsed || []).map(normalizeProvisionalProduct).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function saveProvisionalProducts(products) {
  var normalized = (products || []).map(normalizeProvisionalProduct).filter(Boolean);
  localStorage.setItem(SHOP_PROVISIONAL_CATALOG_KEY, JSON.stringify(normalized));
  bumpLearnedCatalogVersion();
  scheduleLearningCloudSync("provisional-save");
}

function loadLearnedCorrections() {
  try {
    var parsed = JSON.parse(localStorage.getItem(SHOP_CORRECTIONS_KEY) || "[]");
    return (parsed || []).map(normalizeLearnedCorrection).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function saveLearnedCorrections(corrections) {
  var normalized = (corrections || []).map(normalizeLearnedCorrection).filter(Boolean);
  localStorage.setItem(SHOP_CORRECTIONS_KEY, JSON.stringify(normalized));
  bumpLearnedCatalogVersion();
  scheduleLearningCloudSync("corrections-save");
}

function getLearnedProducts() {
  return loadPromotedProducts();
}

function getProvisionalProducts() {
  return loadProvisionalProducts();
}

function getLearnedCorrections() {
  return loadLearnedCorrections();
}

function upsertLearnedProduct(nextProduct) {
  var promotedProducts = loadPromotedProducts();
  var targetKey = normalizeLearnedKey(nextProduct.displayName);
  var existing = promotedProducts.find(function(product) {
    return normalizeLearnedKey(product.displayName) === targetKey;
  });

  if (existing) {
    existing.names = Array.from(new Set((existing.names || []).concat(nextProduct.names || []).concat([nextProduct.displayName])));
    existing.unit = nextProduct.unit || existing.unit;
    existing.price = nextProduct.price !== null && nextProduct.price !== undefined ? nextProduct.price : existing.price;
    existing.useCount = (existing.useCount || 0) + 1;
    existing.lastUsedAt = Date.now();
  } else {
    promotedProducts.push(normalizePromotedProduct({
      id: nextProduct.id,
      displayName: nextProduct.displayName,
      names: nextProduct.names,
      unit: nextProduct.unit,
      price: nextProduct.price,
      useCount: 1,
      lastUsedAt: Date.now()
    }));
  }

  savePromotedProducts(promotedProducts);
}

function rememberProductCorrection(alias, displayName, options) {
  var aliasText = String(alias || "").trim();
  var targetName = String(displayName || "").trim();

  if (!aliasText || !targetName) {
    return;
  }

  if (normalizeLearnedKey(aliasText) === normalizeLearnedKey(targetName)) {
    return;
  }

  var metadata = options || {};
  var corrections = loadLearnedCorrections();
  var aliasKey = normalizeLearnedKey(aliasText);
  var existing = corrections.find(function(correction) {
    return correction.aliasKey === aliasKey;
  });

  if (existing) {
    existing.displayName = targetName;
    existing.unit = metadata.unit ? String(metadata.unit).toLowerCase() : existing.unit;
    existing.useCount = (existing.useCount || 0) + 1;
    existing.lastUsedAt = Date.now();
  } else {
    corrections.push({
      alias: aliasText,
      aliasKey: aliasKey,
      displayName: targetName,
      unit: metadata.unit ? String(metadata.unit).toLowerCase() : "",
      useCount: 1,
      lastUsedAt: Date.now()
    });
  }

  saveLearnedCorrections(corrections);
}

function shouldTrackProvisionalItem(item) {
  if (!item) {
    return false;
  }

  return Boolean(item.needsReview || item.isCustom || !item.catalogId || item.matchSource === "unmatched" || item.matchSource === "custom");
}

function learnStableAliasFromItem(item) {
  if (!item || item.needsReview || !item.displayName) {
    return 0;
  }

  var targetName = String(item.displayName || "").trim();
  if (!targetName) {
    return 0;
  }

  var aliasCandidates = [item.spokenName, item.originalDisplayName].filter(Boolean);
  var learnedCount = 0;

  aliasCandidates.forEach(function(alias) {
    var aliasText = String(alias || "").trim();
    if (!aliasText) {
      return;
    }

    if (normalizeLearnedKey(aliasText) === normalizeLearnedKey(targetName)) {
      return;
    }

    rememberProductCorrection(aliasText, targetName, { unit: item.unit || "" });
    learnedCount += 1;
  });

  return learnedCount;
}

function upsertProvisionalProduct(nextProduct) {
  var provisionalProducts = loadProvisionalProducts();
  var targetKey = normalizeLearnedKey(nextProduct.displayName);
  var existing = provisionalProducts.find(function(product) {
    return normalizeLearnedKey(product.displayName) === targetKey;
  });

  if (existing) {
    existing.names = Array.from(new Set((existing.names || []).concat(nextProduct.names || []).concat([nextProduct.displayName])));
    existing.unit = nextProduct.unit || existing.unit;
    if (nextProduct.price !== null && nextProduct.price !== undefined) {
      existing.price = nextProduct.price;
    }
    existing.seenCount = (existing.seenCount || 0) + 1;
    existing.lastSeenAt = Date.now();
  } else {
    existing = normalizeProvisionalProduct({
      id: nextProduct.id,
      displayName: nextProduct.displayName,
      names: nextProduct.names,
      unit: nextProduct.unit,
      price: nextProduct.price,
      seenCount: 1,
      lastSeenAt: Date.now()
    });
    provisionalProducts.push(existing);
  }

  var promoted = false;
  var promotedName = "";

  if ((existing.seenCount || 0) >= PROVISIONAL_PROMOTION_THRESHOLD) {
    promoted = true;
    promotedName = existing.displayName;
    provisionalProducts = provisionalProducts.filter(function(product) {
      return normalizeLearnedKey(product.displayName) !== targetKey;
    });

    upsertLearnedProduct({
      displayName: existing.displayName,
      names: existing.names,
      unit: existing.unit,
      price: existing.price
    });
  }

  saveProvisionalProducts(provisionalProducts);

  return {
    promoted: promoted,
    promotedName: promotedName
  };
}

function isPromotedCatalogId(catalogId) {
  var idText = String(catalogId || "").trim().toLowerCase();
  return idText.indexOf("shop-") === 0;
}

function learnBillItem(item) {
  if (!item || !item.displayName) {
    return;
  }

  if (item.catalogId && !item.isCustom && !isPromotedCatalogId(item.catalogId)) {
    return;
  }

  upsertLearnedProduct({
    displayName: item.displayName,
    names: [item.displayName, item.spokenName, item.originalDisplayName].filter(Boolean),
    unit: item.unit || "piece",
    price: item.rate !== null && item.rate !== undefined ? item.rate : null
  });
}

function learnFromBillItems(items) {
  (items || []).forEach(function(item) {
    learnBillItem(item);
  });
}

function commitPendingCorrectionsFromBillItems(items) {
  (items || []).forEach(function(item) {
    (item && item.pendingCorrections ? item.pendingCorrections : []).forEach(function(correction) {
      if (correction && correction.alias && correction.displayName) {
        rememberProductCorrection(correction.alias, correction.displayName, { unit: correction.unit || (item && item.unit) || "" });
      }
    });
    if (item) {
      item.pendingCorrections = [];
    }
  });
}

function learnFromFinalizedBillItems(items) {
  var finalizedItems = (items || []).filter(Boolean);
  var stats = {
    trackedCount: 0,
    provisionalCount: 0,
    promotedCount: 0,
    promotedNames: [],
    autoCorrectionCount: 0
  };

  commitPendingCorrectionsFromBillItems(finalizedItems);

  finalizedItems.forEach(function(item) {
    stats.trackedCount += 1;
    stats.autoCorrectionCount += learnStableAliasFromItem(item);

    if (shouldTrackProvisionalItem(item)) {
      stats.provisionalCount += 1;
      var provisionalResult = upsertProvisionalProduct({
        displayName: item.displayName,
        names: [item.displayName, item.spokenName, item.originalDisplayName].filter(Boolean),
        unit: item.unit || "piece",
        price: item.rate !== null && item.rate !== undefined ? item.rate : null
      });

      if (provisionalResult.promoted) {
        stats.promotedCount += 1;
        stats.promotedNames.push(provisionalResult.promotedName);
      }
      return;
    }

    learnBillItem(item);
  });

  return stats;
}

function exportLearnedProducts() {
  return JSON.stringify(loadPromotedProducts(), null, 2);
}

function importLearnedProducts(jsonText) {
  var parsed = JSON.parse(jsonText || "[]");
  savePromotedProducts(parsed);
  return loadPromotedProducts();
}

function exportLearningBackup() {
  return JSON.stringify({
    promotedProducts: loadPromotedProducts(),
    provisionalProducts: loadProvisionalProducts(),
    corrections: loadLearnedCorrections()
  }, null, 2);
}

function importLearningBackup(jsonText) {
  var parsed = JSON.parse(jsonText || "{}");

  if (Array.isArray(parsed.promotedProducts)) {
    savePromotedProducts(parsed.promotedProducts);
  } else if (Array.isArray(parsed.products)) {
    savePromotedProducts(parsed.products);
  }

  if (Array.isArray(parsed.provisionalProducts)) {
    saveProvisionalProducts(parsed.provisionalProducts);
  }

  if (Array.isArray(parsed.corrections)) {
    saveLearnedCorrections(parsed.corrections);
  }

  scheduleLearningCloudSync("import");

  return {
    promotedProducts: loadPromotedProducts(),
    provisionalProducts: loadProvisionalProducts(),
    corrections: loadLearnedCorrections()
  };
}

function getProvisionalPromotionThreshold() {
  return PROVISIONAL_PROMOTION_THRESHOLD;
}

function getProvisionalPromotionCandidates() {
  return loadProvisionalProducts().slice().sort(function(a, b) {
    return (b.seenCount || 0) - (a.seenCount || 0);
  });
}

function generateLearningClientId() {
  if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") {
    return String(crypto.randomUUID()).toLowerCase();
  }

  return ["kb", Date.now().toString(36), Math.random().toString(36).slice(2, 10)].join("-");
}

function getLearningClientId() {
  var existing = String(localStorage.getItem(LEARNING_CLIENT_ID_KEY) || "").trim();
  if (existing) {
    return existing;
  }

  var created = generateLearningClientId();
  localStorage.setItem(LEARNING_CLIENT_ID_KEY, created);
  return created;
}

function sanitizeLearningScopeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function getLearningScopeId() {
  var existing = sanitizeLearningScopeId(localStorage.getItem(LEARNING_SCOPE_STORAGE_KEY));
  if (existing) {
    return existing;
  }

  var configuredScope = sanitizeLearningScopeId(window.KB_LEARNING_SCOPE || "");
  if (configuredScope) {
    localStorage.setItem(LEARNING_SCOPE_STORAGE_KEY, configuredScope);
    return configuredScope;
  }

  localStorage.setItem(LEARNING_SCOPE_STORAGE_KEY, "global");
  return "global";
}

function getLearningSnapshot() {
  return {
    promotedProducts: loadPromotedProducts(),
    provisionalProducts: loadProvisionalProducts(),
    corrections: loadLearnedCorrections()
  };
}

function normalizeArrayByKey(items, keyFn, mergeFn) {
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

function mergeProductLists(localList, remoteList, isPromoted) {
  var localNormalized = (localList || []).map(function(item) {
    return isPromoted ? normalizePromotedProduct(item) : normalizeProvisionalProduct(item);
  }).filter(Boolean);
  var remoteNormalized = (remoteList || []).map(function(item) {
    return isPromoted ? normalizePromotedProduct(item) : normalizeProvisionalProduct(item);
  }).filter(Boolean);
  var countField = isPromoted ? "useCount" : "seenCount";
  var timeField = isPromoted ? "lastUsedAt" : "lastSeenAt";

  return normalizeArrayByKey(
    localNormalized.concat(remoteNormalized),
    function(item) {
      return normalizeLearnedKey(item.displayName);
    },
    function(existing, incoming) {
      return Object.assign({}, existing, {
        names: Array.from(new Set((existing.names || []).concat(incoming.names || []).concat([existing.displayName, incoming.displayName]))),
        unit: incoming.unit || existing.unit,
        price: incoming.price !== null && incoming.price !== undefined ? incoming.price : existing.price,
        source: existing.source,
        [countField]: Math.max(Number(existing[countField] || 0) || 0, Number(incoming[countField] || 0) || 0),
        [timeField]: Math.max(Number(existing[timeField] || 0) || 0, Number(incoming[timeField] || 0) || 0)
      });
    }
  );
}

function mergeCorrectionLists(localList, remoteList) {
  var localNormalized = (localList || []).map(normalizeLearnedCorrection).filter(Boolean);
  var remoteNormalized = (remoteList || []).map(normalizeLearnedCorrection).filter(Boolean);

  return normalizeArrayByKey(
    localNormalized.concat(remoteNormalized),
    function(item) {
      return item.aliasKey;
    },
    function(existing, incoming) {
      return Object.assign({}, existing, {
        displayName: incoming.displayName || existing.displayName,
        unit: incoming.unit || existing.unit,
        useCount: Math.max(Number(existing.useCount || 0) || 0, Number(incoming.useCount || 0) || 0),
        lastUsedAt: Math.max(Number(existing.lastUsedAt || 0) || 0, Number(incoming.lastUsedAt || 0) || 0)
      });
    }
  );
}

function applyMergedLearningState(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  var mergedPromoted = mergeProductLists(loadPromotedProducts(), snapshot.promotedProducts, true);
  var mergedProvisional = mergeProductLists(loadProvisionalProducts(), snapshot.provisionalProducts, false);
  var mergedCorrections = mergeCorrectionLists(loadLearnedCorrections(), snapshot.corrections);

  applyingRemoteLearningState = true;
  try {
    localStorage.setItem(SHOP_CATALOG_KEY, JSON.stringify(mergedPromoted));
    localStorage.setItem(SHOP_PROVISIONAL_CATALOG_KEY, JSON.stringify(mergedProvisional));
    localStorage.setItem(SHOP_CORRECTIONS_KEY, JSON.stringify(mergedCorrections));
    bumpLearnedCatalogVersion();
  } finally {
    applyingRemoteLearningState = false;
  }
}

function buildLearningSyncPayload(reason) {
  return {
    clientId: getLearningClientId(),
    scopeId: getLearningScopeId(),
    revision: Number(getLearnedProductsVersion()) || Date.now(),
    reason: reason || "manual",
    state: getLearningSnapshot()
  };
}

function buildLearningSyncPathSuffix() {
  var scopeId = getLearningScopeId();
  var clientId = getLearningClientId();
  var query = "scope=" + encodeURIComponent(scopeId) + "&clientId=" + encodeURIComponent(clientId);
  return "?" + query;
}

function fetchLearningSync(pathSuffix, options) {
  if (typeof fetch !== "function") {
    return Promise.reject(new Error("Fetch unavailable"));
  }

  return fetch(LEARNING_SYNC_ENDPOINT + pathSuffix, options).then(function(response) {
    return response.json().then(function(data) {
      if (!response.ok || (data && data.error)) {
        throw new Error((data && data.error) || "Learning sync request failed");
      }
      return data;
    });
  });
}

function pullLearningFromCloud() {
  return fetchLearningSync(buildLearningSyncPathSuffix(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  }).then(function(data) {
    if (data && data.global) {
      applyMergedLearningState(data.global);
    }
    return data;
  }).catch(function() {
    return null;
  });
}

function pushLearningToCloud(reason) {
  if (learningSyncInFlight) {
    learningSyncQueued = true;
    return Promise.resolve(null);
  }

  learningSyncInFlight = true;

  return fetchLearningSync(buildLearningSyncPathSuffix(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildLearningSyncPayload(reason))
  }).then(function(data) {
    if (data && data.global) {
      applyMergedLearningState(data.global);
    }
    return data;
  }).catch(function() {
    return null;
  }).finally(function() {
    learningSyncInFlight = false;
    if (learningSyncQueued) {
      learningSyncQueued = false;
      scheduleLearningCloudSync("queued");
    }
  });
}

function scheduleLearningCloudSync(reason) {
  if (applyingRemoteLearningState) {
    return;
  }

  if (learningSyncTimer) {
    clearTimeout(learningSyncTimer);
  }

  learningSyncTimer = setTimeout(function() {
    learningSyncTimer = null;
    pushLearningToCloud(reason || "scheduled");
  }, LEARNING_SYNC_DEBOUNCE_MS);
}

function initializeLearningCloudSync() {
  if (learningSyncInitialized) {
    return;
  }

  learningSyncInitialized = true;
  pullLearningFromCloud().then(function() {
    scheduleLearningCloudSync("init");
  });
}

function getLearningSyncStatus() {
  return {
    initialized: learningSyncInitialized,
    inFlight: learningSyncInFlight,
    queued: learningSyncQueued,
    clientId: getLearningClientId(),
    scopeId: getLearningScopeId()
  };
}
