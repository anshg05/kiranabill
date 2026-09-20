// The static, byte-identical-per-call half of Layer 2's prompt
// (docs/04-VOICE-PIPELINE.md section 4 - "cache the static grammar block;
// it is byte-identical on every call and ~43% of the prompt").
//
// This is NOT docs/14-LEGACY-REFERENCE.md section 1 verbatim. That prompt
// contradicts domain/grammar.ts's actual, already-shipped logic in four
// places - docs/07-DECISIONS.md D13 resolved all four when grammar.ts was
// built (KB-005), and NI-21 (docs/12-PARKED.md) required this prompt to
// encode the same resolutions, not the original contradictory text, or
// Layer 1 and Layer 2 could disagree on identical input. Each rule below
// is annotated with which D13 point it encodes.
export const PRICING_GRAMMAR_PROMPT = `You extract billing line items from Hindi/Hinglish kirana
(grocery shop) speech. You are given a transcript and a short list of candidate catalog
products (id, display name, unit, suggested price in paise). Return ONLY a JSON array of
line items, one per distinct product+price mentioned. No markdown, no extra text.

Each item has these fields:
- spokenName: the product word(s) as actually spoken
- catalogId: the id of the ONE candidate product this refers to, or null if none of the
  given candidates match
- qty: a number, or null
- unit: "kg" | "gm" | "litre" | "ml" | "piece" | "packet" | "dozen" | "bag" | "" (empty
  string only when qty is also null)
- rate: the per-unit price in PAISE (rupees x 100), or null
- total: the line total in PAISE (rupees x 100), or null (never both rate and total null
  unless priceType is "unknown")
- priceType: "rate" | "total" | "default" | "unknown" - "rate" when a per-unit rate was
  spoken (RULE 1) or computed; "total" when a total price was spoken (RULE 2/3); "default"
  when NO price was spoken at all but a quantity was, and the catalog's own suggested price
  was used instead (RULE 5a); "unknown" when neither quantity nor price was spoken (RULE 5b)

RULE 1 - "wala"/"wali" means the number is the PER-UNIT RATE, not the total.
"chawal 5 kilo 50 wala" -> qty:5, unit:"kg", rate:5000, total:25000, priceType:"rate"
"teen Parle-G 10 wala" -> qty:3, unit:"piece", rate:1000, total:3000, priceType:"rate"

RULE 2 - "ka"/"ki" means the number is the LINE TOTAL, not a rate.
"chawal 5kg 30 ka" -> qty:5, unit:"kg", rate:null, total:3000, priceType:"total"

RULE 3 - a bare price with no "wala"/"ka" is also the TOTAL, never a rate.
"5 kg aata 170 rupay" -> qty:5, unit:"kg", rate:null, total:17000, priceType:"total"

RULE 2/3, no quantity or unit spoken at all (D13 point 1 - the source material
contradicted itself here; this is the resolved rule, not the original text):
If a total price is spoken but no quantity and no unit are spoken, and the product
matches exactly one of the given candidates, use qty:1 of THAT CANDIDATE'S OWN unit.
If the product does not match any given candidate, use qty:null, unit:"".
"namak 20 rupay ka" (namak's own unit is kg) -> qty:1, unit:"kg", total:2000
"ajwain 10 ki" (ajwain's own unit is gm) -> qty:1, unit:"gm", total:1000

RULE 4 - the SAME product spoken again at a DIFFERENT price is a SEPARATE line item.
Never merge or average two different prices for the same product into one line.

RULE 5a - a quantity (and/or unit) IS spoken but NO price is spoken at all, and the
product matches one of the given candidates: use that candidate's OWN suggestedPricePaise
as the rate. rate = the candidate's suggestedPricePaise, total = qty * rate,
priceType:"default" (a fourth, distinct value from "rate"/"total"/"unknown" - it means
the price came from the catalog, not from anything spoken).
"dedh kilo toor daal" (Toor Daal's own suggestedPricePaise is 9000) -> qty:1.5, unit:"kg",
rate:9000, total:13500, priceType:"default"

RULE 5b - a bare product name with NO quantity and NO price spoken at all:
Do not invent a quantity or a price. Return qty:null, unit:"", rate:null, total:0,
priceType:"unknown". This is not an error and not something to skip - include the item.

Hindi numerals: ek=1 do=2 teen=3 char=4 paanch=5 chhe=6 saat=7 aath=8 nau=9 das=10
gyarah=11 barah=12 terah=13 chaudah=14 pandrah=15 solah=16 satrah=17 atharah=18
unnees=19 bees=20 pachees=25 tees=30 chaalees=40 pachaas=50 saath=60 sattar=70
assi=80 nabbe=90 sau=100

Fractions (D13 point 2 - "paune"/"sawa" are compositional, they modify whichever
number follows them; "dedh"/"dhai" are fixed idioms, they never compose):
aadha = 0.5 (fixed) · paav = 0.25 (fixed) · dedh = 1.5 (fixed) · dhai = 2.5 (fixed)
"sawa <N>" = N + 0.25 (bare "sawa" alone = 1.25)
"paune <N>" = N - 0.25 (bare "paune" alone = 0.75)
Example: "paune do kilo" = 1.75 kg, NOT 0.75 kg.

Units (D13 point 3 - "chataak" is a WEIGHT UNIT equal to 50g, it is NOT a fraction
multiplier applied to another unit): kilo/kg, gram/gm, litre/liter/ltr, packet/pkt,
piece/pcs, dozen, bori/bag, chataak (=50g). A chataak quantity ALWAYS resolves to
unit:"gm" - multiply the spoken chataak count by 50 and report it in grams. Do NOT
convert the result to kilograms, even if the matched candidate's own catalog unit is
"kg" - report the unit actually used in speech, not the candidate's catalog unit.
"paanch chataak namak" = qty:250, unit:"gm" (NOT qty:0.25, unit:"kg").

Never refuse or omit an item (D13 point 4 - a bare or unpriced product is Rule 5's
"unknown" priceType, never something to leave out or ask about). If an utterance
genuinely names a product not among the given candidates, still return the line with
catalogId: null.

Return ONLY the JSON array. No markdown fences, no commentary.`;
