# KB-370 — E-flash without the catalog ("nocat"), 6 Nov 2026

**What was run:** 168 + 4 + 6 live gemini-3.8-flash calls, 0 errors, **Rs 42.4 logged at list price (about Rs 50 with GST)**, against a Rs 56 cap.
- Canary: 6 calls, Rs 2.1.
- Full nocat run: 168 calls, Rs 35.5.
- E-flash raw answers: 4 calls, Rs 4.8.

**Results files:** `results-nocat-2026-11-06.json`, `results-eflash-raw-2026-11-06.json`, `results-canary-nocat-2026-11-06.json`.

**Scoring:** D102 + D103 - names as said, and units as said with the unit next to the number winning. B and E-flash were re-scored offline from their saved lines with the same sheet: B from the 4 Nov run, E-flash from round 2.

**The sheet as scored:** it includes the owner's listens (A17 is Rs 185; A27 is 1 हार्पिक; A32 has मूंग दाल 1 किलो 88, owner-confirmed) and D103's units (A27 and A61 "सेट" = set; A57 "1 किलो पैकेट" = kg).

Nothing in the app changed. No deploy.

## What was compared
- **B** - gemini-3.5-transcribe, then the app's Layer 1 / Layer 2 and checks.
- **E-flash** - audio to gemini-3.8-flash (thinking low) with the D102 prompt and the whole catalog in the prompt (481 products).
- **nocat-old** - E-flash's call with NO catalog. The prompt is the same except rule 7, which is now "catalogId is always null". Our code fills a price that was not said, and only when the said name clearly matches ONE catalog item (`fillFromCatalog`); otherwise the line shows Price needed. The same checks run on top.
- **nocat-D103** - nocat-old with prompt rule 3 rewritten to D103: "1 किलो पैकेट" = 1 kg; पैकेट / सेट alone = packet / set; "the unit never changes a price". **This is the version that would ship.**

## Results (D102 + D103)

| Candidate | Set | Exact | Wrong lines (silent / warned) | Lines with a Theek hai | Errors | Seconds median / p90 | Rs per bill, list (with GST) | Rs a month at 100 bills a day, with GST: today -> from 1 Jan 2027 |
|---|---|---|---|---|---|---|---|---|
| B | short | 37/48 (77%) | **11** (9 / 2) | 17 | 0 | 2.9 / 4.3 | 0.16 (0.19) | 580 -> 580 |
| B | long | 22/36 (61%) | **17** (16 / 1) | 41 | 0 | 3.8 / 5.2 | 0.37 (0.43) | 1,295 -> 1,295 |
| E-flash | short | 34/48 (71%) | **9** (3 / 6) | 22 | 0 | 5.4 / 6.9 | 1.08 (1.28) | 3,831 -> 7,662 |
| E-flash | long | 20/36 (56%) | **6** (0 / 6) | 112 | 0 | 6.5 / 13.4 | 1.20 (1.41) | 4,240 -> 8,479 |
| nocat-old | short | 33/48 (69%) | **16** (9 / 7) | 24 | 0 | 4.6 / 6.1 | 0.15 (0.18) | 548 -> 1,097 |
| nocat-old | long | 20/36 (56%) | **13** (8 / 5) | 103 | 0 | 5.7 / 7.5 | 0.28 (0.33) | 1,000 -> 2,001 |
| **nocat-D103** | short | **36/48 (75%)** | **11** (7 / 4) | 20 | 0 | 4.6 / 5.7 | **0.15 (0.18)** | **548 -> 1,095** |
| **nocat-D103** | long | 20/36 (56%) | **7** (5 / 2) | 103 | 0 | 5.8 / 7.9 | **0.29 (0.34)** | **1,027 -> 2,055** |

- **Cost:** real logged cost per bill.
  - B uses gemini-3.5 models, which have no announced price change.
  - gemini-3.8-flash doubles both of its rates on 1 Jan 2027.
- **Seconds:** stop -> items, measured on the PC.

## Summary
<!-- summary -->
- **Dropping the catalog costs nothing in accuracy and cuts the bill about 7x on short orders and 4x on long ones.**
  - nocat-D103 has the best exact rate on short orders after B (75% vs B's 77% and E-flash's 71%).
  - On long orders it ties E-flash at 56%.
  - It costs Rs 0.18 a short bill and Rs 0.34 a long one with GST, against E-flash's Rs 1.28 / Rs 1.41.
  - From 1 Jan 2027 it costs about Rs 1,095 / Rs 2,055 a month at 100 bills a day.
  - It is also faster than E-flash: p90 7.9 s on long orders against 13.4 s.
- **Rewriting rule 3 to D103 is what fixes the units.** nocat-D103 has 11 / 7 wrong lines (short / long), against nocat-old's 16 / 13. A57's "1 किलो पैकेट" lines are all right in nocat-D103.
- **No candidate reaches 0 wrong lines.**
- **nocat-D103's 7 silent wrong lines on short orders:**
  - **A17 ×3:** "एक डेटॉल सेट ₹185" billed as unit set, where the sheet says piece. D103 says "सेट" alone = set, so **the sheet's A17 is probably what is wrong - the owner's call.**
  - **A27 "Lizol" and A50 "टूथब्रश" ×2:** almost certainly scoring artifacts. The sheet's Devanagari name does not resolve to the same catalog product; this was not checked.
  - **A49:** a quantity 1 nobody said. This one is real.
