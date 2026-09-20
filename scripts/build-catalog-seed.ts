/**
 * Builds src/domain/catalog-seed.json from legacy/products.js.
 *
 * This script reads legacy/products.js as plain text and parses the product
 * literals and their category headers out of it, line by line. It does NOT
 * `require`/`import` legacy/products.js (18-AGENT-CONTRACT.md rule 10: never
 * import legacy/) - it treats the file purely as a one-time data source,
 * exactly as docs/14-LEGACY-REFERENCE.md describes.
 *
 * Category is TWO fields (docs/07-DECISIONS.md D12):
 *
 *   sourceCategory - the positional header text, verbatim, all 48 of them.
 *     Provenance only. Never used for guard logic. Assigned automatically by
 *     scanning which comment header a product falls under, top to bottom -
 *     see parseProducts() below.
 *
 *   guardCategory - fifteen semantic buckets plus "other" (see
 *     src/domain/catalog.ts for the full list and why it grew from seven).
 *     This is what KB-005b's validator will actually read to reject a
 *     mismatched match (e.g. a "daal" matching a soap). It is assigned by an
 *     EXPLICIT, COMMITTED MAPPING TABLE below (CATEGORY_TO_GUARD), not
 *     inferred by keyword matching - the owner wants to read every line of
 *     it and be able to disagree.
 *
 *     Several of the 48 sourceCategory headers mix genuinely different guard
 *     buckets under one heading (worst offender: "GRAINS / SEEDS", which
 *     contains actual grains, dals, spices, dry-fruit seeds, household puja
 *     items and even soap bars - see the per-id overrides below). Where that
 *     happens, CATEGORY_TO_GUARD picks the header's majority bucket and
 *     GUARD_CATEGORY_ID_OVERRIDES corrects the specific minority ids. Every
 *     override below was decided by reading the actual product it applies
 *     to, not guessed from the header name. A handful of headers split by
 *     product type rather than by a minority/majority rule (e.g.
 *     "SUGAR / SALT / JAGGERY" -> sugar is "sweet", salt is "condiment") -
 *     those are called out inline.
 *
 * This script re-implements, in fresh TypeScript, the *effect* of legacy/
 * products.js's own `cleanupProductsCatalog()` / `PRODUCT_RUNTIME_FIXES`
 * (mojibake repair, duplicate-alias removal) - not the code itself, which is
 * discarded after this one-time run, per docs/14-LEGACY-REFERENCE.md section 9.
 *
 * Run with: npm run seed:catalog
 * Commit both this script AND the JSON it produces. If a product's name,
 * category, or price ever looks wrong, re-run this script against
 * legacy/products.js to see whether the seed reproduces - don't hand-edit
 * catalog-seed.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rupeesToPaise } from "../src/domain/money.js";
import type { GuardCategory } from "../src/domain/catalog.js";

const EXPECTED_PRODUCT_COUNT = 482; // docs/14-LEGACY-REFERENCE.md section 9

interface RawProduct {
  id: number;
  names: string[];
  displayName: string;
  unit: string;
  price: number;
  sourceCategory: string | null;
}

interface SeedProduct {
  id: string;
  displayName: string;
  sourceCategory: string;
  guardCategory: GuardCategory;
  unit: string;
  suggestedPricePaise: number;
  aliases: string[];
  isActive: boolean;
}

interface ProductFix {
  displayName?: string;
  unit?: string;
  names?: string[];
  /**
   * Aliases to drop (case-insensitive) even though legacy/products.js
   * lists them for this id - for a renamed product that still carries its
   * old, now-ambiguous generic alias (KI-26): the alias itself didn't stop
   * being real legacy data, but keeping it here would make it collide
   * with the same alias on the other, still-plain-named product.
   */
  removeNames?: string[];
}

interface BuildReport {
  productsIn: number;
  productsOut: number;
  sourceCategoryCounts: Record<string, number>;
  guardCategoryCounts: Record<GuardCategory, number>;
  otherBySourceCategory: Record<string, number>;
  explicitDisplayNameOverrides: number;
  fallbackDisplayNameRepairs: number;
  garbageAliasesDropped: number;
  duplicateAliasesDropped: number;
  priceConversions: number;
  sumSourceRupees: number;
  sumOutputPaise: number;
  skipped: { id: number; reason: string }[];
}

