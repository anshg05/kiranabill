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

// KB-383 (doc 25 §2; owner, 9 Nov 2026): the V3 prompt - nocat-D103's rules, plus: units only from the list (size words stay in the name,
// A60), repeats written twice and kept as two lines (A39, A40), removal only when the item is named (KB-367, A41), the quantity rule as
// D105 has it, Devanagari names AND transcript, A19's example in rule 3.
const D103_RULE_3 = EZY_D103_NOCAT_PROMPT.split("\n").find((l) => l.startsWith("3. "))!;
const D103_RULE_4 = EZY_D103_NOCAT_PROMPT.split("\n").find((l) => l.startsWith("4. "))!;
const TRANSCRIPT_RULE = EZY_D103_NOCAT_PROMPT.split("\n").find((l) => l.startsWith("transcript: "))!;
const RULE_1 = EZY_D103_NOCAT_PROMPT.split("\n").find((l) => l.startsWith("1. spokenName"))!;
const RULE_2 = EZY_D103_NOCAT_PROMPT.split("\n").find((l) => l.startsWith("2. A spoken correction"))!;

export const EZY_V3_PROMPT = EZY_D103_NOCAT_PROMPT.replace(
  TRANSCRIPT_RULE,
  `transcript: exactly the words that were spoken, written in Devanagari - English words and brands as they sound ("लाइज़ॉल", "फेयर एंड लवली"), numbers as digits. Nothing added, nothing corrected, nothing left out - keep corrections such as "नहीं नहीं", and an item said twice is written twice.`,
)
  .replace(RULE_1, `${RULE_1.replace(/\.$/, "")}, written in Devanagari - brands as they sound ("लाइज़ॉल", never "Lizol").`)
  .replace(
    RULE_2,
    `${RULE_2}
2a. An item said twice ("2 किलो शक्कर, 2 किलो शक्कर") is TWO lines - never merge repeated items.
2b. "हटा दो" / "निकाल दो" / "cancel" WITH an item named ("लास्ट वाला चना दाल हटा दो") removes that item's line. If no item is named ("हटा दो", "सब हटा दो", "लास्ट वाला हटा दो"), remove NOTHING - keep every line.`,
  )
  .replace(
    D103_RULE_3,
    `${D103_RULE_3} The number's unit wins even when the name is between them: "एक किलो लाल मिर्ची पैकेट" = 1 kg.
3a. unit is EXACTLY one of: kg, gm, liter, ml, piece, packet, dozen, box, bottle, pouch, bag, can, tin, set - in English ("बोतल" = "bottle", "पीस" = "piece", "डिब्बा" = "box"). A size or kind word is part of the NAME, never a unit: "हार्पिक बड़ा", "हार्पिक छोटा".`,
  )
  .replace(
    D103_RULE_4,
    `4. qty only as spoken, with two exceptions: a per-kilo / per-litre price with no quantity = qty 1 of that unit; "X वाला" with no quantity, where X is a price = qty 1 piece ("बड़ा वाला" is part of a name, not a price). Only a total said = qty null - and never any other 1.`,
  );
