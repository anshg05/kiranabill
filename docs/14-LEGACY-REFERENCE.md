# 14 — Legacy Reference

**Last updated:** 17 Aug 2026 · **Status:** Reference material, frozen

---

## What this document is

The predecessor (`KiranaBill-Phase1-Fixed`, ~9,000 lines of vanilla JS) is **not** being ported.
Its implementation is discarded. But months of hand-tuning went into it, and that knowledge must
not be re-derived.

**This document is that knowledge, extracted as specification.** An AI building `src/domain/`
should read *this*, not 9,000 lines of JavaScript.

The original files live in `legacy/` in the repo, read-only, for when this document isn't enough.

**Rule: `legacy/` is never imported, never built, never linted.** It is documentation that happens
to be executable.

---

## 1. The Gemini pricing-grammar prompt

**The single most valuable artifact in the old codebase.** It is text, not code — it survives the
rewrite verbatim. Reproduced here in full because it *is* the specification of Layer 2.

```
You are a kirana shop billing assistant in India. Parse Hindi/English speech into bill items.

Products (for fuzzy name matching only, limited relevant subset):
{PRODUCT_LIST}

Keep item names conservative. Do NOT rename or substitute a spoken item phrase to a nearby
catalog product. Preserve the spoken product phrase in both displayName and spokenName,
cleaned only for obvious spacing. Local validator code will do catalog matching later.

Hindi numbers: ek=1,do=2,teen=3,char=4,paanch=5,chhe=6,saat=7,aath=8,nau=9,das=10,
barah=12,pandrah=15,bees=20,tees=30,pachaas=50,sau=100
Hindi fractions: aadha=0.5,paav=0.25,sawa=1.25,dedh=1.5,dhai=2.5,chataak=0.05
Units: kilo/kg, gram/gm/g, liter/litre/l, ml, piece/pcs, packet/pack/pkt, dozen, box,
bottle, pouch, bag, can, tin

Speech: "{TEXT}"

=== CRITICAL PRICING RULES ===

RULE 1 - WALA/WALI MEANS PER-UNIT RATE:
If a user says 'X wala', 'X wali', 'X rupay wala', 'X rupay wali', 'Rs X wala', or
'Rs X wali', X is the PER-UNIT RATE, not total.
This applies to kg/gm/liter/ml items as well as piece items.
This is a GENERAL rule for any numeric value, not only the examples below.
1 wala, 1 wali, 7 wala, 30 wali, 83 wala, 180 wali, 999 wala all mean per-unit rate.
- "gehun 5 kg 30 rupay wala" means qty:5, unit:kg, rate:30, total:150
- "chawal 50 wala 5kg" means qty:5, unit:kg, rate:50, total:250
- "chawal 5kg 50 wala" means qty:5, unit:kg, rate:50, total:250
- "chawal 6 kg 60 wali" means qty:6, unit:kg, rate:60, total:360
- "toor daal 2 kilo 100 wala" means qty:2, unit:kg, rate:100, total:200
- "5kg toor daal 120 wali" means qty:5, unit:kg, rate:120, total:600
- "teen Parle-G 10 wala" means qty:3, unit:piece, rate:10, total:30

RULE 2 - KA/KI MEANS TOTAL PRICE:
If a user says 'X ka', 'X ki', 'X rupay ka', or 'X rupay ki', X is the TOTAL price for
that line item, not rate.
For loose kg/gm/liter/ml items, if only total price is spoken and no quantity/unit is
spoken, do NOT invent qty or unit. Set qty:null and unit:"".
This is a GENERAL rule for any numeric value.
- "chawal 5kg 30 ka" means qty:5, unit:kg, rate:null, total:30
- "chawal 5kg 30 ki" means qty:5, unit:kg, rate:null, total:30
- "ajwain 10 ka" means qty:null, unit:"", rate:null, total:10
- "chai patti 20 ki" means qty:null, unit:"", rate:null, total:20
- "namak 20 rupay ka" means qty:1, unit:kg, rate:null, total:20

RULE 3 - PRICE WITHOUT WALA OR KA:
When a user says a price with quantity but does NOT say 'wala', treat that spoken price
as TOTAL, not rate.
- "5 kg aata 170 rupay" means qty:5, unit:kg, rate:null, total:170
- "50 gram jeera 20 rupay" means qty:50, unit:gm, rate:null, total:20
- "ajwain 10 rupay" means qty:1, unit:gm, rate:null, total:10
- "2 kilo chini 90 rupay" means qty:2, unit:kg, rate:null, total:90
- "namak 20 rupay" means qty:1, unit:kg, rate:null, total:20

RULE 4 - DISTINCT VARIANTS BY PRICE:
If the same base product is spoken again with a different explicit rate or a different
explicit total, it is a DIFFERENT line item and must NOT be merged.
This rule applies to ALL products, not only chawal.
Keep displayName clean and product-only. Do NOT add price text, brackets, '/kg',
'/piece', or 'Rs total' inside displayName.
Do NOT assume the price numbers are fixed. The spoken numeric value can be ANY number
and must be preserved in rate/total fields only.
- "chawal 50 wala 5kg" => displayName:"Chawal", rate:50
- "chawal 60 wala 5kg" => displayName:"Chawal", rate:60
- "sabun 30 rupay"     => displayName:"Sabun", total:30
- "sabun 180 rupay"    => displayName:"Sabun", total:180
If two rows have different explicit rates or totals, return them as separate array entries.

RULE 5 - No price mentioned:
If quantity or pack count is spoken but no price is spoken, set rate to defaultPrice and
total = qty * defaultPrice.
If speech is ONLY a bare loose-item name with no quantity and no price, such as 'ajwain',
'saunf', 'kali mirch', 'chawal', do NOT assume default price.
Return qty:null, unit:"", rate:null, total:0, priceType:"unknown".

Return ONLY a valid JSON array. No markdown, no extra text.
Format: [{"displayName":"chini","spokenName":"chini","qty":2,"unit":"kg","rate":null,
"total":90,"isCustom":false,"priceType":"total"}]
- qty can be null when only total price was spoken for loose items and no qty was spoken
- unit can be "" in the same case
- spokenName: exact product phrase from the user speech for that item
- displayName: keep the same spoken product phrase, do not force a catalog rename
- rate: number if per-unit price, null if price was spoken as total
- total: always a number, use 0 only for incomplete bare item speech that needs review
- isCustom: true for unknown products
- priceType: 'rate' if spoken with wala, 'total' if spoken with ka or explicit total
  price, 'default' if quantity was spoken and default catalog price was used,
  'unknown' if bare loose-item speech was incomplete
- Ignore fillers: aur, bhi, ruk, haan, ok, bhai, please
```

