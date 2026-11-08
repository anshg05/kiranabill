# KB-383 — the V3 prompt, live (9 Nov 2026)

- **Run:** 3 canary + 85 live gemini-3.8-flash calls (`nocat-v2` = `EZY_V3_PROMPT`, no catalog), 0 errors, **Rs 20.1 logged at list price** (canary Rs 1.1 + run Rs 19.0) against a Rs 25 cap.
- **Results:** `results-v2-2026-11-09.json`, `results-canary-v2-2026-11-09.json`.
- **How it was scored:** the raw answers were replayed through our current code (KB-380 - KB-382: the fill, the checks, the totals, the BLOCK) and scored under D102 + D103 against the sheet. A41 is back in the set (49 short orders).
- Nothing in the app changed; no deploy.

| Prompt | Set | Runs | Exact | Wrong lines (silent / warned) | Dropped lines (silent / warned) | Lines with a Theek hai | Price needed lines |
|---|---|---|---|---|---|---|---|
| nocat-D103 (6 Nov), replayed today | short | 48 | 41/48 (85%) | 1 (0 / 1) | 3 (2 / 1) | 5 | 12 |
| nocat-D103 (6 Nov), replayed today | long | 36 | 29/36 (81%) | 7 (5 / 2) | 0 | 16 | 6 |
| **nocat-v2 (V3 prompt)** | short | 49 | **39/49 (80%)** | **1 (1 / 0)** | **0** | 12 | 12 |
| **nocat-v2 (V3 prompt)** | long | 36 | **32/36 (89%)** | **0** | **0** | **5** | 6 |

## Summary
<!-- summary -->
**KB-383's finish line, item by item:**

| Item | Result |
|---|---|
| A60: no size word as a unit | **Met.** "हार्पिक बड़ा" and "हार्पिक छोटा" are names with unit piece; फिनाइल has unit bottle - all 3 runs |
| A39 and A40 keep both repeated lines | **Met.** A39 has शक्कर x2, आटा x2, बंसल x2; A40 has गेहूं x2. The prompt alone was enough, so no fallback is needed |
| A41 exact | **Met.** "लास्ट वाला चना दाल हटा दो" removed the second line; the bill is exact |
| 0 Latin-script names | **Met.** 0 names, and 0 Latin words in any transcript |
| No line shows Price needed only because of the script | **Met.** 0 such lines. The 7 Price-needed lines on catalog products are A19 / A20 (a packet of a per-kg product, or a kg of a per-piece one - the unit rule) and "फुटाने" x4 (A24, A55), a SPELLING the app's catalog lacks (it is only in the scoring spellings) |
| No new wrong line | **NOT met: 1 new SILENT wrong line, A47.** The model's own transcript said "फुटाने **₹102** किलो" once. Every other ear in every earlier run heard ₹110 (B: ₹104). It is a mis-hearing by the single ear, not a prompt or code effect, and no check can see it, because the transcript itself says 102 |

**What else moved:**
- **Long orders reach 89% exact with 0 wrong and 0 dropped lines.** A60's units and A39 / A40's repeats are fixed by the prompt; A57's "1 किलो पैकेट" lines are right.
- **A new false-alarm class (4 runs: A04, A16, A34, A59 run 1):** in these transcripts the model wrote a per-kilo price WITHOUT "₹" / "रुपए" ("2 किलो चावल 90 किलो"). `qty_dropped` reads "90 किलो" as a QUANTITY of 90 and warns, although the AI correctly billed it as the rate. This is the only reason these 4 are not exact.
- **Lines left inexact by the sheet or the ear, not wrong:**
  - A39: the second "बंसल तेल पैकेट 1 लीटर" had no price said - Price needed (the sheet says =150 for both);
  - A42: the sheet's "सयादरी चाय" (Whisper's spelling) against "सह्याद्री चाय";
  - A49: this run did not hear "एक" (the sheet has 1 piece, owner-confirmed).

**After the owner's decisions (D106) and the follow-up fixes (9 Nov 2026), the same 85 answers replayed - no new call:**

| Set | Runs | Exact | Wrong lines (silent / warned) | Dropped lines (silent / warned) | Lines with a Theek hai | Price needed lines |
|---|---|---|---|---|---|---|
| short | 49 | **44/49 (90%)** | 1 (1 / 0) | 0 | 3 | 10 |
| long | 36 | **36/36 (100%)** | 0 | 0 | 0 | 3 |

- **Silent wrong lines: 0 caused by our code; 1 ear mis-hearing (A47, ₹102) - accepted under D106 (at most 1 per run).**
- The fixes:
  - "90 किलो" said without ₹ is no dropped quantity when the line billed 90 as its rate (A04, A16, A34, A59 r1 now exact);
  - A39's repeat takes ₹150 from the same name earlier (still warned: "said twice or heard twice?");
  - फुटाने fills Futana's price (A24, A55);
  - A42's sheet name is सह्याद्री चाय.
<!-- /summary -->