// Transcribed verbatim from legacy/products.js (read directly, not imported -
// see file header). Per-id data overrides, not logic.
const PRODUCT_RUNTIME_FIXES: Record<number, ProductFix> = {
  89: { names: ["chai pati", "cha patti", "chaipatti"] },
  116: { names: ["kalimirch", "kali much", "kali mirchi", "kalimich"] },
  117: { names: ["ajvayan", "ajvayn"] },
  119: { names: ["soff", "sonf", "sanuf"] },
  614: { names: ["bath sabun", "bathing sabun", "bath soap"] },
  615: { names: ["bartanbar", "bartan sabun", "vim bar", "nip bar"] },
  620: { displayName: "Kanki", unit: "kg", names: ["kanki chawal", "broken rice", "कनकी", "कनकी चावल"] },
  622: {
    displayName: "Moong Mogar",
    names: ["moong moongar", "moong moger", "मूंग मोगर", "मूंग मगर", "धुली मूंग", "धुली मूंग दाल"],
  },
  624: {
    displayName: "Urad Mogar",
    names: ["urad moongar", "urad moger", "उड़द मोगर", "उरद मोगर", "उड़द मगर", "धुली उड़द दाल"],
  },
  609: { displayName: "Futana" },
  611: { displayName: "Gulab Jamun Packet" },
  613: { displayName: "Daaliya" },

  // KI-26 (docs/12-PARKED.md): ids 623 and 616 shared a displayName with
  // ids 19 and 202 respectively - two genuinely different, differently
  // priced products under the same name, not cosmetic duplicates. Blocked
  // KB-107's copy_base_catalog() from bulk-copying the full catalog into a
  // shop (unique (shop_id, lower(display_name)) violation on the second
  // row of each pair). Renamed using the disambiguating word already
  // present in each row's own aliases, not invented fresh.
  623: {
    displayName: "Masoor Daal (Khadi)", // whole/unsplit masoor - id 19 stays plain "Masoor Daal"
    // Without this, "Masoor Daal" stays a bare alias here too, colliding
    // with id 19's own alias and making "masoor daal" ambiguous by voice
    // - caught by hand-testing npm run try after the rename, exactly the
    // check a passing test suite alone would not have caught.
    removeNames: ["Masoor Daal"],
  },
  616: {
    displayName: "Agarbatti (Dhoop)", // premium dhoop variant - id 202 stays plain "Agarbatti"
    // Same reasoning as 623: "Agarbatti"/"अगरबत्ती" collide with id 202's
    // own aliases, and "Incense sticks" collides case-insensitively with
    // id 202's "incense sticks" - all three made "agarbatti" ambiguous by
    // voice until removed.
    removeNames: ["Agarbatti", "अगरबत्ती", "Incense sticks"],
  },
};

/**
 * Default guardCategory for each of the 48 sourceCategory header strings.
 * Every string the parser can produce MUST have an entry here - a product
 * whose header isn't listed is skipped and reported, never silently
 * defaulted to "other" (docs/07-DECISIONS.md D12).
 */