**Two notes for the rebuild:**

1. **`{PRODUCT_LIST}` is 80 products in the old code. `04-VOICE-PIPELINE.md` reduces this to 30** —
   measure whether accuracy drops before assuming it does (`NI-06`).
2. **The instruction "Local validator code will do catalog matching later" is important.** The LLM
   deliberately does *not* rename to catalog products. That separation is correct and must survive.

---

## 2. Whisper transcription prompt (phrase biasing base)

```
Indian kirana billing speech with Hindi-English mixing.
Keep grocery and spice names exact when possible.
Common words: ajwain, ajvayan, saunf, sonf, soff, kali mirch, kalimirch, kanki,
kanaki, chawal, chai patti, sonth.
Keep quantities, rates, wala, wali, ka, ki, rupees, packet, piece, kg and gram exact.
Return Hindi words only in Devanagari or plain Latin script.
Do not use Urdu or Perso-Arabic script.
```

**`KB-007` appends the shop's top ~40 product names to this**, ranked by billing frequency.
Whisper's prompt window is ~224 tokens, so cap at 600 characters.

---

## 3. Hindi numerals and fractions

Verbatim. Both Latin and Devanagari keys, because transcripts arrive in either.

```ts
export const HINDI_NUMBERS: Record<string, number> = {
  ek:1, एक:1, do:2, दो:2, teen:3, तीन:3, char:4, chaar:4, चार:4,
  paanch:5, panch:5, पांच:5, paach:5, chhe:6, chhah:6, छह:6,
  saat:7, सात:7, aath:8, आठ:8, nau:9, nav:9, नौ:9, das:10, दस:10,
  gyarah:11, ग्यारह:11, barah:12, बारह:12, terah:13, तेरह:13,
  chaudah:14, चौदह:14, pandrah:15, पंद्रह:15, solah:16, सोलह:16,
  satrah:17, सत्रह:17, atharah:18, अठारह:18, unnees:19, उन्नीस:19,
  bees:20, बीस:20, pachees:25, पचीस:25, tees:30, तीस:30,
  chaalees:40, चालीस:40, pachaas:50, पचास:50,
  saath:60, साठ:60, sattar:70, सत्तर:70, assi:80, अस्सी:80,
  nabbe:90, नब्बे:90, sau:100, सौ:100,
};

export const HINDI_FRACTIONS: Record<string, number> = {
  aadha:0.5, आधा:0.5, adha:0.5,
  paav:0.25, पाव:0.25, pav:0.25,
  sawa:1.25, सवा:1.25,
  dedh:1.5, डेढ़:1.5, deedh:1.5,
  dhai:2.5, ढाई:2.5, dhaai:2.5,
  paune:0.75, पौने:0.75,
};
```

