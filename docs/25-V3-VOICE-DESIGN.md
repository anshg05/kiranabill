# 25 — V3 Voice Design

**Created:** 7 Nov 2026 · **Last updated:** 9 Nov 2026 (rev 9) · **Status:** Design - **the whole V3 plan approved by the owner (7 Nov 2026)**. Built: `KB-379` (7 Nov), `KB-380`, `KB-381` (8 Nov), `KB-382` (9 Nov).

**Changes:**
- rev 1 (7 Nov 2026): first version (D105).
- rev 2 (7 Nov 2026, the owner's review):
  - §15 privacy;
  - the finish line is at least 90% exact on short AND on long orders, each separately;
  - 24 kbps is built into the recorder in `KB-385`, and `KB-386` only verifies it;
  - the storage note.
- rev 3 (7 Nov 2026, owner): §11 the price fill across scripts (an open design item); added to `KB-383`'s finish line.
- rev 9 (9 Nov 2026, D106): the finish line counts our code's silent wrong lines strictly and ear mis-hearings apart (at most 1 per run); a repeated item takes its earlier spoken price.
- rev 8 (9 Nov 2026, owner): an edited / hand-typed line keeps (b) against the shop price and (c).
- rev 7 (9 Nov 2026, `KB-382`, owner): §4 gets (c) a per-gram / per-ml price with no "ग्राम" said = BLOCK, and (d) a line with no reference over Rs 10,000 = a clearable HIGH; a typed line is the shopkeeper's statement (none of these fire on it).
- rev 6 (8 Nov 2026, `KB-381`, owner): §3.4 corrected - a fraction word before a ROUND hundred / thousand scales its count ("पौने 200" = 175), not adds 0.25; "X वाला" after a NAME is no price.
- rev 5 (8 Nov 2026, `KB-380`, owner):
  - §2: the correction words are one extendable list, and an unknown form warns;
  - §4: `layer2_disagrees` on an AI answer only when the money differs;
  - §12: 0 silent DROPPED lines joins the finish line;
  - `KB-383`: A39 / A40 keep both repeated lines, or it stops and reports.
- rev 4 (7 Nov 2026, owner: the V3 plan approved):
  - §12: the owner's voice only (a known risk);
  - §5 and `KB-384`: real orders are 3-4 minutes at most.
**Source of truth for:** HOW V3 (`KB-372` + `KB-378` + `KB-367`) is built, and the finish line of each V3 ticket (`KB-379` - `KB-387`).
- The decisions behind it: `07` D101 - D105.
- The measurements: `eval/bakeoff/REPORT-ROUND2.md` and `REPORT-NOCAT.md`.
- The order and status of the work: `24` Phase V.
- Each ticket's row: `06`.
- **Written on the strongest model (D33):** it defines money-safety rules.

**The rules that never change** (`CLAUDE.md`, `04` §7):
- Money is integer paise.
- A rate or total on a line is a number that was spoken (`KB-359`).
- The app never invents a number.
- Never a question mid-bill.
- A line with no price is priced before Bill Banao.
- One warning per line.
- Never auto-change a price or unit.

---

## 1. The pipeline (D104)

```
phone: record (D101 flow) -> the audio kept on the phone (Dexie) until its bill exists
   -> upload straight to Supabase Storage  (shops/<shop_id>/<recording_id>.webm, the user's own session)
   -> POST /voice { recording_id, path }    (a few hundred bytes - never the audio through Netlify)
/voice: auth + the per-shop limit (unchanged) -> the result cache (same recording_id = the same answer, §6)
   -> reads the audio from Storage -> gemini-3.8-flash, thinking level "low", the V3 prompt (§2), NO catalog
   -> on a Gemini failure: the Sarvam backup (§7)
phone: our code after the model (§3) -> the checks (§4) -> the bill
```

- **One Gemini call per bill.** The model name is pinned (`gemini-3.8-flash`, never an alias).
- **The keys stay server-side:** Gemini and `SARVAM_API_KEY` live in Netlify's environment.
- **The model returns** the transcript and the items as JSON. `catalogId` is always null.
- **The AI's numbers are only claims.** Every rate and total is checked against the transcript. Every line total and the grand total are computed by our code (`settleLayer2Items`, `buildFinalBill` / `sumPaise`). REPORT-ROUND2 §3 proved this holds today: 0 of 483 lines unexplained.
- **The transcript is shown the moment it lands** (`04` §2).

## 2. The V3 prompt (from `EZY_D103_NOCAT_PROMPT`, `eval/bakeoff/ezyPrompt.ts`)

The rules from the run stay: names as said; a spoken correction edits the earlier line; prices only from spoken numbers; rule 3 is D103.

**Added in V3** (`KB-383`):
1. **Units come only from the list:** kg, gm, liter, ml, piece, packet, dozen, box, bottle, pouch, bag, can, tin (the app's `RECOGNISED_UNITS`), plus set (D103). A size or kind word stays in the NAME ("हार्पिक बड़ा", "फिनाइल बोतल" -> unit bottle). Why: A60 billed "1 बड़ा", "1 छोटा", "1 बोतल" as units.
2. **A repeated identical item stays TWO lines** (D103 item 2). It is never merged; A39 and A40 were merged by E-flash.
**The correction words are ONE list** (`CORRECTION_MARKERS` in `src/domain/aiAnswerNumbers.ts`: नहीं नहीं, nahi nahi, sorry, करो उसको - `KB-380`).
- **The list is extendable:** a new form is added there, with a test.
- **A correction said in a form NOT on the list is never exempted** (owner, 7 Nov 2026): the numbers it replaced count as dropped, so the bill warns.

3. **"हटा दो" / "निकाल दो" removes the line it names**, or the last line when none is named (`KB-367`, A41). A41 joins the regression set (§12).
4. **Every spokenName is written in Devanagari** - brands as they sound (रिन, लाइज़ॉल, फेयर एंड लवली; D105 item 3). The transcript stays as spoken.
5. **The quantity rule as the owner set it** (D105 addition 2):
   - a per-kilo / per-litre price with no quantity = 1 of that unit (D47's owner ruling, A58);
   - "X वाला" / "X वाली" with no quantity = 1 piece (A42 "दंतकांति 60 वाला" = 1 piece);
   - only a total said = qty null (D47);
   - **any other quantity 1 that nobody said is wrong** (A49).

## 3. Our code after the model (deterministic; `KB-381`, `KB-382`)

1. **The price fill** (`fillFromCatalog`, D102): a line with no price said gets the shop price only when its as-said name clearly matches ONE catalog item. Several or none = Price needed. A spoken price is never touched.
2. **The quantity check on an AI answer (replaces `KB-359`'s piece rule there; proven necessary).** Today `checkLayer2AgainstSpoken` drops a quantity it cannot find in Layer 1's PIECE for that line. On A57 the AI said 5 in all 9 runs, but Layer 1 cut "रिन साबुन 10 वाली | 5 पीस ..." whenever the transcript had no comma, so the bill depended on punctuation. **V3 rule:**
   - an AI quantity stands when that number is spoken in the transcript, in order (the walk `checkLayer2NumberOrder` already does);
   - or when it is the implied 1 of §2 item 5;
   - otherwise it is dropped, and the line warns.

   Layer 1's cut is never used to judge an AI answer.
3. **A38 fix (a) - the price unit is read from the spoken words** (D103 item 3a). For a line with a gm / ml quantity and a rate, our code finds that rate's number in the transcript (the same in-order walk). If the next word is "किलो" / "kilo" / "लीटर" ("56 रुपए किलो", "₹56 किलो", "56 का किलो"), then:
   - the rate is per kg / liter;
   - the total is `lineTotalPaiseScaled(qty, rate, -3)`, whatever unit the AI gave.

   A38: 500 gm at "56 रुपए किलो" = Rs 28.
4. **The fraction words before DIGITS** (`extractSpokenNumbers`, shared by Layer 1 and the AI path - fixed in `KB-381`; owner's rule, 8 Nov 2026):
   - **Before KB-381:** "पौने 2" read as 0.75 and 2 (Layer 1 billed qty 2), "सवा 2" as 2, and **"साढ़े 300" as 300.5** (Layer 1 billed Rs 300.50). The word forms were always right.
   - **The rule:** a digit reads the same as the word.
     - With a ROUND hundred or thousand, the word scales its leading count: "पौने 100" = पौने सौ = 75, "सवा 200" = 225, "साढ़े 300" = 350, "डेढ़ 100" = 150, "ढाई 1000" = 2,500.
     - With a small number, it changes that number: "पौने 2" = 1.75, "सवा 2" = 2.25, "साढ़े 2" = 2.5.
     - डेढ़ / ढाई go only with one hundred or one thousand. "डेढ़ 200" stays two numbers - never a guess.
   - **Proven** on both the number reader and Layer 1's bill (`src/domain/fractionNumbers.test.ts`). `bench:numbers` is 0 wrong.
5. **The totals:** line total = qty x rate (scaled across gm/kg, ml/liter) or the spoken total or qty x shop price. The grand total = `sumPaise` of the line totals. **No AI arithmetic is ever billed.**

## 4. The checks on an AI-read bill (`KB-380`, `KB-382`)

Every existing check stays for the Sarvam path (§7). On the Gemini path, six of them are adapted. They caused 77 of E-flash's 112 long-order Theek hai with nothing wrong on the bill (REPORT-ROUND2).

| Check | False alarm today | V3 on an AI answer |
|---|---|---|
| `number_dropped` / `qty_dropped` | The numbers a spoken correction replaced (A59 "2 किलो ... नहीं नहीं 3 किलो"); a pack size ("बंसल तेल 1 लीटर एक पैकेट", A55) | A number inside a correction the AI applied, and a number that is a pack size next to another quantity of the same line, are not "dropped" |
| `number_misaligned` | Its qty-1 rule excuses an unspoken 1 only when no "1" is said anywhere in the order (A58) | The implied 1 of §2 item 5 is excused per line |
| `layer2_disagrees` / `number_unconsumed` | They compare the AI's lines with Layer 1's pieces; Layer 1 cuts differently (A57) | `layer2_disagrees`: on an AI answer **only when the MONEY differs** (owner, 7 Nov 2026 - it is A38's only warning until `KB-382`'s 100x flag; a unit- or quantity-only difference from Layer 1's cut is not raised). `number_unconsumed`: not run on an AI answer. Before this change: §3.2's in-order walk replaces them |
| `unusual_rate` / `unusual_total` | A spoken rate judged against a catalog product the as-said name happened to claim (A34) | Only on lines our code priced from the catalog (§3.1) - a spoken price is the shopkeeper's statement |
| `duplicate_line` | Two different as-said names on one catalog product (A40: बंसल and मदर डिलाइट, both "Tel (1L)") | Compares the SPOKEN names (and numbers), not the catalog id. A real repeat still warns (D103 item 2) |
| `missing_total` on a unit the catalog cannot price (A19: "लाल मिर्ची पैकेट" against a per-kg product) | It shows a Theek hai | It shows **Price needed** |

**A38 fix (b) - the flag a Theek hai cannot clear** (D103 item 3b; the threshold is the owner's, D105 item 2):
- **When it fires:** a line's total is **more than 100x** what its spoken rate and quantity (read per §3.3) would give, or more than 100x qty x the shop's price for the product it names.
- **What it does:** the line must be edited before Bill Banao. `canFinalize` refuses it even when acknowledged, and `buildFinalBill` refuses it as a second guarantee.
- **A spoken total ("=X") is never compared:** it is the shopkeeper's statement (`reviewFlags.ts`, KB-208).
- **A38:** Rs 28,000 against Rs 28 is blocked. After fix (a), the line is Rs 28 and nothing fires.
- **How "what it should give" is computed (built 9 Nov 2026):** in integer paise, with our arithmetic.
  - **R_words:** quantity x the spoken rate, the rate's unit read from the words right after the price (`unitAfterSpokenPrice`: किलो / लीटर / ग्राम / ml / वाला), scaled across g / kg and ml / litre.
  - **R_shop:** quantity x the shop price of the line's product, or, on an AI answer, of the one product its name clearly matches. Only when the units convert.
  - **Blocked when** the total is more than 100x the smaller of the two.
- **(c) owner, 8 Nov 2026 - also BLOCK:** a line priced PER GRAM / PER ML (total = grams x rate) unless "ग्राम" / "gram" / "ml" was said right after the price ("10 रुपये ग्राम"). Kirana rates are per kg, litre, piece or packet; "250 ग्राम जीरा 400 रुपये" can never become Rs 1,00,000, even with no catalog product and no "किलो" said.
- **(d) owner, 8 Nov 2026 - a clearable HIGH, not a block:** a line with no reference at all (no unit word after the price, no shop price) and a total over Rs 10,000.
- **On an edited or hand-typed line** (no transcript; owner, 9 Nov 2026): (b) against the SHOP price and (c) still apply - only the spoken-words reference and (d) need the words. A blocked line edited to a still-absurd value stays blocked (2 kg चीनी at Rs 9,001 a kilo against the shop's Rs 90), a sensible edit clears it (Rs 45), and a typed AMOUNT (a total) is never compared. A typed rate on a gram line is stored per kg (`editRate`), so (c) never catches a typed rate. Measured with no transcript on all 4,833 lines: 0 correct lines blocked.
- **Measured before it was built** (4,833 lines: every saved bill, the sheet, the gate's frozen Whisper bills): (b) and (c) fire on A38's 1,000x lines only; (d) on none; the highest ratio on a right line is 5.6x.
- **Enforced three times:** `pendingChecks` counts a BLOCK acknowledged or not; `canFinalize` never passes it; `buildFinalBill` refuses a bill carrying it (`finaliseBill` throws, nothing is written). The screen shows it like "Price needed" - no Theek hai (checked in the preview browser, 9 Nov 2026).

## 5. The recording flow (D101, `KB-385`)

1. Tap to record -> a timer.
2. **Pause / Resume** (paused time is not recorded) -> **Stop**.
3. Optional playback -> **Re-record** or **Generate bill**.
4. A processing screen -> the full bill, with the usual checks.

- **"Add more by voice"** inside a bill uses the same flow and APPENDS lines.
- **Maximum length: 5 minutes** (D105 item 6). The timer shows it, and the recording stops itself at 5:00. **Real orders are at most 3-4 minutes** (owner, 7 Nov 2026). The 5-minute cap stays as the stop limit, and `KB-384` tests a 3-4 minute recording.
- **Never a question mid-bill.** Typing (Add by hand, the type-ahead) stays available on every screen.

## 6. Reliability: the recording, Retry, offline, one recording = one bill (`KB-384`, `KB-385`)

- **The recording is kept on the phone** (Dexie) until its bill exists, then deleted from the phone. **In Storage it is deleted 7 days after its bill is made** (D105 item 1) by a scheduled clean-up.
- **Retry resends the SAME recording** (the same `recording_id`). The shopkeeper never re-speaks because of a network or provider failure.
- **Offline:** Generate keeps the recording in a local queue with a one-line note, and it is sent when the phone is back online. Typing works meanwhile. Nothing is silently lost (`04` §2: never a silent failure).
- **One recording = one bill:**
  - The phone gives each recording a `recording_id` (UUID) when Stop is tapped.
  - `/voice` keeps the answer per `recording_id` (Netlify Blobs, as the rate limit does, for 7 days). A retry returns that answer, so there is no second Gemini call.
  - The bill records which `recording_id` its lines came from and never appends the same one twice.

## 7. The Sarvam backup (D104 item 2; `KB-384b` - AFTER the V3 release, D108)

**Owner, 10 Nov 2026 (D108): this section ships AFTER the V3 release** - speed to launch. Until then a Gemini failure ends in Retry (the same recording) or Add by hand (§8, `KB-385`); the privacy page does not list Sarvam. Revisited right after launch, or if the pilot shows Gemini failures.


- **When:** Gemini answers 429 or 5xx, does not answer within the time limit `KB-384` measures, or its answer is not valid JSON.
- **What runs:**
  1. Sarvam `saaras:v4` (verbatim; REST up to 30 s, the batch job over 30 s).
  2. Then our reader (Layer 1).
  3. Then the checks - all of them; §4's adaptations are for the Gemini path only.
  4. A piece Layer 1 cannot read goes to Layer 2 if Gemini answers by then; otherwise it is "Not added", with Retry and Add by hand.
- **The same order must give the same bill whichever ear answered** (D105 addition 1). The Sarvam path follows **D102** (names as said) and **D103** (units as said: "सेट" = set in the grammar, the unit next to the number wins). That means Layer 1 changes in V3:
  - the line keeps the spoken name;
  - the catalog only fills an unspoken price.
- **What the shopkeeper sees:** the same screens. Sarvam is not named on them.
- **Known gap** (to be measured, not assumed): Layer 1 does not apply spoken corrections (A59) or "हटा दो". On the Sarvam path a correction must at least WARN - never a silent extra line. `KB-384`'s finish line measures it.

## 8. Error states - each ends in Retry or Add by hand (`KB-385`)

| State | Shown | Ends in |
|---|---|---|
| No microphone permission | One line: how to allow it | Add by hand |
| Recording empty or under 1 s | "Nothing recorded" | Re-record / Add by hand |
| Offline at Generate | Queued, one line | Sent when online; Add by hand meanwhile |
| Upload to Storage failed | "Couldn't send" | Retry (same recording) / Add by hand |
| Session expired (401 / 403) | Sign-in prompt, the recording kept | Retry after sign-in |
| The shop's hourly limit (429 from `/voice`) | "Too many orders this hour" | Retry later / Add by hand |
| Gemini failed | - (the Sarvam backup runs) | - |
| Gemini and Sarvam both failed, or a timeout | "Couldn't read the order" | Retry (same recording) / Add by hand |
| Nothing understood (0 lines) | The transcript, "No items found" | Re-record / Add by hand |

## 9. The recording bitrate (built in `KB-385`, verified in `KB-386`)

- **Target:** about 24 kbps Opus (`MediaRecorder` `audioBitsPerSecond: 24000`). A 5-minute order is then about 0.9 MB.
- **Built into the recorder in `KB-385`.** `KB-386` only VERIFIES the accuracy on fresh recordings; it does not set the bitrate.
- **Why it matters for storage** (owner, 7 Nov 2026): Supabase's free tier holds 1 GB. Seven days of recordings at 100 bills a day is about 0.5 GB at 126 kbps and about 0.1 GB at 24 kbps. Both figures assume about 45 s per recording on average; the acceptance set averages 12 s short and 36 s long.
- **Today:** about 126 kbps (A61: 1,198 KB for 76 s).
**Measured (KB-386, 10 Nov 2026):**
- **Source:** the owner's phone recordings on draft-v18, read from production Storage.
- **Bitrate:** 155 KB / ~58 s, 43 KB / ~16 s, 200 KB / ~74 s and 64 KB / ~24 s, which is **21.6-22.5 kbps, 21.9 overall** (Opus in WebM, Android Chrome). Before: about 129 kbps (A61). Files are about 6x smaller; a 5-minute order is about 0.8 MB.
- **Storage:** 100 bills/day x 45 s x 7 days is about 0.09 GB.
- **How the length was estimated:** Gemini's input tokens, at about 25 per second of audio plus about 851 for the prompt, fitted on A63 (202 s) and A61 (76 s).
- **Accuracy (owner, 10 Nov 2026):** his real orders were accurate. About 5 orders, mostly long ones, every phone-check item passed, and his head-to-head against Ezy Parchi was "mostly the same".
  - **Recorded as the accuracy evidence:** this is the owner's judgement on fresh orders, NOT the formal same-orders-re-recorded comparison.
  - **The live regression of the 85 (KB-387)** stays the measured check.
- **Verified on FRESH recordings from the owner's phone:**
  - the real bytes per second (a browser may ignore the hint - iOS records mp4);
  - the same exact rate and 0 silent wrong lines as the 126 kbps set, on the same orders re-recorded.

## 10. Cost and quota (D104, D105 addition 3)

- **Cost per bill**, measured, with GST: Rs 0.18 (short) - Rs 0.34 (long). **gemini-3.8-flash doubles on 1 Jan 2027.**
- **A month at 100 bills a day:** Rs 548 - 1,027 today; Rs 1,095 - 2,055 from 2027.
- **The Sarvam backup:** Rs 0.49 a minute + GST, only when it runs.
- **gemini-3.8-flash limits on this project** (owner's AI Studio, Tier 1, 7 Nov 2026): **1,000 requests a minute, 2M tokens a minute, 10,000 requests a day.**
  - A long bill uses about 2,500 - 3,600 tokens (A61: 3,542).
  - The daily 10,000 is shared with eval runs. A live regression run takes 84.
- **The per-shop limit stays:** 300 `/voice` requests an hour.
- **Storage:** Supabase's free tier holds 1 GB. Recordings take about 0.1 GB at 24 kbps and 100 bills a day for 7 days (§9). The measured size is reported in `KB-384` and `KB-386`.
- **A Google billing budget alarm** is a manual step for the owner (§13).

## 11. Names: one script (D102, D105 item 3)

- **Every bill line's name is shown in Devanagari, as said.** Brands are written as they sound (रिन, लाइज़ॉल, फेयर एंड लवली).
- **On the Gemini path the prompt does it** (§2 item 4). The regression set checks it: 0 Latin-script names.
- **On the Sarvam path:** Sarvam writes Devanagari for Hindi. A Latin word it returns is kept as said and counted in `KB-384`.
- **The price fill across scripts - an OPEN design item** (owner, 7 Nov 2026):
  - **The problem:** with every name in Devanagari, `fillFromCatalog` (§3.1) must match a Devanagari brand name to the catalog's Latin name, or the shop's price never fills. For example, लाइज़ॉल must match "Lizol". Today `matchProductName` finds "Lizol" and "लाइजोल" (an alias) but not "लाइज़ॉल" (checked 7 Nov 2026).
  - **Two parts, to be designed in `KB-383`'s PLAN:**
    - (a) transliteration-aware matching in `fillFromCatalog`;
    - (b) Devanagari aliases for the brands in the seed catalog and the shop's catalog.
  - **The D102 rule stays:** one clear match fills the price, and several or none = Price needed.
  - **The finish line (`KB-383`):** on the regression set, no line shows Price needed only because of the script.
- **D102's affected parts** (D102 item 6), designed here:
  - **`KB-368`'s weak-match badge** only applies where our code filled a price from the catalog. A weak name match that fills a price still gets the badge.
  - **The learning engine** keeps learning an alias when the shopkeeper picks a product for a Price-needed line - from finalised bills only (hard rule 8), per shop (rule 12).
  - **The Catalog screen** stays the shop's price list; it no longer names the lines.

## 12. The regression set and the finish lines

- **The set:** the 60 recordings with a written bill (A01 - A62 less A13 and A41), plus **A41** once `KB-383` handles "हटा दो" = 61. Short orders run once and long orders 3 times: 85 runs.
- **Scored by** D102 + D103 against `eval/acceptance/sheet.txt`.
- **Whose voice** (owner, 7 Nov 2026): **the owner's voice only.** He does the live tests on request. **The pilot is the first test of other voices** - a known risk, accepted by the owner.
- **Two ways to run it:**
  - **Offline replay (free, `KB-379`):** the saved raw answers (`items` and `transcript` in the results files) go through the CURRENT code - fill, checks, totals - and are scored. Every code ticket is measured this way.
  - **Live run:** about Rs 18 at list price (Rs 21 with GST) for 85 calls. Only when the prompt changes (`KB-383`), and before the release (`KB-387`). The canary first: A01, A61, A62 (`23` §8).
- **Our code vs the ear (D106, owner 9 Nov 2026):** "silent wrong lines" below means those caused by OUR CODE (the prompt, the fill, the checks, the totals) - strict, 0. An EAR mis-hearing (the billed number is exactly what the model's own transcript says) is counted and reported apart by the replay, accepted at most 1 per full run, and watched in the pilot.
- **The V3 finish line:** **0 silent wrong lines AND 0 silent DROPPED lines** (owner, 7 Nov 2026: an item said but missing from the bill with no warning is a silent undercharge; the replay reports "dropped lines (silent / warned)"; warned = a whole-bill Theek hai or a "Not added" piece; **a wrong line that shows Price needed counts as warned** - it cannot reach Bill Banao unpriced - and Price needed lines are reported in their OWN column, never merged with the Theek hai, owner 8 Nov 2026), **at least 90% exact on SHORT orders AND at least 90% exact on LONG orders, each separately** (owner, 7 Nov 2026). A combined figure could hide the long orders, which are where we failed. It is measured after the false-alarm checks are fixed.

| Ticket | What | Finish line (on the regression set) | D33 |
|---|---|---|---|
| `KB-379` | The regression harness (offline replay) + the scorer fixes: the gate's product hole (`KB-373`); the script artifacts (A27 "Lizol" / लाइज़ॉल, A50 "टूथब्रश" / "टूथ ब्रश", A49 "groundnut oil" / ग्राउंडनट ऑयल - one product, other spelling or script) | The replay reproduces `REPORT-NOCAT.md`'s nocat-D103 numbers exactly before the scorer fixes; after them, no artifact wrong line is left | yes |
| `KB-380` | §4's six check adaptations | Theek hai lines on long orders fall from 103 with no real warning lost: A38, A39, A40, A54 and A19 (Price needed) still flag | yes |
| `KB-381` | §3.2 (the quantity check on an AI answer), §2 item 5's implied-1 rules in our code, the "पौने 2" reader bug | A57 keeps both 5s in every run, comma or not; A42 = 1 piece; A49 has no quantity; A56 run 3 is exact; `bench:numbers` 0 wrong | yes |
| `KB-382` | Both A38 fixes (§3.3, §4 fix b) | A38 is exact; a 100x line cannot reach Bill Banao even after a Theek hai (tested in `canFinalize` and `buildFinalBill`) | yes |
| `KB-383` | The V3 prompt (§2): listed units, repeats as two lines, "हटा दो" (`KB-367`), Devanagari names, the quantity rule | Live run: A60 has no size word as a unit; A39 / A40 keep both lines; A41 is exact; **A39 and A40 keep both repeated lines - if the prompt alone cannot stop the model dropping a repeat from its own transcript, `KB-383` stops and reports it, and the owner decides the fallback** (7 Nov 2026); 0 Latin names; **no line shows Price needed only because of the script** (§11); no new wrong line | yes |
| `KB-384` | The server path: Storage upload and its RLS, `/voice` by path, the result cache, the 7-day clean-up, the Sarvam backup with Layer 1 under D102 / D103, the time limit measured | A **3-4 minute** recording (the longest real order, owner 7 Nov 2026) works end to end and the function's time is measured on it; a retry makes no second Gemini call; with Gemini forced to fail, every one of the 61 recordings gives a Sarvam bill with 0 silent wrong lines and the same names and units as the Gemini bill on every line Layer 1 reads (each difference listed); the function's time limit is measured on the longest orders; **`public/privacy.html` (English and Hindi) is updated in the SAME release, before any recording is stored (§15)** | yes |
| `KB-385` | The phone: the D101 flow, Pause / Resume, the 5-minute cap, playback, **recording at 24 kbps (§9)**, the local queue, Retry, one recording = one bill, §8's error states, Devanagari names on the bill | Each state of §8 is tested and ends in Retry or Add by hand; a retry and a double tap never add lines twice; checked in the preview browser, then on the owner's phone | yes |
| `KB-386` | VERIFY 24 kbps on fresh recordings (§9; the setting itself is built in `KB-385`) | Fresh recordings from the owner's phone: the measured kbps, and the same exact rate and 0 silent wrong lines as their 126 kbps originals | no |
| `KB-387` | The final live regression run, then V4 / V5 (`KB-373`, `KB-374`) | **0 silent wrong lines and 0 silent dropped lines; at least 90% exact on short orders AND at least 90% on long orders, each separately**, live; then the draft, the owner's phone check and his head-to-head against Ezy Parchi (V3b) | yes |

**The order:** `KB-379` -> `KB-380`, `KB-381`, `KB-382` (offline, each measured by the replay) -> `KB-383` (live) -> `KB-384` -> `KB-385` -> `KB-386` -> `KB-387`.

**Whisper and B are kept** until the V3 release is proven on the owner's phone, then deleted (D105 item 4).

## 13. Manual steps for the owner (`18` §5)

1. The Storage bucket and its RLS policy - a migration, additive, compatible with the deployed app (D55 §5). `KB-384`.
2. `SARVAM_API_KEY` in Netlify's environment. `KB-384b` - after the V3 release (D108); not needed for V3.
3. A Google billing budget alarm for the project. Before `KB-387`.
4. Fresh recordings on his phone at 24 kbps. `KB-386`.
5. The phone check and the head-to-head. `KB-387`.

## 14. Not decided here

- **The Gemini time limit inside `/voice`, and the Netlify function's own limit:** measured in `KB-384` (D105 item 5). nocat-D103 measured a 5.8 s median and 7.9 s p90 on long orders, but no 5-minute order was measured.
- **How the Sarvam path warns when it cannot apply a spoken correction:** designed in `KB-384b`'s PLAN (after the V3 release, D108), measured by its finish line.
- **The price fill across scripts** (transliteration-aware matching and Devanagari brand aliases): designed in `KB-383`'s PLAN (§11).

## 15. Privacy (owner, 7 Nov 2026; D91)

`public/privacy.html` is the page Google's consent screen links to (D91). Today it says:
- "KiranaBill does not keep the recordings";
- Groq turns the recording into text;
- Google Gemini only reads an order's TEXT.

**V3 makes all three untrue.** The recording is kept in Supabase Storage for 7 days, the AUDIO goes to Google Gemini, and on the backup it goes to Sarvam.

**The rule:** `privacy.html`, **in English AND Hindi**, is updated **in the same release as `KB-384`, before any recording is stored**. It must say:
- **what is kept:** the voice recording of an order, on our storage (Supabase), and on the phone until its bill is made;
- **for how long:** deleted 7 days after its bill is made (D105 item 1);
- **which companies receive the audio:**
  - Google (Gemini) reads the recording to make the bill;
  - Sarvam AI only when Gemini is unavailable (the backup);
  - **Groq stays listed until Whisper is deleted** (D105 item 4);
- **how to ask for deletion:** the page's existing email and steps, covering recordings too.

`KB-384` is not finished until this page is updated. Its draft is checked against the release's real behaviour before `KB-387`.