const CATEGORY_TO_GUARD: Record<string, GuardCategory> = {
  "ATTA / GRAINS / FLOUR": "grain",
  "RICE / CHAWAL": "grain",
  "DALS / PULSES / LEGUMES": "dal",
  "SUGAR / SALT / JAGGERY": "sweet", // sugar/gur/bura/shakkar majority; salt overridden to condiment below
  "OIL / GHEE / VANASPATI": "oil",
  "MILK / DAIRY": "dairy",
  "BISCUITS / COOKIES": "snack",
  "BREAD / BAKERY": "snack",
  "SNACKS / NAMKEEN": "snack",
  "NOODLES / PASTA / INSTANT FOOD": "snack",
  "TEA / COFFEE / HEALTH DRINKS": "beverage", // coffee/malt-drink powders; tea items overridden below
  "SPICES / MASALA": "masala",
  "SAUCE / KETCHUP / PICKLES / PAPAD": "condiment",
  "SWEETS / CANDY / CHOCOLATE": "sweet",
  "COLD DRINKS / BEVERAGES": "beverage", // lassi/chhach overridden to dairy below
  "SOAP / PERSONAL HYGIENE": "hygiene", // toothpaste/shampoo/cosmetics majority; bar soaps overridden below
  "WASHING / CLEANING": "soap",
  "MATCHES / AGARBATTI / PUJA": "household",
  "BABY PRODUCTS": "hygiene", // diaper/powder/oil; Cerelac overridden to snack below
  "STATIONERY / HOUSEHOLD": "household",
  "MEDICINES / FIRST AID (OTC)": "medicine",
  "EGGS": "other", // one product pair, distinctive - fine as other
  "DRY FRUITS / NUTS": "dryfruit",
  "MISC GROCERY": "other", // baking ingredients with no real bucket; a few genuine exceptions below

  "BRANDED ATTA / FLOUR": "grain",
  "BRANDED RICE": "grain",
  "PULSES / DAL BRANDS": "dal", // Chana Sattu is a flour product, overridden below
  "EDIBLE OIL BRANDS": "oil",
  "SUGAR / NAMKEEN BRANDS": "condiment", // 3 of 4 are salt brands; sugar brand overridden below
  "DAIRY BRANDS": "dairy", // butter + two ghees overridden to oil below
  "INSTANT FOOD / READY TO EAT": "snack",
  "BREAD / BAKERY BRANDS": "snack",
  "TEA / COFFEE BRANDS": "beverage", // 3 tea brands overridden below
  "SPICES / MASALA BRANDS": "masala", // soya chunks/granules overridden to snack below
  "SAUCE / CONDIMENT BRANDS": "condiment",
  "SWEETS / MITHAI / NAMKEEN BRANDS": "sweet", // namkeen brands overridden to snack below
  "COLD DRINK / BEVERAGES BRANDS": "beverage", // Amul Lassi + milk packet overridden to dairy below
  "SOAP / HYGIENE BRANDS": "hygiene", // handwash/bar-soap brands overridden below
  "WASHING / CLEANING BRANDS": "soap", // pest control/fresheners overridden to household below
  "BABY / CHILD PRODUCTS": "hygiene", // infant formula/cereal overridden below
  "STATIONERY / GENERAL": "household",
  "HOUSEHOLD / KITCHEN": "household", // Bartan Powder overridden to soap below
  "AGRI / SEASONAL / REGIONAL": "household", // Nariyal Pani overridden to beverage below
  "ELECTRONICS / ACCESSORIES": "household",
  "FOOTWEAR / MISC": "household",
  "REGIONAL FOOD ITEMS": "snack", // regional namkeen majority; soda/juice/sweets/spices overridden below
  "GRAINS / SEEDS": "other", // the most heterogeneous header in the file - every id overridden, see below
  "REGIONAL VEGETABLES / PULSES": "dal", // tilli and haldi gath overridden below
};

/**
 * Per-id exceptions to the header's default guardCategory, decided by
 * reading the actual product each id names - never by keyword-matching the
 * displayName at build time. Grouped by which header they correct, matching
 * the inline comments on CATEGORY_TO_GUARD above.
 */