> ⚠️ **Inconsistency to resolve in `KB-005`.** The Gemini prompt says `chataak=0.05` but
> `HINDI_FRACTIONS` has no `chataak`, and has `paune=0.75` which the prompt doesn't mention.
> Also `paune` is genuinely context-dependent in speech ("paune do" = 1.75, not 0.75). Decide the
> rule, write the test, make both sources agree.

---

## 4. Mishearing normalisation rules

Applied to the transcript **before** parsing. Sixteen rules, each earned from a real mishearing.

```ts
export const NORMALIZATION_RULES = [
  { pattern: /\bsoff\b/gi,           replacement: "saunf" },
  { pattern: /\bsof\b/gi,            replacement: "saunf" },
  { pattern: /\bsonf\b/gi,           replacement: "saunf" },
  { pattern: /\bsauf\b/gi,           replacement: "saunf" },
  { pattern: /\bsouf\b/gi,           replacement: "saunf" },
  { pattern: /\bsouff\b/gi,          replacement: "saunf" },
  { pattern: /\bajvayan\b/gi,        replacement: "ajwain" },
  { pattern: /\bajvayn\b/gi,         replacement: "ajwain" },
  { pattern: /\bkalimirch\b/gi,      replacement: "kali mirch" },
  { pattern: /\bkali much\b/gi,      replacement: "kali mirch" },
  { pattern: /\bkali mirchi\b/gi,    replacement: "kali mirch" },
  { pattern: /\bkanaki\b/gi,         replacement: "kanki" },
  { pattern: /\bmoong moongar\b/gi,  replacement: "moong mogar" },
  { pattern: /\bmoongar\b/gi,        replacement: "mogar" },
  { pattern: /\burad moongar\b/gi,   replacement: "urad mogar" },
  { pattern: /\bmung mogar\b/gi,     replacement: "moong mogar" },
];
```

Then collapse whitespace and trim.

**Order matters** — `moong moongar` must run before `moongar`.

**This table grows.** Every mishearing found during the pilot gets a rule and a test.

---

## 5. Category guards

The best idea in the old validator. If a spoken phrase clearly belongs to a category and the best
fuzzy match belongs to a *different* category, **reject the match** rather than accept it. Prevents
"daal" matching a soap.

```ts
export const CATEGORY_GUARDS = [
  { name: "dal",    keywords: ["dal","daal","दाल","मोगर","मगर","mogar","magar","lentil",
                               "urad","moong","masoor","chana dal","arhar","toor","tuvar"] },
  { name: "oil",    keywords: ["tel","oil","तेल","ghee","घी","vanaspati","dalda","butter",
                               "makhan","मक्खन"] },
  { name: "masala", keywords: ["masala","spice","मसाला","ajwain","अजवाइन","jeera","जीरा",
                               "saunf","सौंफ","saunth","सोंठ","mirch","मिर्च","haldi","हल्दी",
                               "dhaniya","धनिया"] },
  { name: "tea",    keywords: ["chai","tea","चाय","patti","पत्ती","leaf","dust tea"] },
  { name: "grain",  keywords: ["chawal","rice","चावल","gehun","गेहूं","gehu","aata","आटा",
                               "atta","kanki","poha","पोहा","makka","मक्का","jowar","bajra"] },
  { name: "soap",   keywords: ["sabun","soap","साबुन","detergent","surf","wheel","rin","vim",
                               "bartan bar","bartan powder"] },
];
```

**Logic:** derive the category set for the spoken phrase and for the candidate match. If both are
non-empty and disjoint → reject the match.

---

## 6. Matching thresholds

Short words are dangerous — a 4-character typo can match anything. The old validator scaled the
required score by token length.

| Spoken phrase | Minimum score |
|---|---|
| ≤ 4 characters | ~0.98 (near-exact) |
| Single word, > 4 chars | ~0.85 |
| Multi-word | ~0.74 |

Plus **phonetic variants**: `ph ↔ f`, `w ↔ v`, so "phorchune" and "fortune" both land.
Plus a **learned-product boost** proportional to `use_count`, capped at +0.08.