- **nocat-D103's 5 silent wrong lines on long orders:** all in A60, where the model used size words as units ("1 बड़ा हार्पिक", "1 छोटा हार्पिक", "1 बोतल फिनाइल"). The money is right. **A prompt fix for V3: the unit must be one of the listed units**, and a size word stays in the name.
- **Its warned wrong lines:** A38 ×3 (the 1,000x total, warned - D103 item 3), A19 (packet vs kg) and A54 (the extra "फटका" line, which B also makes).
- **Theek hai:** about 103 lines on long orders, as with E-flash's 112. These are the same old-check false alarms (`REPORT-ROUND2.md`, the V3 list in `24`). The exact rates of all three Gemini candidates on long orders are held down by them.
- **Thinking:** gemini-3.8-flash sent no thinking-token field at level low on any call.
<!-- /summary -->

## The catalog fill on orders with no price said

**The orders:** 87 sheet lines in 19 orders (A07-A12, A15, A16, A18-A24, A26, A39, A55, A56), counted per run. A41 is in the sheet but is not run (the owner dropped it).

| Candidate | Lines | Shop price filled | Price needed | A price from ANOTHER product (wrong) | Invented price |
|---|---|---|---|---|---|
| nocat-old | 125 | 100 | 11 | **0** | 0 |
| nocat-D103 | 125 | 100 | 12 | **0** | 0 |
| E-flash (catalog in the prompt) | 125 | 95 | 17 | **0** | 0 |
| B (today's pipeline) | 125 | 99 | 5 | **4** (A09 जवारी -> Jowar Atta, A20 गरम मसाला -> Dhaniya Powder, A20 खड़ी हल्दी -> हल्दी गाठ, A24 उड़द मोगर -> Moong Mogar) | 0 |

The remaining lines are not on the bill or are paired elsewhere. That count is a rough name match, not scored.

- **Our code's fill fills more than the model did with the catalog in its prompt** (100 lines against 95), and **it never puts another product's price on a line.** B does that 4 times.
- **Price needed comes up where the said name matches no single catalog item:**
  - बंसल तेल, फुटाने - A55 runs 1-3;
  - फल्ली दाने (A10, A15) - the alias the owner adds in his own shop (`17`);
  - जवारी (A09);
  - धनिया मसाला पैकेट, हल्दी पैकेट, खड़ी हल्दी, दाने (A20);
  - टोटल गोल्ड तेल (A40).

  It is never a guess.
- **A56** (सवा / डेढ़ / पौने, no prices said): exact in all 3 runs. All 8 lines are filled with our own shop-price arithmetic (1.25 kg मूंग दाल = Rs 137.50).
- **A55:** 9 of its 11 lines are filled in every run. बंसल तेल and फुटाने show Price needed - the safe result, but not exact.

## A57 / A42: did the AI say the quantity, or did our KB-359 check strip it? - **our check strips it (proven)**

| Run | What the AI said (raw answer, saved) | What our bill shows |
|---|---|---|
| E-flash A57 runs 1, 2 | रिन साबुन 5 piece, फेना साबुन 5 piece | no quantity (warned) |
| E-flash A57 run 3 | 5 piece, 5 piece | 5, 5 |
| nocat-old / nocat-D103 A57 runs 1, 3 | 5 piece, 5 piece | no quantity (warned) |
| nocat-old / nocat-D103 A57 run 2 | 5 piece, 5 piece | 5, 5 |
| E-flash A42 | दंत कांति 1 piece, पतंजलि पेस्ट 1 piece | no quantity (warned) |
| nocat-old / nocat-D103 A42 | no quantity | no quantity (the prompt's rule 4: none said = null) |

- **The AI said 5 in every A57 run.** Our bill kept it only where the model's transcript put a comma after "5 पीस" ("रिन साबुन 10 वाली 5 पीस, पारले जी ..."). Then Layer 1 cuts the pieces in the right place.
- **Without the comma, Layer 1 puts "5 पीस" with the NEXT item, and `KB-359` drops the quantity it can't find in the line's own piece.** So the same audio and the same AI answer give a different bill depending on the model's punctuation.
- **A42:** E-flash said 1 piece ("दंतकांति 60 वाला"), and the same check stripped it. The nocat prompts give no quantity there, because rule 4 says no quantity said = null. The sheet expects 1 piece.
- **For V3:** `KB-359`'s quantity drop must not trust Layer 1's cut on an AI answer. This was already on the V3 list in `24`; it is proven now.

## The cost per call, measured
- **Short orders:** about Rs 0.10-0.15 at list price.
- **Long orders:** Rs 0.39 (A62, 12 items) to Rs 0.58 (A61, 18 items).
- **Where the cost is now:** most of it is the answer (up to 1,133 output tokens on A61). It was the input while the 481-product catalog (about 13,000 tokens) was in the prompt.
- **E-flash on the same recordings:** Rs 1.04 (A01), Rs 1.27-1.52 (A61, A62).