const GUARD_CATEGORY_ID_OVERRIDES: Record<number, GuardCategory> = {
  // SUGAR / SALT / JAGGERY -> condiment (Namak, Sendha Namak)
  29: "condiment",
  30: "condiment",

  // TEA / COFFEE / HEALTH DRINKS -> tea (Chai Patti, Red Label, Taj Mahal, Tata Tea, Green Tea)
  89: "tea",
  90: "tea",
  91: "tea",
  92: "tea",
  93: "tea",

  // SOAP / PERSONAL HYGIENE -> soap (actual bathing soap bars, ids 160-167)
  160: "soap",
  161: "soap",
  162: "soap",
  163: "soap",
  164: "soap",
  165: "soap",
  166: "soap",
  167: "soap",

  // COLD DRINKS / BEVERAGES -> dairy (Lassi/Chhach is buttermilk, not a soft drink)
  159: "dairy",

  // BABY PRODUCTS -> snack (Cerelac is a ready-to-eat cereal food, closest to
  // "instant food" - consistent with Farex below)
  211: "snack",

  // MISC GROCERY -> sweet/condiment/masala (baking soda, baking powder, agar
  // agar, food color, rose water, corn starch and yeast have no real bucket
  // and stay "other" - see the HANDOFF note)
  239: "sweet", // Cocoa Powder - a sweet/chocolate-making ingredient
  243: "masala", // Kesar/saffron - a spice (paired with id 618 below - same
  // product name should not get two different guard categories)
  244: "condiment", // Imli/tamarind - a souring agent, condiment family
  245: "sweet", // Gud Powder - powdered jaggery

  // PULSES / DAL BRANDS -> grain (Chana Sattu is roasted-gram flour, not a
  // dal you cook - same family as Sattu, id 10, already "grain")
  322: "grain",

  // DAIRY BRANDS -> oil (Amul Butter, Kusum Ghee, Patanjali Ghee - butter and
  // ghee are explicitly in the legacy "oil" guard's own keyword list)
  350: "oil",
  356: "oil",
  357: "oil",

  // SUGAR / NAMKEEN BRANDS -> sweet (Madhur Chini is a sugar brand; the other
  // three in this header are salt brands, left at the header default)
  340: "sweet",

  // TEA / COFFEE BRANDS -> tea (Wagh Bakri, Society Tea, Lipton)
  380: "tea",
  381: "tea",
  382: "tea",

  // SPICES / MASALA BRANDS -> snack (soya chunks/granules are a soy-protein
  // food, not a spice, despite sitting in this header)
  392: "snack",
  393: "snack",

  // SWEETS / MITHAI / NAMKEEN BRANDS -> snack (the actual namkeen/bhujia/
  // chips/popcorn half of this header; the candy/chocolate half stays sweet)
  410: "snack",
  411: "snack",
  412: "snack",
  413: "snack",
  414: "snack",
  415: "snack",

  // SOAP / HYGIENE BRANDS -> soap (Dettol/Lifebuoy handwash are liquid soap;
  // Godrej No.1 and Hamam are bar soap)
  450: "soap",
  451: "soap",
  453: "soap",
  454: "soap",

  // WASHING / CLEANING BRANDS -> household (pest control and air fresheners,
  // not cleaning agents: Hit, Good Knight, All Out, Mortein, Odonil, Odomos,
  // naphthalene balls)
  477: "household",
  478: "household",
  479: "household",
  480: "household",
  481: "household",
  482: "household",
  483: "household",

  // COLD DRINK / BEVERAGES BRANDS -> dairy (Amul Lassi, Full Cream Milk
  // Packet are dairy products, not soft drinks)
  439: "dairy",
  440: "dairy",

  // BABY / CHILD PRODUCTS -> beverage/snack (Lactogen and NAN Pro are infant
  // formula - a milk-powder drink mix, same family as Horlicks/Complan,
  // already "beverage"; Farex is a ready cereal food, same as Cerelac above)
  493: "beverage",
  494: "beverage",
  495: "snack",

  // HOUSEHOLD / KITCHEN -> soap (Bartan Powder - "bartan powder" is
  // explicitly in the legacy CATEGORY_GUARDS "soap" keyword list)
  530: "soap",

  // AGRI / SEASONAL / REGIONAL -> beverage (Nariyal Pani is coconut water, a
  // drink - not a puja/seasonal item like the rest of this header)
  555: "beverage",

  // REGIONAL FOOD ITEMS -> beverage/sweet/masala exceptions to the snack default
  587: "beverage", // Banta Soda
  588: "beverage", // Ganna Juice (sugarcane juice)
  589: "sweet", // Mishri (rock candy)
  590: "sweet", // Murabba (fruit preserve)
  591: "sweet", // Pachak Churan - shelved and eaten like a digestive candy
  592: "masala", // Saunth / dry ginger
  593: "masala", // Kali Mirch Powder
  594: "masala", // Dhania Jeera Powder

  // GRAINS / SEEDS -> the most heterogeneous header in the file. Every id is
  // overridden; the header's own "other" default is never actually used.
  //   dryfruit: sesame (black + white), flaxseed, sunflower seeds, chia/sabja
  600: "dryfruit",
  601: "dryfruit",
  602: "dryfruit",
  603: "dryfruit",
  604: "dryfruit",
  //   grain: Quinoa, Jau, Makka, Jowar Sabut, Bhagar, Daaliya, Kanki
  605: "grain",
  606: "grain",
  607: "grain",
  608: "grain",
  610: "grain",
  613: "grain",
  620: "grain",
  //   snack: Futana (roasted chana snack)
  609: "snack",
  //   sweet: Gulab Jamun Packet
  611: "sweet",
  //   masala: Jeera Powder, Kesar (paired with id 243 above), Khada Dhaniya
  612: "masala",
  618: "masala",
  621: "masala",
  //   soap: the two soap-bar entries someone dropped into this header
  614: "soap",
  615: "soap",
  //   household: Agarbatti, Chandan (sandalwood), Mogra (jasmine) - puja/decor
  616: "household",
  617: "household",
  619: "household",
  //   dal: the four "khadi/dhuli" whole-and-split dal variants
  622: "dal",
  623: "dal",
  624: "dal",
  625: "dal",

  // REGIONAL VEGETABLES / PULSES -> dryfruit / masala exceptions
  631: "dryfruit", // Tilli is sesame, same family as ids 600/601 above
  634: "masala", // Haldi Gath is whole turmeric root
};