> The deterministic fast path (Layer 1) must use a **stricter** threshold than the LLM path, because
> there is no model behind it to sanity-check the result.

---

## 7. Review reason codes

Carry all of these forward. Severity mapping per `04-VOICE-PIPELINE.md` §5.

| Code | Meaning | Severity |
|---|---|---|
| `missing_name` | No product name resolved | HIGH |
| `missing_rate` | Rate expected but absent | MEDIUM |
| `missing_total` | Total could not be computed | HIGH |
| `unknown_product` | Not in catalog | LOW — add and flag, **never block** |
| `unusual_rate` | Rate > 3× or < 0.2× the shop's price | **HIGH** |
| `unusual_total` | Total outside the expected band | **HIGH** |
| `unknown` | Rule 5 — bare item, no qty or price | MEDIUM |

**New codes required by `04-VOICE-PIPELINE.md`, not present in the old code:**

| Code | Meaning | Severity |
|---|---|---|
| `number_dropped` | A number in the transcript reached no line item | HIGH |
| `qty_dropped` | Quantity parsed then lost | HIGH |
| `number_unconsumed` | Two numbers spoken, one unused | HIGH |

---

## 8. Unit handling

```
kg     ← kilo, kilogram, kilos, किलो
gm     ← gram, grams, g, ग्राम
liter  ← litre, ltr, l, लीटर
ml     ← मिली
piece  ← pcs, pc, नग
packet ← pack, pkt, पैकेट
dozen · box · bottle · pouch · bag · can · tin
```

Conversions: `1 kg = 1000 gm`, `1 liter = 1000 ml`.

**Rate-basis inference** — the subtlest rule in the old validator, and worth preserving: if the
spoken unit is `gm` but the rate is **≥ 10× the per-gram catalog price**, infer the speaker meant a
per-kg rate and convert. Handles "500 gram, 60 rupay wala" where 60 is obviously ₹60/kg.

> ⚠️ `BILL_UNITS` in `app.js` included `bag`; the manual-add dropdown did not (`KI-16`). In the
> rebuild, **units come from one exported constant**, imported everywhere.

---

## 9. The 482-product catalog

`legacy/products.js` → seed data for `base_products`.

- 482 products, ids 1–634, 24 categories
- Each has `displayName`, `category`, `unit`, `price`, and an alias array mixing Hindi, Latin and
  Devanagari
- ~164 bytes per product as JSON; 79 KB total
- `PRODUCT_RUNTIME_FIXES` and `cleanupProductsCatalog()` patched mojibake and duplicate aliases at
  load time — **apply those fixes once during seeding**, then delete the mechanism. A catalog that
  needs repairing at every boot is a catalog with bad data.

---

## 10. What is NOT carried forward

| Discarded | Why |
|---|---|
| `billing-ui.js` (1,213 lines) | → React components |
| `styles.css` (1,855 lines) | → Tailwind per `13-DESIGN.md`. Encodes the visual language being replaced. |
| `index.html` | → React app shell |
| `app.js` | → React state |
| `learning-store.js` | Design survives in `08-LEARNING-ENGINE.md`; localStorage/Blobs implementation does not |
| `validator.js` | **Rules** survive (§5–8 above); implementation is rewritten in TypeScript |
| Netlify functions | → one `/voice` endpoint |
| `getBestCatalogMatch()` | O(n) scan → indexed matcher (`KB-201`) |
| `local-dev-server.js` | → Vite dev server |

---

## 11. Known defects — must not be reintroduced

Each needs a test in the new code.

| # | Defect | Test to write |
|---|---|---|
| KI-02 | `includes("bas")` matched "basmati" and finalised the bill | No catalog alias may match any command |
| KI-03 | "5 kg chawal 30 ka" → ₹100 instead of ₹30 | `ka` vs `wala` on the same phrase |
| KI-04 | Default-price path returned rate `null`, total `0` | Qty spoken, no price → catalog default applied |
| KI-06 | Receipt HTML not escaped | Product name containing `<img onerror>` renders as text |
| KI-07 | Learning scope defaulted to `"global"` | Two shops never share learned data |
| KI-08 | Rounded per line **and** on the sum | ₹10.60 + ₹10.60 displays as a total that equals the lines |
| KI-11 | O(n) catalog scan | Index benchmark at 10,000 products under 16 ms |
| KI-13 | Bill language saved but never read | Setting `hi` produces a Hindi receipt |
