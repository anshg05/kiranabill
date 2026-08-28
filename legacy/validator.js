var FALLBACK_BILL_UNITS = ["piece", "kg", "gm", "liter", "ml", "packet", "dozen", "box", "bottle", "pouch", "bag", "can", "tin"];
var UNIT_ALIASES = {
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kg: "kg",
  gram: "gm",
  grams: "gm",
  gm: "gm",
  g: "gm",
  litre: "liter",
  litres: "liter",
  liter: "liter",
  liters: "liter",
  ltr: "liter",
  l: "liter",
  ml: "ml",
  piece: "piece",
  pieces: "piece",
  pc: "piece",
  pcs: "piece",
  packet: "packet",
  packets: "packet",
  pack: "packet",
  packs: "packet",
  pkt: "packet",
  pkts: "packet",
  dozen: "dozen",
  box: "box",
  boxes: "box",
  bottle: "bottle",
  bottles: "bottle",
  pouch: "pouch",
  pouches: "pouch",
  bag: "bag",
  bags: "bag",
  can: "can",
  cans: "can",
  tin: "tin",
  tins: "tin"
};
var REVIEW_REASON_LABELS = {
  unknown_product: "Unknown product",
  weak_match: "Weak product match",
  incomplete_item: "Incomplete item",
  invalid_qty: "Invalid quantity",
  invalid_unit: "Invalid unit",
  unit_mismatch: "Unit mismatch",
  missing_rate: "Missing rate",
  missing_total: "Missing total",
  unusual_rate: "Unusual rate",
  unusual_total: "Unusual total",
  missing_name: "Missing item name"
};
var validatorCatalogCache = null;
var UNIT_CONVERSIONS = {
  kg: { base: "weight", factor: 1000 },
  gm: { base: "weight", factor: 1 },
  liter: { base: "volume", factor: 1000 },
  ml: { base: "volume", factor: 1 }
};

function normalizeMatchKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulCatalogAlias(value) {
  var text = String(value || "").trim();

  if (!text) {
    return false;
  }

  return !(/[\u00e0\u00e2\u00f0]/.test(text) && !(/[\u0900-\u097f]/.test(text)));
}

function isShortSingleTokenKey(value) {
  var normalized = normalizeMatchKey(value);
  var tokens = normalized ? normalized.split(" ") : [];

  return tokens.length === 1 && tokens[0].length <= 6;
}

function getMinimumMatchScore(targetKey) {
  if (!targetKey) {
    return 1;
  }

  var tokens = targetKey.split(" ");

  if (tokens.length === 1) {
    if (tokens[0].length <= 4) {
      return 0.98;
    }
    if (tokens[0].length <= 6) {
      return 0.92;
    }
  }

  return 0.74;
}

function buildMatchVariants(value) {
  var base = normalizeMatchKey(value);
  var variants = {};

  if (!base) {
    return [];
  }

  function addVariant(nextValue) {
    if (nextValue) {
      variants[nextValue] = true;
    }
  }

  addVariant(base);
  addVariant(base.replace(/ph/g, "f"));
  addVariant(base.replace(/f/g, "ph"));
  addVariant(base.replace(/w/g, "v"));
  addVariant(base.replace(/v/g, "w"));

  return Object.keys(variants);
}

function getAllowedBillUnits() {
  var units = typeof BILL_UNITS !== "undefined" && BILL_UNITS && BILL_UNITS.length
    ? BILL_UNITS
    : FALLBACK_BILL_UNITS;

  return units.map(function(unit) {
    return String(unit || "").toLowerCase();
  });
}

function normalizeUnit(value, fallbackUnit) {
  var normalizedKey = normalizeMatchKey(value);
  var normalizedFallback = String(fallbackUnit || "piece").toLowerCase();

  if (normalizedKey && UNIT_ALIASES[normalizedKey]) {
    return UNIT_ALIASES[normalizedKey];
  }

  if (getAllowedBillUnits().indexOf(normalizedFallback) !== -1) {
    return normalizedFallback;
  }

  return "piece";
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  var parsed = Number(value);
  return isNaN(parsed) ? null : +parsed.toFixed(3);
}

function roundMoney(value) {
  return value === null || value === undefined ? null : +Number(value).toFixed(2);
}