/** Faithful port of legacy/products.js's isUsefulCatalogText(). */
function isUsefulCatalogText(value: string | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text) return false;
  if (/\?{4,}/.test(text)) return false;
  const hasMojibakeMarker = /[àâð]/.test(text);
  const hasDevanagari = /[ऀ-ॿ]/.test(text);
  return !(hasMojibakeMarker && !hasDevanagari);
}

/** Faithful port of legacy/products.js's titleCaseCatalogText(). */
function titleCaseCatalogText(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Faithful port of legacy/products.js's pickRuntimeDisplayName(). */
function pickRuntimeDisplayName(product: Pick<RawProduct, "id" | "displayName" | "names">): {
  name: string;
  wasFallback: boolean;
} {
  if (isUsefulCatalogText(product.displayName)) {
    return { name: product.displayName.trim(), wasFallback: false };
  }
  const candidates = [product.displayName, ...product.names];
  for (const candidate of candidates) {
    const cleaned = (candidate ?? "").trim();
    if (!isUsefulCatalogText(cleaned)) continue;
    const isAsciiLike = /^[a-z0-9\s()&/-]+$/i.test(cleaned);
    return { name: isAsciiLike ? titleCaseCatalogText(cleaned) : cleaned, wasFallback: true };
  }
  return { name: `Item ${product.id}`, wasFallback: true };
}

const PRODUCT_LINE_PATTERN =
  /^\s*\{\s*id\s*:\s*(\d+)\s*,\s*names\s*:\s*\[([^\]]*)\]\s*,\s*displayName\s*:\s*"([^"]*)"\s*,\s*unit\s*:\s*"([^"]*)"\s*,\s*price\s*:\s*(-?\d+(?:\.\d+)?)\s*\}/;
const ALIAS_PATTERN = /"((?:[^"\\]|\\.)*)"/g;
const BOX_HEADER_PATTERN = /^\s*\/\/\s*──\s*(.+?)\s*──\s*$/;
const BORDER_PATTERN = /^\s*\/\/\s*═{3,}\s*$/;

/**
 * Every product entry in legacy/products.js sits on exactly one line
 * (verified against all 482 entries before writing this parser), as does
 * every category header, in one of two styles:
 *   1. a plain title line sandwiched between two "// ════" border lines
 *   2. a "// ── TITLE ──" box-drawn line
 * This does a single top-to-bottom pass, updating `currentCategory` on a
 * header line and tagging every product line with whatever category is
 * currently in effect.
 */
function parseProducts(source: string): RawProduct[] {
  const lines = source.split("\n");
  const products: RawProduct[] = [];
  let currentCategory: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    const boxMatch = line.match(BOX_HEADER_PATTERN);
    if (boxMatch) {
      currentCategory = boxMatch[1]!.trim();
      continue;
    }

    if (BORDER_PATTERN.test(line) && BORDER_PATTERN.test(lines[i + 2] ?? "")) {
      const titleLine = lines[i + 1] ?? "";
      if (!BORDER_PATTERN.test(titleLine) && !BOX_HEADER_PATTERN.test(titleLine)) {
        const titleMatch = titleLine.match(/^\s*\/\/\s*(.+?)\s*$/);
        if (titleMatch) {
          currentCategory = titleMatch[1]!.trim();
        }
      }
      continue;
    }

    const productMatch = line.match(PRODUCT_LINE_PATTERN);
    if (productMatch) {
      const [, idText, namesText, displayName, unit, priceText] = productMatch as unknown as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const names = [...namesText.matchAll(ALIAS_PATTERN)].map((aliasMatch) => aliasMatch[1] as string);
      products.push({
        id: Number(idText),
        names,
        displayName,
        unit,
        price: Number(priceText),
        sourceCategory: currentCategory,
      });
    }
  }

  return products;
}

