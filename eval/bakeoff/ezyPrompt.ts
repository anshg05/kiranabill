// KB-370 round 2 (owner, 5 Nov 2026): the "Ezy-style" candidates - audio straight to Gemini with a prompt written for D102 (names as said).
// It returns the transcript and the items in the SAME JSON shape as Layer 2 (geminiParseProvider's RESPONSE_SCHEMA), so the app's checks
// run on top unchanged. A bake-off prompt only: nothing in the app uses it.

export const EZY_D102_PROMPT = `You turn a RECORDING of a spoken order at an Indian grocery (kirana) shop into a bill. Return JSON {"transcript", "items"}.

transcript: exactly the words that were spoken, in the script they were spoken in (Hindi in Devanagari, English words as said). Nothing added, nothing corrected, nothing left out - keep corrections such as "नहीं नहीं".

items: one per product ordered, in the order said. Rules:
1. spokenName is the product name EXACTLY as said ("रिन", "पाउडर", "फेयर एंड लवली"). Never replace it with another name, a brand, or a catalog name.
2. A spoken correction ("नहीं नहीं 3 किलो", "nahi nahi", "sorry", "... करो उसको") CHANGES the earlier line of that product. It is never a new line.
3. qty and unit only as spoken. "पैकेट" / "packet" is unit "packet" even when a weight is said ("1 किलो पैकेट" = 1 packet). "पीस" = "piece". kilo = "kg", gram = "gm", litre = "liter". सवा 1.25, डेढ़ 1.5, पौने दो 1.75, ढाई 2.5, आधा 0.5.
4. A per-kilo / per-litre price with no quantity said = qty 1 of that unit. No quantity and no such price = qty null.
5. Prices in PAISE (₹56 = 5600), copied ONLY from numbers that were spoken:
   - "X रुपये किलो", "X का किलो", "X रुपये लीटर" = a rate per unit: priceType "rate", rate X, total null.
   - "X वाला" / "X वाली" = a rate per piece or packet: priceType "rate".
   - "X रुपये" or "X का" for the whole item = priceType "total", total X, rate null.
   - no price said = priceType "default", rate null, total null.
   - a price was said but cannot be understood = priceType "unknown", rate null, total null.
6. Never invent or compute a number that was not spoken.
7. catalogId: the id of a candidate product ONLY when the spoken name clearly names exactly that one candidate; otherwise null. It never changes spokenName.`;

// KB-370 nocat (owner, 6 Nov 2026): the same call WITHOUT the catalog - our code fills an unspoken price afterwards (pipeline.ts
// fillFromCatalog). nocat-old changes only rule 7 (there is nothing to pick from); nocat-D103 also follows D103 in rule 3.
const RULE_7 = EZY_D102_PROMPT.split("\n").find((l) => l.startsWith("7. catalogId"))!;
const RULE_3 = EZY_D102_PROMPT.split("\n").find((l) => l.startsWith("3. "))!;

export const EZY_D102_NOCAT_PROMPT = EZY_D102_PROMPT.replace(RULE_7, "7. catalogId is always null - there is no product list. Never invent one.");

export const EZY_D103_NOCAT_PROMPT = EZY_D102_NOCAT_PROMPT.replace(
  RULE_3,
  `3. qty and unit only as spoken. The unit is the unit word next to the NUMBER: "1 किलो पैकेट" = 1 kg, "आधा किलो रवा पैकेट" = 0.5 kg. "पैकेट" / "packet" alone = "packet", "सेट" / "set" alone = "set", "पीस" = "piece". kilo = "kg", gram = "gm", litre = "liter". सवा 1.25, डेढ़ 1.5, पौने दो 1.75, ढाई 2.5, आधा 0.5. The unit never changes a price.`,
);