function calculateLineTotal(qty, unit, rate, matchedUnit, defaultRate) {
  var normalizedQty = normalizeNumber(qty);
  var normalizedRate = normalizeNumber(rate);
  var normalizedUnit = normalizeUnit(unit, matchedUnit || unit || "piece");
  var normalizedMatchedUnit = normalizeUnit(matchedUnit, normalizedUnit);

  if (normalizedQty === null || normalizedRate === null) {
    return null;
  }

  var rateBasisUnit = inferRateBasisUnit(normalizedUnit, normalizedMatchedUnit, normalizedRate, normalizeNumber(defaultRate));
  var effectiveQty = convertQuantityBetweenUnits(normalizedQty, normalizedUnit, rateBasisUnit);

  return roundMoney(effectiveQty * normalizedRate);
}

function getUnitConversion(unit) {
  return UNIT_CONVERSIONS[String(unit || "").toLowerCase()] || null;
}

function areConvertibleUnits(fromUnit, toUnit) {
  var fromConversion = getUnitConversion(fromUnit);
  var toConversion = getUnitConversion(toUnit);

  return Boolean(fromConversion && toConversion && fromConversion.base === toConversion.base);
}

function convertQuantityBetweenUnits(qty, fromUnit, toUnit) {
  var fromConversion = getUnitConversion(fromUnit);
  var toConversion = getUnitConversion(toUnit);

  if (qty === null || !fromConversion || !toConversion || fromConversion.base !== toConversion.base) {
    return qty;
  }

  return +(qty * fromConversion.factor / toConversion.factor).toFixed(6);
}

function inferRateBasisUnit(unit, matchedUnit, rate, defaultRate) {
  var normalizedUnit = String(unit || "").toLowerCase();
  var normalizedMatchedUnit = String(matchedUnit || "").toLowerCase();

  if (normalizedUnit === "gm" && rate !== null && defaultRate !== null && rate >= defaultRate * 10) {
    return "kg";
  }

  if (normalizedUnit === "ml" && rate !== null && defaultRate !== null && rate >= defaultRate * 10) {
    return "liter";
  }

  if (normalizedMatchedUnit === "gm" && normalizedUnit === "kg") {
    return "kg";
  }

  if (normalizedMatchedUnit === "ml" && normalizedUnit === "liter") {
    return "liter";
  }

  return normalizedUnit;
}

function isLooseMeasureUnit(unit) {
  var normalizedUnit = String(unit || "").toLowerCase();
  return normalizedUnit === "kg" || normalizedUnit === "gm" || normalizedUnit === "liter" || normalizedUnit === "ml";
}

function shouldKeepOnlyTotalForItem(raw, matchedUnit, priceType) {
  if (priceType !== "total" || !isLooseMeasureUnit(matchedUnit)) {
    return false;
  }

  var rawQty = normalizeNumber(raw.qty);
  var rawTotal = normalizeNumber(raw.total);
  var rawRate = normalizeNumber(raw.rate);
  var rawUnit = String(raw.unit || "").trim();

  if (rawRate !== null || rawTotal === null) {
    return false;
  }

  if (!rawUnit && (rawQty === null || rawQty === 1)) {
    return true;
  }

  return rawQty !== null && rawTotal !== null && rawQty === rawTotal && isLooseMeasureUnit(rawUnit || matchedUnit);
}

function normalizePriceType(priceType, rate, total) {
  var normalized = String(priceType || "").toLowerCase().trim();

  if (normalized === "rate" || normalized === "total" || normalized === "default" || normalized === "unknown") {
    return normalized;
  }
  if (rate !== null && rate !== undefined) {
    return "rate";
  }
  if (total !== null && total !== undefined) {
    return "total";
  }
  return "default";
}