const GUARD_CATEGORIES: GuardCategory[] = [
  "dal",
  "oil",
  "masala",
  "tea",
  "grain",
  "soap",
  "hygiene",
  "dairy",
  "snack",
  "sweet",
  "beverage",
  "condiment",
  "dryfruit",
  "household",
  "medicine",
  "other",
];

function buildSeed(rawProducts: RawProduct[]): { seed: SeedProduct[]; report: BuildReport } {
  const report: BuildReport = {
    productsIn: rawProducts.length,
    productsOut: 0,
    sourceCategoryCounts: {},
    guardCategoryCounts: Object.fromEntries(GUARD_CATEGORIES.map((g) => [g, 0])) as Record<GuardCategory, number>,
    otherBySourceCategory: {},
    explicitDisplayNameOverrides: 0,
    fallbackDisplayNameRepairs: 0,
    garbageAliasesDropped: 0,
    duplicateAliasesDropped: 0,
    priceConversions: 0,
    sumSourceRupees: 0,
    sumOutputPaise: 0,
    skipped: [],
  };

  const seenIds = new Set<number>();
  const seed: SeedProduct[] = [];

  for (const raw of rawProducts) {
    if (seenIds.has(raw.id)) {
      report.skipped.push({ id: raw.id, reason: `duplicate id ${raw.id} - keeping first occurrence` });
      continue;
    }
    seenIds.add(raw.id);

    if (!raw.sourceCategory) {
      report.skipped.push({ id: raw.id, reason: "no category header found above this product" });
      continue;
    }

    const defaultGuard = CATEGORY_TO_GUARD[raw.sourceCategory];
    if (!defaultGuard) {
      report.skipped.push({
        id: raw.id,
        reason: `sourceCategory "${raw.sourceCategory}" has no entry in CATEGORY_TO_GUARD`,
      });
      continue;
    }
    const guardCategory = GUARD_CATEGORY_ID_OVERRIDES[raw.id] ?? defaultGuard;

    if (!(raw.price > 0)) {
      report.skipped.push({ id: raw.id, reason: `price ${raw.price} is not positive` });
      continue;
    }

    const fix = PRODUCT_RUNTIME_FIXES[raw.id] ?? {};

    let displayName: string;
    if (fix.displayName) {
      displayName = fix.displayName;
      report.explicitDisplayNameOverrides += 1;
    } else {
      const picked = pickRuntimeDisplayName(raw);
      displayName = picked.name;
      if (picked.wasFallback) report.fallbackDisplayNameRepairs += 1;
    }

    const unit = (fix.unit ?? raw.unit ?? "piece").toLowerCase();

    const candidateAliases = [raw.displayName, ...raw.names, ...(fix.names ?? [])];
    const removeNamesLower = new Set((fix.removeNames ?? []).map((n) => n.toLowerCase()));
    const keptAliases: string[] = [];
    const seenAliases = new Set<string>();
    for (const candidate of candidateAliases) {
      const cleaned = (candidate ?? "").trim();
      if (!isUsefulCatalogText(cleaned)) {
        report.garbageAliasesDropped += 1;
        continue;
      }
      if (removeNamesLower.has(cleaned.toLowerCase())) {
        report.duplicateAliasesDropped += 1;
        continue;
      }
      if (seenAliases.has(cleaned)) {
        report.duplicateAliasesDropped += 1;
        continue;
      }
      seenAliases.add(cleaned);
      keptAliases.push(cleaned);
    }
    if (!seenAliases.has(displayName)) {
      keptAliases.push(displayName);
    }

    const suggestedPricePaise = rupeesToPaise(raw.price);
    const roundTripRupees = suggestedPricePaise / 100; // build-time check only, not a shipped money path
    if (Math.abs(roundTripRupees - raw.price) > 1e-9) {
      report.skipped.push({
        id: raw.id,
        reason: `price ${raw.price} is not exactly representable in whole paise (converts to ${suggestedPricePaise} paise, round-trips to ${roundTripRupees})`,
      });
      continue;
    }
    report.priceConversions += 1;
    report.sumSourceRupees += raw.price;
    report.sumOutputPaise += suggestedPricePaise;
    report.sourceCategoryCounts[raw.sourceCategory] = (report.sourceCategoryCounts[raw.sourceCategory] ?? 0) + 1;
    report.guardCategoryCounts[guardCategory] += 1;
    if (guardCategory === "other") {
      report.otherBySourceCategory[raw.sourceCategory] = (report.otherBySourceCategory[raw.sourceCategory] ?? 0) + 1;
    }

    seed.push({
      id: String(raw.id),
      displayName,
      sourceCategory: raw.sourceCategory,
      guardCategory,
      unit,
      suggestedPricePaise,
      aliases: keptAliases,
      isActive: true,
    });
    report.productsOut += 1;
  }

  return { seed, report };
}

