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
- **But E-flash shows about 3 Theek hai per long order** (112 over 36 runs) - from the app's own checks, not the B cross-check: that is why its exact rate is lower. Which check raises them is not saved; it must be found before E-flash could be chosen.
- **Two ears vs one ear for E-flash: no difference at all** (the same wrong lines; B's transcript always had E-flash's numbers). The second ear costs a second call and adds nothing on these 60 recordings.
- **Sarvam is the cheapest and has the fewest wrong lines on short orders**; its batch wait is short (upload 1.5 s, queue + processing 3.7 s, download 0.8 s on average; worst queue 4.0 s) - it could work at the counter. Its losses: A59's corrections (9) and 4 catalog prices from the wrong product (it feeds today's pipeline, which is not D102 yet).
- **Every ear hears the same thing in three places** - A17 "₹185" (the bill says Rs 125), A27 "हार्पिक एक", A32 "मूंग दाल" (the owner says he did not say it). Worth one more listen.
- **Thinking:** gemini-3.8-flash returned no thinking-token field at level `low` on any of the 84 calls.

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
