# KB-370 — Voice bake-off (V1, report only)

**Scoring:** D102 - names as said (owner, 4 Nov 2026) · **Run:** 2026-11-05 · **Results file:** `eval/bakeoff/results-2026-11-05.json` · Nothing in the app changed; no deploy.
**Rule for any winner:** 0 wrong numbers on a final line (`docs/24-ROADMAP.md` Phase V, D100). "Wrong" = a confident number or product that is not what was said; "silent" = no Theek hai warned about it.

## Summary
<!-- summary -->

**Plain words (round 2, 5 Nov 2026: 252 results, 0 errors, Rs 119.5 logged = about Rs 141 with GST, 25 min; scored under D102 - names as said). B's numbers are from the 4 Nov run re-scored under D102 (`REPORT-D102.md`, after the owner's A19 corrections).**

| D102 | Exact, short | Exact, long | Wrong lines short / long (silent) | Rs a month at 100 bills a day, short / long | Median seconds, long |
|---|---|---|---|---|---|
| **B** (gemini-3.5-transcribe -> the app's Layer 1/2) | 73% | 64% | 11 (9) / 15 (14) | 492 / 1,098 | 3.7 |
| **E-flash** (audio -> gemini-3.8-flash, D102 prompt) | 65% | 47% | 15 (9) / **6 (6)** | 3,247 / 3,593 (**doubles from 1 Jan 2027**: 6,494 / 7,186) | 6.3 (p90 13.4) |
| **S** (Sarvam saaras:v4 -> the app's Layer 1/2) | 65% | 31% | **7 (5)** / 13 (9) | 556 / 1,296 | 6.4 |

- **No candidate reaches 0 wrong lines.**
- **E-flash is the only one that applies spoken corrections** (A59: right in all three runs; B and Sarvam each bill A59's "नहीं नहीं" as extra lines - 9 wrong lines each). **Its only wrong lines on long orders are A61's "सेट" unit** (6 = 2 x 3 runs): it bills unit "set" where the sheet says packet - and the sheet says packet only because "set" was not a unit the sheet knew. On short orders its 15 are mostly units again ("पैकेट" billed as packet where the sheet says kg; "सेट" as set) - open question 5 - plus A38's three totals 1,000 times too big (the gram / kilo sum; each warned), and A50 "टूथ ब्रश" vs "टूथब्रश" (likely a scoring artifact of the space).
- **But E-flash shows about 3 Theek hai per long order** (112 over 36 runs) - from the app's own checks, not the B cross-check: that is why its exact rate is lower. **Found offline on 5 Nov - see "Offline analysis" below: 77 of the 112 are false alarms from checks built for the old pipeline.**
- **Two ears vs one ear for E-flash: no difference at all** (the same wrong lines; B's transcript always had E-flash's numbers). The second ear costs a second call and adds nothing on these 60 recordings.
- **Sarvam is the cheapest and has the fewest wrong lines on short orders**; its batch wait is short (upload 1.5 s, queue + processing 3.7 s, download 0.8 s on average; worst queue 4.0 s) - it could work at the counter. Its losses: A59's corrections (9) and 4 catalog prices from the wrong product (it feeds today's pipeline, which is not D102 yet).
- **Every ear hears the same thing in three places** - A17 "₹185" (the bill said Rs 125), A27 "हार्पिक एक", A32 "मूंग दाल". **The owner listened again (5 Nov): all three ears were right** - the sheet now has 185, 1 हार्पिक and 1 kg मूंग दाल =88 (the tables below are from before that correction; the re-scores below include it).
- **Thinking:** gemini-3.8-flash returned no thinking-token field at level `low` on any of the 84 calls.

### Offline analysis (5 Nov 2026, after round 2 - no call; the saved lines and transcripts)

**1. Where E-flash's Theek hai come from.** Our checks were re-run on E-flash's saved lines: the rebuilt warnings match the saved ones exactly (21 short-order lines, 112 long, 0 mismatches). **All 112 long-order lines come from whole-bill checks** (they warn every line of the order), in 13 runs of 6 recordings:

| Recording (runs) | Lines | Check | What happened | Verdict |
|---|---|---|---|---|
| A59 (3) | 15 | number_dropped, qty_dropped | E-flash applied "नहीं नहीं"; the corrected-away "2 किलो", "56", "4 किलो" are on no line | **False alarm** - the check assumes every spoken number lands on a line |
| A58 (3) | 21 | number_misaligned | "बरबटी दाल ₹88 किलो" = 1 kg (D47); the check excuses an unspoken 1 only when no "1" is said anywhere, and "1 किलो" is said twice earlier | **False alarm** - the check's qty-1 rule |
| A55 (3) | 33 | number_dropped, qty_dropped | "बंसल तेल 1 लीटर एक पैकेट": 1 litre is the pack size; E-flash bills 1 packet (the sheet's line) | **False alarm** - pack size |
| A56 (run 3) | 8 | number_dropped, number_misaligned | The transcript wrote "पौने 2"; our reader reads it as [0.75, 2] (and "पौने दो" as [1.75] - runs 1 and 2) | **False alarm - a reader BUG for V3** (any ear writing the digit hits it) |
| A57 (3) | 27 | missing_total, number_dropped, layer2_disagrees, number_unconsumed | Rin and Fena soap have no quantity. Layer 1 cuts "रिन साबुन 10 वाली / 5 पीस पारले जी ..." so the 5 is in the next piece, and `KB-359` drops a quantity it cannot find in the line's own piece | **Real problem, SUSPECTED to be caused by our check** - in a simulation, qty 5 is stripped to none; E-flash's raw answer was not saved, so not proven |
| A54 (run 3) | 8 | missing_total, number_misaligned | "फटका" (part of तुवर दाल फटका) became a second line, with ₹150 copied to it | **Real** - an extra line |

**77 lines (10 runs) are false alarms; 35 lines (4 runs) point to a real problem, 27 of them (A57) suspected to be our `KB-359`.**
Short orders (21 lines): A38 3 (real, 1,000x); A39 5 and A40 5 (real: E-flash MERGED the repeated items - D103 says they stay two lines; A40 also has a false `duplicate_line`: बंसल and मदर डिलाइट claim one catalog product); A42 2 (real, suspected `KB-359` again - "दंतकांति 60 वाला" with qty 1 is stripped in a simulation); A19 1 (no price: a packet for a per-kg product - should be Price needed, not a Theek hai); A34 1 (false: the as-said "तेल" claims a Rs 25 product and the spoken Rs 140 is judged against it); A35 1 and A36 3 (false: the unit, and the "1 लीटर" pack size).

**2. Units.** First scored with a looser rule (a unit word said anywhere near the item counts): E-flash 0 wrong lines on long orders. **The owner decided D103 instead: the unit next to the NUMBER wins.** Re-scored with the owner's A17 / A27 / A32 corrections, D103's sheet units applied in memory (A27 and A61 "सेट" = set; A57 "1 किलो पैकेट" = kg), litre = liter:

| Candidate | Exact short: D102 -> D103 | Exact long: D102 -> D103 | Wrong short (silent): D102 -> D103 | Wrong long (silent): D102 -> D103 |
|---|---|---|---|---|
| A | 26/48 (54%) -> 26/48 (54%) | 8/36 (22%) -> 7/36 (19%) | 12 (6) -> 15 (9) | 30 (9) -> 38 (17) |
| B | 38/48 (79%) -> 37/48 (77%) | 23/36 (64%) -> 22/36 (61%) | 8 (6) -> 11 (9) | 15 (14) -> 17 (16) |
| C | 31/48 (65%) -> 30/48 (63%) | 17/36 (47%) -> 15/36 (42%) | 14 (6) -> 13 (8) | 12 (3) -> 8 (7) |
| D | 33/48 (69%) -> 32/48 (67%) | 18/36 (50%) -> 17/36 (47%) | 12 (5) -> 11 (7) | 9 (8) -> 8 (8) |
| E-flash | 33/48 (69%) -> 34/48 (71%) | 17/36 (47%) -> 20/36 (56%) | 12 (6) -> 9 (3) | 6 (6) -> **6 (0)** |
| S | 31/48 (65%) -> 31/48 (65%) | 11/36 (31%) -> 11/36 (31%) | 6 (4) -> 9 (7) | 13 (9) -> 22 (15) |

Under D103, **E-flash's 6 long-order wrong lines are all A57's "1 किलो पैकेट" billed as packet - each warned. Its prompt's rule 3 says exactly that ("1 किलो पैकेट" = 1 packet), so the prompt contradicts D103.** Its short-order 9: A38 x3 (warned), the same packet rule in A19 / A20 / A35 / A36, and A50 "टूथ ब्रश" vs "टूथब्रश" x2 (likely a scoring artifact, not checked). The sheet itself still has the old units: D103's sheet edits are made with the next scoring change.

**3. Totals.** Every one of E-flash's 483 saved lines is our arithmetic or a spoken number - 233 qty x spoken rate, 101 qty x shop price, 117 a total that is in the transcript, 32 with no total; **0 unexplained**. The grand total is `sumPaise` of our line totals (`buildFinalBill`, `src/domain/finalBill.ts`). The AI's own sum is never billed; `KB-366` only uses it to choose between two readings that are both our arithmetic.
**A38 is NOT impossible to bill today.** E-flash labelled "56 रुपए किलो" as Rs 56 per GRAM; our code multiplies literally (500 x Rs 56 = Rs 28,000) unless the AI's own total is exactly the per-kilo one (Rs 28). Replay: AI total 2800 -> 2800; 2800000 -> 2800000; 999 -> 2800000; none -> 2800000. Three HIGH checks warn, but one Theek hai tap clears them (`canFinalize`) and `buildFinalBill` only refuses a line with no amount. **D103 item 3: both fixes in V3** - our code reads the price unit from the words, and a backstop a Theek hai cannot clear.

**Not approved: "ear + brain"** (a saved B or Sarvam transcript as text to gemini-3.8-flash with the D102 prompt) - estimated Rs 1.14-1.17 a short bill and Rs 1.38-1.42 a long one against E-flash's Rs 1.08 / 1.20, slower (two calls in a row), and B keeps its 100-a-day cap (D103 item 5).

<!-- /summary -->

## What was compared
- **A** - today: Groq whisper-large-v3 (8 s limit) -> Layer 1 -> Layer 2 (gemini-3.5-flash-lite) -> checks
- **A+vocab** - A with the KB-007 vocabulary prompt
- **A-30s** - A with a 30 s Groq limit (long orders only) - separates 'Whisper mis-heard' from 'the 8 s limit cut it off'
- **B** - gemini-3.5-transcribe (with vocabulary) -> the same Layer 1 + Layer 2 + checks
- **B-novocab** - B without the vocabulary
- **C** - audio -> gemini-3.5-flash-lite: transcript + items in one call -> the same checks on its transcript
- **C2** - C with gemini-3.8-flash
- **D** - hybrid: C's items, a number counts only if B's transcript has it (no extra calls)
- **B-smart** - round 2: B with gemini-3.5-transcribe's SMART mode (resolves spoken corrections) -> Layer 1 + Layer 2 + checks
- **E-lite** - round 2, Ezy-style: audio -> gemini-3.5-flash-lite with the D102 prompt (names as said, corrections edit the line) -> checks; every number must also be in B's transcript
- **E-flash** - round 2, Ezy-style: the same with gemini-3.8-flash at thinking level low - TWO ears: every number must also be in B's saved transcript
- **E-flash-1ear** - the SAME E-flash answers checked only against E-flash's own transcript - one call per bill, as Ezy probably works (no extra calls)
- **S** - round 2: Sarvam saaras:v4 (verbatim) as the ear -> Layer 1 + Layer 2 + checks; batch API over 30 s

Models (exact names): groq `whisper-large-v3`, transcribe `gemini-3.5-transcribe`, layer2 `gemini-3.5-flash-lite`, c `gemini-3.5-flash-lite`, c2 `gemini-3.8-flash`. Vocabulary (A+vocab, B): 40 terms from `eval/real-transcripts.json` - Chini, चीनी, Parle-G 10, पारले जी, Chawal, चावल, Sabun, फेना, Chakki Aata, पिसा आटा, Besan, बेसन, Jeera, साबुत जीरा, बरबटी दाल, बरबटी दाल, Surf Excel, सर्फ, Toor Daal, दाल, Moong Daal, मूंग दाल, Kala Chana, काला चना, गेहूं, गेहूं, Moong Mogar, धुली मूंग दाल, Chai Patti, चाय, Maggi, मैगी, Tel (1L), तेल, Masoor Daal, मसूर दाल, Futana, फ़ुटाना, हरा बटाना, हरा बटाना.
Prices: Gemini: ai.google.dev/gemini-api/docs/pricing (last updated 2026-10-30); Groq: console.groq.com/docs/speech-to-text (read 31 Oct 2026). Rupees at **Rs 95.17 per $** (the last RBI reference rate found when the run was set up; re-run `npm run bakeoff -- --inr-per-usd <today's>` to change it).
Seconds = the providers' own call times added up on the PC (end of recording -> items), not the phone's upload; D runs B and C side by side (the slower of the two).

## Short orders (A01-A50, once each)
| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated silent / warned | Invented | Numbers right, name wrong | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **E-flash** | 48 x 1 | 31/48 (65%) | **15** (9) | 13 | 2 | 4 | 0 / 0 | 1 | 0 | 22 | 0 | 5.3 / 6.9 / 8.6 | Rs 1 | Rs 3247 |
| **E-flash-1ear** | 48 x 1 | 31/48 (65%) | **15** (9) | 13 | 2 | 4 | 0 / 0 | 1 | 0 | 21 | 0 | 5.3 / 6.9 / 8.6 | Rs 1 | Rs 3247 |
| **S** | 48 x 1 | 31/48 (65%) | **7** (5) | 6 | 1 | 0 | 0 / 0 | 1 | 3 | 28 | 0 | 1.9 / 3.1 / 8.9 | Rs 0.19 | Rs 556 |

**E-flash at the price from 1 Jan 2027** (both gemini-3.8-flash rates double): Rs 2 per bill, Rs 6494 a month at 100 bills a day (today: Rs 1 / Rs 3247).


### The 7 orders Whisper mis-heard on 30 Oct (set aside from the gate): A19, A27, A32, A33, A34, A35, A39
| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated silent / warned | Invented | Numbers right, name wrong | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **E-flash** | 7 x 1 | 1/7 (14%) | **7** (5) | 7 | 0 | 3 | 0 / 0 | 1 | 0 | 9 | 0 | 6.0 / 7.5 / 7.5 | Rs 1 | Rs 3396 |
| **E-flash-1ear** | 7 x 1 | 1/7 (14%) | **7** (5) | 7 | 0 | 3 | 0 / 0 | 1 | 0 | 8 | 0 | 6.0 / 7.5 / 7.5 | Rs 1 | Rs 3396 |
| **S** | 7 x 1 | 2/7 (29%) | **2** (1) | 2 | 0 | 0 | 0 / 0 | 1 | 0 | 10 | 0 | 3.0 / 8.9 / 8.9 | Rs 0.33 | Rs 975 |

## Long orders (A51-A62, 3 runs each)
| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated silent / warned | Invented | Numbers right, name wrong | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **E-flash** | 12 x 3 | 17/36 (47%) | **6** (6) | 6 | 0 | 0 | 0 / 0 | 0 | 2 | 112 | 0 | 6.3 / 13.4 / 15.4 | Rs 1 | Rs 3593 |
| **E-flash-1ear** | 12 x 3 | 17/36 (47%) | **6** (6) | 6 | 0 | 0 | 0 / 0 | 0 | 2 | 112 | 0 | 6.3 / 13.4 / 15.4 | Rs 1 | Rs 3593 |
| **S** | 12 x 3 | 11/36 (31%) | **13** (9) | 13 | 0 | 0 | 6 / 0 | 0 | 3 | 64 | 0 | 6.4 / 8.3 / 11.0 | Rs 0.43 | Rs 1296 |

**E-flash at the price from 1 Jan 2027** (both gemini-3.8-flash rates double): Rs 2 per bill, Rs 7186 a month at 100 bills a day (today: Rs 1 / Rs 3593).


### Long orders per recording (over the runs)
| Recording | Length | Candidate | Exact runs | Best (fewest wrong lines) | Worst | Average | Avg seconds |
|---|---|---|---|---|---|---|---|
| A51 | 27.9 s | E-flash | 3/3 | 0 | 0 | 0.0 | 5.7 |
| A51 | 27.9 s | E-flash-1ear | 3/3 | 0 | 0 | 0.0 | 5.7 |
| A51 | 27.9 s | S | 0/3 | 0 | 0 | 0.0 | 2.7 |
| A52 | 23.3 s | E-flash | 3/3 | 0 | 0 | 0.0 | 7.1 |
| A52 | 23.3 s | E-flash-1ear | 3/3 | 0 | 0 | 0.0 | 7.1 |
| A52 | 23.3 s | S | 0/3 | 0 | 0 | 0.0 | 2.2 |
| A53 | 29.0 s | E-flash | 3/3 | 0 | 0 | 0.0 | 9.4 |
| A53 | 29.0 s | E-flash-1ear | 3/3 | 0 | 0 | 0.0 | 9.4 |
| A53 | 29.0 s | S | 3/3 | 0 | 0 | 0.0 | 1.1 |
| A54 | 30.8 s | E-flash | 2/3 | 0 | 0 | 0.0 | 6.2 |
| A54 | 30.8 s | E-flash-1ear | 2/3 | 0 | 0 | 0.0 | 6.2 |
| A54 | 30.8 s | S | 0/3 | 0 | 0 | 0.0 | 8.7 |
| A55 | 31.4 s | E-flash | 0/3 | 0 | 0 | 0.0 | 6.1 |
| A55 | 31.4 s | E-flash-1ear | 0/3 | 0 | 0 | 0.0 | 6.1 |
| A55 | 31.4 s | S | 0/3 | 0 | 0 | 0.0 | 8.1 |
| A56 | 30.8 s | E-flash | 1/3 | 0 | 0 | 0.0 | 9.3 |
| A56 | 30.8 s | E-flash-1ear | 1/3 | 0 | 0 | 0.0 | 9.3 |
| A56 | 30.8 s | S | 3/3 | 0 | 0 | 0.0 | 5.7 |
| A57 | 49.3 s **(over 40 s)** | E-flash | 0/3 | 0 | 0 | 0.0 | 7.0 |
| A57 | 49.3 s **(over 40 s)** | E-flash-1ear | 0/3 | 0 | 0 | 0.0 | 7.0 |
| A57 | 49.3 s **(over 40 s)** | S | 0/3 | 1 | 2 | 1.3 | 8.7 |
| A58 | 31.4 s | E-flash | 0/3 | 0 | 0 | 0.0 | 6.2 |
| A58 | 31.4 s | E-flash-1ear | 0/3 | 0 | 0 | 0.0 | 6.2 |
| A58 | 31.4 s | S | 3/3 | 0 | 0 | 0.0 | 6.0 |
| A59 | 31.0 s | E-flash | 0/3 | 0 | 0 | 0.0 | 5.6 |
| A59 | 31.0 s | E-flash-1ear | 0/3 | 0 | 0 | 0.0 | 5.6 |
| A59 | 31.0 s | S | 0/3 | 3 | 3 | 3.0 | 6.9 |
| A60 | 19.6 s | E-flash | 2/3 | 0 | 0 | 0.0 | 5.2 |
| A60 | 19.6 s | E-flash-1ear | 2/3 | 0 | 0 | 0.0 | 5.2 |
| A60 | 19.6 s | S | 2/3 | 0 | 0 | 0.0 | 2.6 |
| A61 | 76.1 s **(over 40 s)** | E-flash | 0/3 | 2 | 2 | 2.0 | 13.0 |
| A61 | 76.1 s **(over 40 s)** | E-flash-1ear | 0/3 | 2 | 2 | 2.0 | 13.0 |
| A61 | 76.1 s **(over 40 s)** | S | 0/3 | 0 | 0 | 0.0 | 8.1 |
| A62 | 51.4 s **(over 40 s)** | E-flash | 3/3 | 0 | 0 | 0.0 | 8.5 |
| A62 | 51.4 s **(over 40 s)** | E-flash-1ear | 3/3 | 0 | 0 | 0.0 | 8.5 |
| A62 | 51.4 s **(over 40 s)** | S | 0/3 | 0 | 0 | 0.0 | 7.3 |

## Every wrong line
| Recording | Length | Candidate | Run | What was wrong | What it heard |
|---|---|---|---|---|---|
| A09 | 4.0 s | S | 1 | जवारी: a price from another product (Jowar Atta) - heard "जवारी" [NO warning] | एक किलो बाजरा एक किलो [जवारी] |
| A17 | 14.9 s | E-flash | 1 | डेटॉल सेट: wrong total 18500 (expected 12500) - heard "डेटॉल सेट" [NO warning] | एक [डेटॉल] सेट ₹185, एक संदूर सेट ₹40, एक संदूर … |
| A17 | 14.9 s | E-flash-1ear | 1 | डेटॉल सेट: wrong total 18500 (expected 12500) - heard "डेटॉल सेट" [NO warning] | एक [डेटॉल] सेट ₹185, एक संदूर सेट ₹40, एक संदूर … |
| A19 | 16.4 s | E-flash | 1 | लाल मिर्च: wrong unit packet (expected kg) - heard "लाल मिर्ची" [a Theek hai warned] | … बरबटी दाल एक किलो चना दाल एक किलो [लाल] मिर्ची पैकेट |
| A19 | 16.4 s | E-flash-1ear | 1 | लाल मिर्च: wrong unit packet (expected kg) - heard "लाल मिर्ची" [a Theek hai warned] | … बरबटी दाल एक किलो चना दाल एक किलो [लाल] मिर्ची पैकेट |
| A19 | 16.4 s | S | 1 | लाल मिर्च: wrong unit packet (expected kg) - heard "लाल मिर्ची पैकेट" [a Theek hai warned] | … बरबटी दाल एक किलो चना दाल एक किलो [लाल] मिर्ची पैकेट |
| A20 | 20.8 s | E-flash | 1 | गरम मसाला: wrong unit packet (expected kg) - heard "धनिया मसाला पैकेट" [NO warning] | 1 किलो गरम मसाला पैकेट 1 किलो [धनिया] मसाला पैकेट 1 किलो हल्दी पैकेट 1 किलो … |
| A20 | 20.8 s | E-flash-1ear | 1 | गरम मसाला: wrong unit packet (expected kg) - heard "धनिया मसाला पैकेट" [NO warning] | 1 किलो गरम मसाला पैकेट 1 किलो [धनिया] मसाला पैकेट 1 किलो हल्दी पैकेट 1 किलो … |
| A20 | 20.8 s | S | 1 | गरम मसाला: a price from another product (Dhaniya Powder) - heard "धनिया मसाला" [NO warning] | एक किलो गरम मसाला पैकेट एक किलो [धनिया] मसाला पैकेट एक किलो हल्दी पैकेट एक किलो … |
| A20 | 20.8 s | S | 1 | खड़ी हल्दी: a price from another product (हल्दी गाठ) - heard "खड़ी हल्दी" [a Theek hai warned] | … मसाला पैकेट एक किलो हल्दी पैकेट एक किलो [खड़ी] हल्दी एक किलो दाने एक किलो चावल एक … |
| A24 | 16.6 s | S | 1 | उड़द मोगर: a price from another product (Urad Daal) - heard "उडद" [NO warning] | तुअर दाल दो किलो एक सौ पचास रुपये किलो वाली मूंग दाल एक किलो छियानवे रुपये किलो |
| A27 | 31.4 s | E-flash | 1 | डेटॉल साबुन सेट: wrong unit set (expected piece) - heard "डेटॉल साबुन सेट" [NO warning] | [डेटॉल] साबुन सेट एक ₹185 संतूर साबुन सेट एक … |
| A27 | 31.4 s | E-flash | 1 | संतूर साबुन सेट: wrong unit set (expected piece) - heard "संतूर साबुन सेट" [NO warning] | डेटॉल साबुन सेट एक ₹185 [संतूर] साबुन सेट एक ₹140 डेटॉल हैंडवाश एक ₹100 … |
| A27 | 31.4 s | E-flash | 1 | हार्पिक: a quantity 1 nobody said - heard "हार्पिक" [NO warning] | … ₹140 डेटॉल हैंडवाश एक ₹100 लाइजोल एक ₹110 [हार्पिक] एक ₹100 रिन साबुन एक सेट ₹100 फेना … |
| A27 | 31.4 s | E-flash | 1 | रिन साबुन: wrong unit set (expected piece) - heard "रिन साबुन" [NO warning] | … एक ₹100 लाइजोल एक ₹110 हार्पिक एक ₹100 [रिन] साबुन एक सेट ₹100 फेना साबुन पांच ₹50 … |
| A27 | 31.4 s | E-flash-1ear | 1 | डेटॉल साबुन सेट: wrong unit set (expected piece) - heard "डेटॉल साबुन सेट" [NO warning] | [डेटॉल] साबुन सेट एक ₹185 संतूर साबुन सेट एक … |
| A27 | 31.4 s | E-flash-1ear | 1 | संतूर साबुन सेट: wrong unit set (expected piece) - heard "संतूर साबुन सेट" [NO warning] | डेटॉल साबुन सेट एक ₹185 [संतूर] साबुन सेट एक ₹140 डेटॉल हैंडवाश एक ₹100 … |
| A27 | 31.4 s | E-flash-1ear | 1 | हार्पिक: a quantity 1 nobody said - heard "हार्पिक" [NO warning] | … ₹140 डेटॉल हैंडवाश एक ₹100 लाइजोल एक ₹110 [हार्पिक] एक ₹100 रिन साबुन एक सेट ₹100 फेना … |
| A27 | 31.4 s | E-flash-1ear | 1 | रिन साबुन: wrong unit set (expected piece) - heard "रिन साबुन" [NO warning] | … एक ₹100 लाइजोल एक ₹110 हार्पिक एक ₹100 [रिन] साबुन एक सेट ₹100 फेना साबुन पांच ₹50 … |
| A32 | 22.3 s | E-flash | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | … रुपये किलो, आटा एक किलो 40 रुपये किलो, [मूंग] दाल एक किलो 88, चना एक किलो 88 |
| A32 | 22.3 s | E-flash-1ear | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | … रुपये किलो, आटा एक किलो 40 रुपये किलो, [मूंग] दाल एक किलो 88, चना एक किलो 88 |
| A32 | 22.3 s | S | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | … रुपये किलो आटा एक किलो चालीस रुपये किलो [मूंग] दाल एक किलो अठ्ठ्यासी चना एक किलो अठ्ठ्यासी |
| A35 | 12.5 s | E-flash | 1 | रवा: wrong unit packet (expected kg) - heard "रवा पैकेट" [a Theek hai warned] | … मदर डिलाइट तेल 1 लीटर ₹150 आधा किलो [रवा] पैकेट ₹23 |
| A35 | 12.5 s | E-flash-1ear | 1 | रवा: wrong unit packet (expected kg) - heard "रवा पैकेट" [a Theek hai warned] | … मदर डिलाइट तेल 1 लीटर ₹150 आधा किलो [रवा] पैकेट ₹23 |
| A36 | 10.4 s | E-flash | 1 | मैदा: wrong unit packet (expected kg) - heard "मैदा पैकेट" [a Theek hai warned] | आधा किलो [मैदा] पैकेट ₹22 एक बंसल तेल पैकेट ₹140 एक … |
| A36 | 10.4 s | E-flash-1ear | 1 | मैदा: wrong unit packet (expected kg) - heard "मैदा पैकेट" [a Theek hai warned] | आधा किलो [मैदा] पैकेट ₹22 एक बंसल तेल पैकेट ₹140 एक … |
| A38 | 11.2 s | E-flash | 1 | शक्कर: wrong total 2800000 (expected 2800) - heard "शक्कर" [a Theek hai warned] | 500 ग्राम [शक्कर] 56 रुपए किलो 500 ग्राम मूंग दाल 96 … |
| A38 | 11.2 s | E-flash | 1 | मूंग दाल: wrong total 4800000 (expected 4800) - heard "मूंग दाल" [a Theek hai warned] | 500 ग्राम शक्कर 56 रुपए किलो 500 ग्राम [मूंग] दाल 96 रुपए किलो 500 ग्राम बरबटी दाल … |
| A38 | 11.2 s | E-flash | 1 | बरबटी दाल: wrong total 4400000 (expected 4400) - heard "बरबटी दाल" [a Theek hai warned] | … ग्राम मूंग दाल 96 रुपए किलो 500 ग्राम [बरबटी] दाल 88 रुपए किलो |
| A38 | 11.2 s | E-flash-1ear | 1 | शक्कर: wrong total 2800000 (expected 2800) - heard "शक्कर" [a Theek hai warned] | 500 ग्राम [शक्कर] 56 रुपए किलो 500 ग्राम मूंग दाल 96 … |
| A38 | 11.2 s | E-flash-1ear | 1 | मूंग दाल: wrong total 4800000 (expected 4800) - heard "मूंग दाल" [a Theek hai warned] | 500 ग्राम शक्कर 56 रुपए किलो 500 ग्राम [मूंग] दाल 96 रुपए किलो 500 ग्राम बरबटी दाल … |
| A38 | 11.2 s | E-flash-1ear | 1 | बरबटी दाल: wrong total 4400000 (expected 4400) - heard "बरबटी दाल" [a Theek hai warned] | … ग्राम मूंग दाल 96 रुपए किलो 500 ग्राम [बरबटी] दाल 88 रुपए किलो |
| A44 | 9.1 s | S | 1 | एवरेस्ट किचन किंग मसाला: wrong product - heard "Everest Kitchen King Masala" (Kitchen King) [NO warning] | एवरेस्ट किचन किंग मसाला सौ ग्राम सौ रुपये छोले मसाला पचास ग्राम पैंतालीस रुपये |
| A50 | 9.5 s | E-flash | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती 1 किलो ₹500 शायद [टूथब्रश] 1 ₹35 टूथब्रश 1 ₹60 |
| A50 | 9.5 s | E-flash | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती 1 किलो ₹500 शायद [टूथब्रश] 1 ₹35 टूथब्रश 1 ₹60 |
| A50 | 9.5 s | E-flash-1ear | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती 1 किलो ₹500 शायद [टूथब्रश] 1 ₹35 टूथब्रश 1 ₹60 |
| A50 | 9.5 s | E-flash-1ear | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती 1 किलो ₹500 शायद [टूथब्रश] 1 ₹35 टूथब्रश 1 ₹60 |
| A57 | 49.3 s **(over 40 s)** | S | 1 | बंसल तेल पाउच: wrong quantity 5 (expected 1) - heard "बंसल तेल पाउच" [a Theek hai warned] | … पीस पारले जी बिस्किट तीस वाला पाँच पैकेट [बंसल] तेल पाउच एक पैकेट एक सौ चालीस रुपये … |
| A57 | 49.3 s **(over 40 s)** | S | 1 | फेना साबुन: wrong price 7500/37500 (expected rate 1000) - heard "फेना डिटर्जेंट" [a Theek hai warned] | … तेल पाउच एक पैकेट एक सौ चालीस रुपये [फेना] साबुन दस वाली पाँच पीस फेना डिटर्जेंट एक … |
| A57 | 49.3 s **(over 40 s)** | S | 2 | फेना साबुन: wrong price null/7500 (expected rate 1000) - heard "फेना डिटर्जेंट" [a Theek hai warned] | … तेल पाउच एक पैकेट एक सौ चालीस रुपये [फेना] साबुन दस वाली पाँच पीस फेना डिटर्जेंट एक … |
| A57 | 49.3 s **(over 40 s)** | S | 3 | फेना साबुन: wrong price null/7500 (expected rate 1000) - heard "फेना डिटर्जेंट" [a Theek hai warned] | … तेल पाउच एक पैकेट एक सौ चालीस रुपये [फेना] साबुन दस वाली पाँच पीस फेना डिटर्जेंट एक … |
| A59 | 31.0 s | S | 1 | चना दाल: wrong price 8000/24000 (expected rate 9200) - heard "चना दाल" [NO warning] | … पाँच किलो गेहूँ चौंतीस रुपये किलो चार किलो [चना] दाल बानवे रुपये किलो नहीं नहीं तीन किलो … |
| A59 | 31.0 s | S | 1 | an extra line: चीनी - heard "चीनी" [NO warning] | … किलो आटा एक सौ पचहत्तर रुपये दो किलो [चीनी] छप्पन रुपये किलो नहीं नहीं तीन किलो चीनी … |
| A59 | 31.0 s | S | 1 | an extra line: चना दाल - heard "चना दाल" [NO warning] | … पाँच किलो गेहूँ चौंतीस रुपये किलो चार किलो [चना] दाल बानवे रुपये किलो नहीं नहीं तीन किलो … |
| A59 | 31.0 s | S | 2 | चना दाल: wrong price 8000/24000 (expected rate 9200) - heard "चना दाल" [NO warning] | … पाँच किलो गेहूँ चौंतीस रुपये किलो चार किलो [चना] दाल बानवे रुपये किलो नहीं नहीं तीन किलो … |
| A59 | 31.0 s | S | 2 | an extra line: चीनी - heard "चीनी" [NO warning] | … किलो आटा एक सौ पचहत्तर रुपये दो किलो [चीनी] छप्पन रुपये किलो नहीं नहीं तीन किलो चीनी … |
| A59 | 31.0 s | S | 2 | an extra line: चना दाल - heard "चना दाल" [NO warning] | … पाँच किलो गेहूँ चौंतीस रुपये किलो चार किलो [चना] दाल बानवे रुपये किलो नहीं नहीं तीन किलो … |
| A59 | 31.0 s | S | 3 | चना दाल: wrong price 8000/24000 (expected rate 9200) - heard "चना दाल" [NO warning] | … पाँच किलो गेहूँ चौंतीस रुपये किलो चार किलो [चना] दाल बानवे रुपये किलो नहीं नहीं तीन किलो … |
| A59 | 31.0 s | S | 3 | an extra line: चीनी - heard "चीनी" [NO warning] | … किलो आटा एक सौ पचहत्तर रुपये दो किलो [चीनी] छप्पन रुपये किलो नहीं नहीं तीन किलो चीनी … |
| A59 | 31.0 s | S | 3 | an extra line: चना दाल - heard "चना दाल" [NO warning] | … पाँच किलो गेहूँ चौंतीस रुपये किलो चार किलो [चना] दाल बानवे रुपये किलो नहीं नहीं तीन किलो … |
| A61 | 76.1 s **(over 40 s)** | E-flash | 1 | डेटॉल साबुन: wrong unit set (expected packet) - heard "डेटॉल साबुन सेट" [NO warning] | तुवर दाल 5 किलो ₹150 किलो [डेटॉल] साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 … |
| A61 | 76.1 s **(over 40 s)** | E-flash | 1 | रिन साबुन: wrong unit set (expected packet) - heard "रिन साबुन सेट" [NO warning] | … साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 [रिन] साबुन सेट 1 ₹105 फेना डिटर्जेंट 3 किलो … |
| A61 | 76.1 s **(over 40 s)** | E-flash-1ear | 1 | डेटॉल साबुन: wrong unit set (expected packet) - heard "डेटॉल साबुन सेट" [NO warning] | तुवर दाल 5 किलो ₹150 किलो [डेटॉल] साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 … |
| A61 | 76.1 s **(over 40 s)** | E-flash-1ear | 1 | रिन साबुन: wrong unit set (expected packet) - heard "रिन साबुन सेट" [NO warning] | … साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 [रिन] साबुन सेट 1 ₹105 फेना डिटर्जेंट 3 किलो … |
| A61 | 76.1 s **(over 40 s)** | E-flash | 2 | डेटॉल साबुन: wrong unit set (expected packet) - heard "डेटॉल साबुन" [NO warning] | तुवर दाल 5 किलो ₹150 किलो [डेटॉल] साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 … |
| A61 | 76.1 s **(over 40 s)** | E-flash | 2 | रिन साबुन: wrong unit set (expected packet) - heard "रिन साबुन" [NO warning] | … साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 [रिन] साबुन सेट 1 ₹105 फेना डिटर्जेंट 3 किलो … |
| A61 | 76.1 s **(over 40 s)** | E-flash-1ear | 2 | डेटॉल साबुन: wrong unit set (expected packet) - heard "डेटॉल साबुन" [NO warning] | तुवर दाल 5 किलो ₹150 किलो [डेटॉल] साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 … |
| A61 | 76.1 s **(over 40 s)** | E-flash-1ear | 2 | रिन साबुन: wrong unit set (expected packet) - heard "रिन साबुन" [NO warning] | … साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 [रिन] साबुन सेट 1 ₹105 फेना डिटर्जेंट 3 किलो … |
| A61 | 76.1 s **(over 40 s)** | E-flash | 3 | डेटॉल साबुन: wrong unit set (expected packet) - heard "डेटॉल साबुन सेट" [NO warning] | तुवर दाल 5 किलो ₹150 किलो [डेटॉल] साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 … |
| A61 | 76.1 s **(over 40 s)** | E-flash | 3 | रिन साबुन: wrong unit set (expected packet) - heard "रिन साबुन सेट" [NO warning] | … साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 [रिन] साबुन सेट 1 ₹105 फेना डिटर्जेंट 3 किलो … |
| A61 | 76.1 s **(over 40 s)** | E-flash-1ear | 3 | डेटॉल साबुन: wrong unit set (expected packet) - heard "डेटॉल साबुन सेट" [NO warning] | तुवर दाल 5 किलो ₹150 किलो [डेटॉल] साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 … |
| A61 | 76.1 s **(over 40 s)** | E-flash-1ear | 3 | रिन साबुन: wrong unit set (expected packet) - heard "रिन साबुन सेट" [NO warning] | … साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 [रिन] साबुन सेट 1 ₹105 फेना डिटर्जेंट 3 किलो … |

## Errors and timeouts (the order showed nothing, never a wrong line)
_None._