function printReport(report: BuildReport): void {
  const sortedSourceCategories = Object.entries(report.sourceCategoryCounts).sort(([, a], [, b]) => b - a);
  const otherBreakdown = Object.entries(report.otherBySourceCategory).sort(([, a], [, b]) => b - a);
  const otherTotal = report.guardCategoryCounts.other;
  const otherPercent = ((otherTotal / report.productsOut) * 100).toFixed(1);

  // sum_rupees is a float sum of 482 already-2-decimal values, so it can carry
  // a few ulps of accumulated floating-point noise (~1e-11 here) that has
  // nothing to do with the conversion being correct. Rounding this ONE
  // comparison value absorbs that noise without weakening the check: a real
  // conversion bug (wrong factor, a skipped product, a units mistake) would be
  // off by whole paise, many orders of magnitude larger than float noise.
  const sumRupeesScaledToPaise = Math.round(report.sumSourceRupees * 100);
  const sumsMatch = sumRupeesScaledToPaise === report.sumOutputPaise;

  const lines = [
    "",
    "Catalog seed build report",
    "==========================",
    `Products in  (parsed from legacy/products.js): ${report.productsIn}`,
    `Products out (written to catalog-seed.json):   ${report.productsOut}`,
    "",
    `guardCategory counts (16):`,
    ...GUARD_CATEGORIES.map((g) => `  ${String(report.guardCategoryCounts[g]).padStart(3, " ")}  ${g}`),
    "",
    `"other": ${otherTotal} of ${report.productsOut} (${otherPercent}%), by sourceCategory - eyeball for anything that shouldn't be here:`,
    ...otherBreakdown.map(([name, count]) => `  ${String(count).padStart(3, " ")}  ${name}`),
    "",
    `sourceCategory (${sortedSourceCategories.length} total):`,
    ...sortedSourceCategories.map(([name, count]) => `  ${String(count).padStart(3, " ")}  ${name}`),
    "",
    "Display name fixes:",
    `  explicit overrides (PRODUCT_RUNTIME_FIXES):   ${report.explicitDisplayNameOverrides}`,
    `  fallback repairs (mojibake/unusable text):    ${report.fallbackDisplayNameRepairs}`,
    "",
    "Alias cleanup:",
    `  garbage aliases dropped (mojibake/empty):     ${report.garbageAliasesDropped}`,
    `  duplicate aliases dropped:                    ${report.duplicateAliasesDropped}`,
    "",
    `Price conversions (rupees -> integer paise):    ${report.priceConversions}`,
    `  sum of source rupee prices:                   ${report.sumSourceRupees}`,
    `  sum of output paise:                           ${report.sumOutputPaise}`,
    `  sum_rupees * 100 == sum_paise:                 ${sumsMatch ? "MATCH" : "MISMATCH"} (${sumRupeesScaledToPaise} vs ${report.sumOutputPaise})`,
    "",
    `Skipped products: ${report.skipped.length}`,
    ...report.skipped.map((s) => `  - id ${s.id}: ${s.reason}`),
    "",
  ];
  console.log(lines.join("\n"));

  if (!sumsMatch) {
    console.error("Aggregate price check FAILED - refusing to treat this seed as trustworthy.");
    process.exitCode = 1;
  }
}

function main(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.join(scriptDir, "..");
  const legacyPath = path.join(projectRoot, "legacy", "products.js");
  const outPath = path.join(projectRoot, "src", "domain", "catalog-seed.json");

  const source = readFileSync(legacyPath, "utf8");
  const rawProducts = parseProducts(source);

  if (rawProducts.length !== EXPECTED_PRODUCT_COUNT) {
    console.error(
      `Parsed ${rawProducts.length} products from legacy/products.js, expected ${EXPECTED_PRODUCT_COUNT} ` +
        `(docs/14-LEGACY-REFERENCE.md section 9). The regex parser may be missing entries - ` +
        `refusing to write catalog-seed.json.`,
    );
    process.exitCode = 1;
    return;
  }

  const { seed, report } = buildSeed(rawProducts);
  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n", "utf8");
  printReport(report);
}

main();