function hasArabicScript(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function cleanValidatorDisplayName(displayName) {
  return String(displayName || "")
    .replace(/\s*\((?:Rs)?[^)]*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getProductLearningBoost(product) {
  if (!product) {
    return 0;
  }

  if (product.source === "promoted") {
    var promotedUse = Number(product.useCount || 0) || 0;
    return Math.min(promotedUse * 0.01, 0.08);
  }

  if (product.source === "provisional") {
    var provisionalUse = Number(product.seenCount || 0) || 0;
    return Math.min(provisionalUse * 0.006, 0.04);
  }

  return 0;
}

function buildValidatorCatalog() {
  var learnedVersion = typeof getLearnedProductsVersion === "function" ? getLearnedProductsVersion() : "0";

  if (validatorCatalogCache && validatorCatalogCache.learnedVersion === learnedVersion) {
    return validatorCatalogCache;
  }

  var baseProducts = Array.isArray(PRODUCTS) ? PRODUCTS : [];
  var promotedProducts = typeof getLearnedProducts === "function" ? getLearnedProducts() : [];
  var provisionalProducts = typeof getProvisionalProducts === "function" ? getProvisionalProducts() : [];
  var learnedCorrections = typeof getLearnedCorrections === "function" ? getLearnedCorrections() : [];
  var products = baseProducts.concat(promotedProducts).concat(provisionalProducts);
  var exactMap = {};
  var searchEntries = [];
  var productByDisplayKey = {};

  products.forEach(function(product) {
    productByDisplayKey[normalizeMatchKey(product.displayName)] = product;
    var aliases = [product.displayName].concat(product.names || []).map(function(name) {
      return String(name || "").trim();
    }).filter(isUsefulCatalogAlias);

    aliases.forEach(function(alias) {
      buildMatchVariants(alias).forEach(function(variant) {
        if (!exactMap[variant]) {
          exactMap[variant] = product;
        }
      });

      if (product.source !== "provisional") {
        searchEntries.push({
          product: product,
          key: normalizeMatchKey(alias),
          boost: getProductLearningBoost(product)
        });
      }
    });
  });

  learnedCorrections.forEach(function(correction) {
    var targetProduct = productByDisplayKey[normalizeMatchKey(correction.displayName)];

    if (!targetProduct || !correction.aliasKey) {
      return;
    }

    exactMap[correction.aliasKey] = targetProduct;
    if (targetProduct.source !== "provisional") {
      searchEntries.push({
        product: targetProduct,
        key: correction.aliasKey,
        boost: Math.min((Number(correction.useCount || 0) || 0) * 0.01, 0.08)
      });
    }
  });

  validatorCatalogCache = {
    exactMap: exactMap,
    searchEntries: searchEntries,
    learnedVersion: learnedVersion
  };

  return validatorCatalogCache;
}



function scoreMatchKey(targetKey, candidateKey) {
  if (!targetKey || !candidateKey) {
    return 0;
  }
  if (targetKey === candidateKey) {
    return 1;
  }

  if (isShortSingleTokenKey(targetKey) || isShortSingleTokenKey(candidateKey)) {
    var shorterLength = Math.min(targetKey.length, candidateKey.length);
    var longerLength = Math.max(targetKey.length, candidateKey.length);

    if ((candidateKey.indexOf(targetKey) !== -1 || targetKey.indexOf(candidateKey) !== -1) && shorterLength >= 5 && (longerLength - shorterLength) <= 1) {
      return 0.88;
    }

    return 0;
  }

  if (candidateKey.indexOf(targetKey) !== -1 || targetKey.indexOf(candidateKey) !== -1) {
    return 0.92;
  }

  var targetTokens = targetKey.split(" ");
  var candidateTokens = candidateKey.split(" ");
  var overlap = targetTokens.filter(function(token) {
    return candidateTokens.indexOf(token) !== -1;
  }).length;

  if (!overlap) {
    return 0;
  }

  return overlap / Math.max(targetTokens.length, candidateTokens.length);
}

function containsAnyKeyword(text, keywords) {
  var normalized = normalizeMatchKey(text);

  return keywords.some(function(keyword) {
    return normalized.indexOf(normalizeMatchKey(keyword)) !== -1;
  });
}

var CATEGORY_GUARDS = [
  {
    name: "dal",
    keywords: ["dal", "daal", "दाल", "मोगर", "मगर", "mogar", "magar", "lentil", "urad", "moong", "masoor", "chana dal", "arhar", "toor", "tuvar"]
  },
  {
    name: "oil",
    keywords: ["tel", "oil", "तेल", "ghee", "घी", "vanaspati", "dalda", "butter", "makhan", "मक्खन"]
  },
  {
    name: "masala",
    keywords: ["masala", "spice", "मसाला", "ajwain", "अजवाइन", "jeera", "जीरा", "saunf", "सौंफ", "saunth", "सोंठ", "mirch", "मिर्च", "haldi", "हल्दी", "dhaniya", "धनिया"]
  },
  {
    name: "tea",
    keywords: ["chai", "tea", "चाय", "patti", "पत्ती", "leaf", "dust tea"]
  },
  {
    name: "grain",
    keywords: ["chawal", "rice", "चावल", "gehun", "गेहूं", "gehu", "aata", "आटा", "atta", "kanki", "poha", "पोहा", "makka", "मक्का", "jowar", "bajra"]
  },
  {
    name: "soap",
    keywords: ["sabun", "soap", "साबुन", "detergent", "surf", "wheel", "rin", "vim", "bartan bar", "bartan powder"]
  }
];

function getCategoryMatches(text) {
  return CATEGORY_GUARDS.filter(function(category) {
    return containsAnyKeyword(text, category.keywords);
  }).map(function(category) {
    return category.name;
  });
}

function shouldRejectCategoryMismatch(spokenName, match) {
  if (!spokenName || !match || !match.product || match.source !== "fuzzy") {
    return false;
  }

  var spokenCategories = getCategoryMatches(spokenName);
  var matchedCategories = getCategoryMatches(match.product.displayName + " " + (match.product.names || []).join(" "));

  if (!spokenCategories.length) {
    return false;
  }

  return !spokenCategories.some(function(category) {
    return matchedCategories.indexOf(category) !== -1;
  });
}

function getBestCatalogMatch(displayName) {
  var variants = buildMatchVariants(displayName);
  var catalog = buildValidatorCatalog();
  var bestMatch = null;
  var normalizedDisplayName = normalizeMatchKey(displayName);
  var minimumScore = getMinimumMatchScore(normalizedDisplayName);

  for (var i = 0; i < variants.length; i++) {
    if (catalog.exactMap[variants[i]]) {
      var exactProduct = catalog.exactMap[variants[i]];
      return {
        product: exactProduct,
        score: 1,
        source: exactProduct && exactProduct.source === "provisional" ? "provisional_alias" : "alias"
      };
    }
  }

  variants.forEach(function(variant) {
    catalog.searchEntries.forEach(function(entry) {
      var baseScore = scoreMatchKey(variant, entry.key);
      if (baseScore <= 0) {
        return;
      }

      var score = Math.min(1, baseScore + (entry.boost || 0));
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          product: entry.product,
          score: score,
          source: "fuzzy"
        };
      }
    });
  });

  if (bestMatch && bestMatch.score >= minimumScore) {
    if (shouldRejectCategoryMismatch(displayName, bestMatch)) {
      return null;
    }
    return bestMatch;
  }

  return null;
}

function uniqReasons(reasons) {
  var seen = {};
  return reasons.filter(function(reason) {
    if (!reason || seen[reason]) {
      return false;
    }
    seen[reason] = true;
    return true;
  });
}

function formatReviewReasons(reasons) {
  return (reasons || []).map(function(reason) {
    return REVIEW_REASON_LABELS[reason] || reason;
  }).join(", ");
}

function sanitizeParsedItem(rawItem) {
  var raw = rawItem || {};
  var cleanedName = cleanValidatorDisplayName(raw.displayName || raw.spokenName || "");
  var originalDisplayName = cleanValidatorDisplayName(raw.displayName || "");
  var spokenName = cleanValidatorDisplayName(raw.spokenName || raw.displayName || "");
  var rawIsCustom = Boolean(raw.isCustom);
  var spokenMatch = spokenName ? getBestCatalogMatch(spokenName) : null;
  if (spokenName && hasArabicScript(spokenName) && !spokenMatch) {
    rawIsCustom = true;
    cleanedName = spokenName;
  }
  var match = cleanedName ? getBestCatalogMatch(cleanedName) : null;
  var matchedProduct = match ? match.product : null;
  var shouldAdoptCatalogMatch = Boolean(matchedProduct) && (!rawIsCustom || match.source === "alias" || match.source === "provisional_alias");

  if (!shouldAdoptCatalogMatch) {
    matchedProduct = null;
    match = null;
  }

  var matchedUnit = matchedProduct ? normalizeUnit(matchedProduct.unit, matchedProduct.unit) : "piece";
  var defaultRate = matchedProduct ? normalizeNumber(matchedProduct.price) : null;
  var qty = normalizeNumber(raw.qty);
  var rate = normalizeNumber(raw.rate);
  var total = normalizeNumber(raw.total);
  var priceType = normalizePriceType(raw.priceType, rate, total);
  var reviewReasons = [];
  var rawUnit = raw.unit;
  var unit = normalizeUnit(rawUnit, matchedUnit);
  var effectiveQty = qty;
  var displayName = matchedProduct ? String(matchedProduct.displayName || "").trim() : cleanedName;
  var explicitUnit = rawUnit !== null && rawUnit !== undefined && String(rawUnit).trim() !== "";
  var totalOnlyLooseItem = shouldKeepOnlyTotalForItem(raw, matchedUnit, priceType);
  var incompleteUnknownItem = priceType === "unknown";

  if (!displayName) {
    displayName = "Unknown Item";
    reviewReasons.push("missing_name");
  }

  if (!totalOnlyLooseItem && !incompleteUnknownItem && (qty === null || qty <= 0)) {
    qty = 1;
    reviewReasons.push("invalid_qty");
  }

  if (totalOnlyLooseItem) {
    qty = null;
    unit = "";
    explicitUnit = false;
  }

  if (incompleteUnknownItem) {
    qty = qty === null ? null : qty;
    unit = explicitUnit ? unit : "";
    rate = null;
    reviewReasons.push("incomplete_item");
  }

  if (unit && getAllowedBillUnits().indexOf(unit) === -1) {
    unit = matchedUnit || "piece";
    reviewReasons.push("invalid_unit");
  }

  if (explicitUnit && matchedProduct && unit !== matchedUnit && !areConvertibleUnits(unit, matchedUnit)) {
    reviewReasons.push("unit_mismatch");
  }

  if (priceType === "default" && rate === null && defaultRate !== null) {
    rate = defaultRate;
  }

  if ((priceType === "rate" || priceType === "default") && qty !== null) {
    var rateBasisUnit = inferRateBasisUnit(unit, matchedUnit, rate, defaultRate);
    effectiveQty = convertQuantityBetweenUnits(qty, unit, rateBasisUnit);
  }

  if ((priceType === "rate" || priceType === "default") && rate !== null) {
    total = calculateLineTotal(qty, unit, rate, matchedUnit, defaultRate);
  }

  if (priceType === "total") {
    if (total === null && rate !== null) {
      total = roundMoney(effectiveQty * rate);
    }
    rate = null;
  }

  if (total === null && rate !== null) {
    total = roundMoney(effectiveQty * rate);
  }

  if ((priceType === "rate" || priceType === "default") && rate === null) {
    reviewReasons.push("missing_rate");
  }

  if (total === null) {
    if (!incompleteUnknownItem) {
      reviewReasons.push("missing_total");
    }
    total = 0;
  }

  if (!matchedProduct) {
    reviewReasons.push(rawIsCustom ? "weak_match" : "unknown_product");
  } else if (match.score < 0.9 || matchedProduct.source === "provisional") {
    reviewReasons.push("weak_match");
  }

  if (matchedProduct && defaultRate !== null && rate !== null && priceType !== "total") {
    if (rate > defaultRate * 3 || rate < Math.max(0.1, defaultRate * 0.2)) {
      reviewReasons.push("unusual_rate");
    }
  }

  if (matchedProduct && defaultRate !== null && priceType === "total" && total !== null && qty !== null) {
    var expectedTotal = roundMoney(qty * defaultRate);
    if (expectedTotal > 0 && (total > expectedTotal * 3 || total < expectedTotal * 0.2)) {
      reviewReasons.push("unusual_total");
    }
  }

  reviewReasons = uniqReasons(reviewReasons);

  return {
    displayName: displayName,
    originalDisplayName: originalDisplayName || displayName,
    spokenName: spokenName || displayName,
    qty: qty,
    unit: unit,
    rate: rate,
    total: total,
    isCustom: rawIsCustom || !matchedProduct || (matchedProduct && matchedProduct.source === "provisional"),
    priceType: priceType,
    catalogId: matchedProduct ? matchedProduct.id : null,
    matchSource: matchedProduct ? match.source : (rawIsCustom ? "custom" : "unmatched"),
    matchScore: matchedProduct ? match.score : 0,
    reviewReasons: reviewReasons,
    needsReview: reviewReasons.length > 0
  };
}

function validateParsedItems(items) {
  return (items || []).map(function(item) {
    return sanitizeParsedItem(item);
  }).filter(function(item) {
    return item && item.displayName;
  });
}

function applyValidationToBillItem(item) {
  if (!item) {
    return item;
  }

  var validated = sanitizeParsedItem(item);
  Object.keys(validated).forEach(function(key) {
    item[key] = validated[key];
  });
  return item;
}



