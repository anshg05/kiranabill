# KB-370 — Voice bake-off (V1, report only)

**Run:** 2026-11-04 · **Results file:** `eval/bakeoff/results-2026-10-31.json` · Nothing in the app changed; no deploy.
**Rule for any winner:** 0 wrong numbers on a final line (`docs/24-ROADMAP.md` Phase V, D100). "Wrong" = a confident number or product that is not what was said; "silent" = no Theek hai warned about it.

## Summary
<!-- summary -->
**Plain words (written after the re-run of 4 Nov 2026; A, B, C, D measured with the final scoring, saved lines; A+vocab, A-30s and C2 are run 1 numbers, old scoring - reference only).**

- **No candidate reaches the release rule of 0 wrong lines.** Not today's ear (A), not any new one.
- **B (gemini-3.5-transcribe as the ear, then the app's own Layer 1 + Layer 2 + checks) is clearly the best ear.** Exact bills: short orders 73% (A 56%), long orders 58% (A 11%). On long orders it got only 3 of the 12 recordings wrong (A54, A57, A59) against A's 8, and it never cut an order short (0 dropped lines; A dropped 32).
- **B's long-order wrong lines are not mis-hearing.** A59 (9 lines): the spoken corrections ("नहीं नहीं 3 किलो") became extra lines - the app does not do spoken corrections (KB-367, dropped 30 Oct). A57 (7): "1 किलो पैकेट" billed as kg where the sheet says packet (4 lines, the same money) and वुश डिटर्जेंट billed as the generic Washing Powder (3). A54 (1): "फटका" became an extra line, warned.
- **Today's Whisper (A) fails long orders on hearing:** it writes compound Hindi prices as words Layer 1 cannot read (देढसो, छैनो, बेनो) or garbles them (A51: तुअर दाल at Rs 90 for Rs 150).
- **C (audio straight to Gemini) is not better than B and costs 3-4x as much**; it also chose wrong catalog products for brand words (Lifebuoy for रिन साबुन, Godrej No.1 for फेना साबुन, Nirma for फेना डिटर्जेंट, Chhena for रवा). **D (C's items, checked against B's hearing) adds nothing over C** and costs the most.
- **Cost at 100 bills a day:** B about Rs 490 a month on short orders, about Rs 1,100 on long ones - the same as or just above today's A (Rs 440 / Rs 860). C Rs 1,650-1,980; D Rs 1,900-2,800.
- **The limit that decides B in production:** gemini-3.5-transcribe allows **100 requests a DAY per project on Tier 1**, shared with production. As the production ear B would cap the whole app at about 100 voice orders a day until the project reaches Tier 2 ($100 paid + 3 days, automatic) and its daily figure is read in AI Studio.
- **Before any choice (V2, the owner's):** the gate's product hole (23, KB-373); the spoken correction (A59); the "किलो पैकेट" unit rule; and the 100-a-day limit.

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

Models (exact names): groq `whisper-large-v3`, transcribe `gemini-3.5-transcribe`, layer2 `gemini-3.5-flash-lite`, c `gemini-3.5-flash-lite`, c2 `gemini-3.8-flash`. Vocabulary (A+vocab, B): 40 terms from `eval/real-transcripts.json` - Chini, चीनी, Parle-G 10, पारले जी, Chawal, चावल, Sabun, फेना, Chakki Aata, पिसा आटा, Besan, बेसन, Jeera, साबुत जीरा, बरबटी दाल, बरबटी दाल, Surf Excel, सर्फ, Toor Daal, दाल, Moong Daal, मूंग दाल, Kala Chana, काला चना, गेहूं, गेहूं, Moong Mogar, धुली मूंग दाल, Chai Patti, चाय, Maggi, मैगी, Tel (1L), तेल, Masoor Daal, मसूर दाल, Futana, फ़ुटाना, हरा बटाना, हरा बटाना.
Prices: Gemini: ai.google.dev/gemini-api/docs/pricing (last updated 2026-10-30); Groq: console.groq.com/docs/speech-to-text (read 31 Oct 2026). Rupees at **Rs 95.17 per $** (the last RBI reference rate found when the run was set up; re-run `npm run bakeoff -- --inr-per-usd <today's>` to change it).
Seconds = the providers' own call times added up on the PC (end of recording -> items), not the phone's upload; D runs B and C side by side (the slower of the two).

## Short orders (A01-A50, once each)
| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated silent / warned | Invented | Numbers right, name wrong | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** | 48 x 1 | 27/48 (56%) | **18** (8) | 9 | 9 | 4 | 0 / 0 | 1 | 4 | 27 | 0 | 2.5 / 4.5 / 5.2 | Rs 0.15 | Rs 439 |
| **A+vocab (run 1, old scoring - reference only)** | 48 x 1 | 24/48 (50%) | **27** (21) | 16 | 11 | 16 | 2 / 0 | 9 | 3 | 28 | 0 | 2.5 / 4.7 / 6.6 | Rs 0.15 | Rs 464 |
| **B** | 48 x 1 | 35/48 (73%) | **10** (8) | 7 | 3 | 0 | 1 / 0 | 2 | 3 | 17 | 0 | 2.8 / 4.3 / 5.7 | Rs 0.16 | Rs 492 |
| **C** | 48 x 1 | 27/48 (56%) | **21** (11) | 10 | 11 | 0 | 1 / 0 | 2 | 3 | 27 | 0 | 3.1 / 4.2 / 4.8 | Rs 0.55 | Rs 1644 |
| **C2 (run 1, old scoring - reference only)** | 48 x 1 | 25/48 (52%) | **18** (15) | 4 | 14 | 34 | 1 / 0 | 2 | 0 | 7 | 6 | 13.1 / 27.6 / 42.8 | Rs 1 | Rs 3364 |
| **D** | 48 x 1 | 27/48 (56%) | **21** (14) | 9 | 12 | 0 | 1 / 0 | 2 | 3 | 30 | 0 | 3.1 / 4.2 / 4.8 | Rs 0.65 | Rs 1935 |

### The 7 orders Whisper mis-heard on 30 Oct (set aside from the gate): A19, A27, A32, A33, A34, A35, A39
| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated silent / warned | Invented | Numbers right, name wrong | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** | 7 x 1 | 0/7 (0%) | **13** (5) | 6 | 7 | 4 | 0 / 0 | 0 | 0 | 17 | 0 | 4.6 / 5.2 / 5.2 | Rs 0.25 | Rs 736 |
| **A+vocab (run 1, old scoring - reference only)** | 7 x 1 | 0/7 (0%) | **7** (4) | 3 | 4 | 9 | 1 / 0 | 3 | 1 | 13 | 0 | 4.4 / 5.6 / 5.6 | Rs 0.24 | Rs 729 |
| **B** | 7 x 1 | 1/7 (14%) | **7** (5) | 5 | 2 | 0 | 1 / 0 | 2 | 1 | 11 | 0 | 4.0 / 5.7 / 5.7 | Rs 0.27 | Rs 815 |
| **C** | 7 x 1 | 0/7 (0%) | **13** (9) | 8 | 5 | 0 | 1 / 0 | 2 | 0 | 10 | 0 | 3.9 / 4.4 / 4.4 | Rs 0.60 | Rs 1792 |
| **C2 (run 1, old scoring - reference only)** | 7 x 1 | 1/7 (14%) | **7** (7) | 3 | 4 | 17 | 1 / 0 | 2 | 0 | 0 | 2 | 24.7 / 42.8 / 42.8 | Rs 0.96 | Rs 2868 |
| **D** | 7 x 1 | 0/7 (0%) | **13** (9) | 8 | 5 | 0 | 1 / 0 | 2 | 0 | 11 | 0 | 3.9 / 4.4 / 4.4 | Rs 0.75 | Rs 2248 |

## Long orders (A51-A62, 3 runs each)
| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated silent / warned | Invented | Numbers right, name wrong | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** | 12 x 3 | 4/36 (11%) | **31** (12) | 31 | 0 | 32 | 1 / 4 | 13 | 5 | 113 | 0 | 5.1 / 7.6 / 11.8 | Rs 0.29 | Rs 859 |
| **A+vocab (run 1, old scoring - reference only)** | 12 x 3 | 9/36 (25%) | **56** (24) | 48 | 8 | 27 | 2 / 0 | 18 | 6 | 122 | 0 | 4.9 / 8.2 / 9.7 | Rs 0.32 | Rs 956 |
| **A-30s (run 1, old scoring - reference only)** | 12 x 3 | 3/36 (8%) | **39** (9) | 31 | 8 | 22 | 1 / 1 | 1 | 0 | 147 | 0 | 5.0 / 8.4 / 10.4 | Rs 0.30 | Rs 912 |
| **B** | 12 x 3 | 21/36 (58%) | **18** (17) | 15 | 3 | 0 | 3 / 0 | 4 | 3 | 41 | 0 | 3.7 / 5.2 / 5.7 | Rs 0.37 | Rs 1098 |
| **C** | 12 x 3 | 9/36 (25%) | **20** (7) | 16 | 4 | 0 | 0 / 4 | 1 | 12 | 90 | 0 | 3.8 / 5.4 / 6.5 | Rs 0.66 | Rs 1978 |
| **C2 (run 1, old scoring - reference only)** | 12 x 3 | 12/36 (33%) | **8** (6) | 2 | 6 | 68 | 0 / 0 | 0 | 0 | 79 | 7 | 20.2 / 35.9 / 43.9 | Rs 1 | Rs 3482 |
| **D** | 12 x 3 | 10/36 (28%) | **18** (15) | 14 | 4 | 0 | 0 / 4 | 1 | 12 | 62 | 0 | 3.8 / 5.4 / 6.5 | Rs 0.93 | Rs 2800 |

### Long orders per recording (over the runs)
| Recording | Length | Candidate | Exact runs | Best (fewest wrong lines) | Worst | Average | Avg seconds |
|---|---|---|---|---|---|---|---|
| A51 | 27.9 s | A+vocab | 3/3 | 0 | 0 | 0.0 | 3.3 |
| A51 | 27.9 s | A-30s | 1/3 | 0 | 0 | 0.0 | 5.3 |
| A51 | 27.9 s | C2 | 2/3 | 0 | 0 | 0.0 | 33.7 |
| A52 | 23.3 s | A+vocab | 2/3 | 0 | 1 | 0.3 | 4.6 |
| A52 | 23.3 s | A-30s | 1/3 | 0 | 2 | 0.7 | 3.8 |
| A52 | 23.3 s | C2 | 1/3 | 0 | 0 | 0.0 | 4.1 |
| A53 | 29.0 s | A+vocab | 1/3 | 0 | 1 | 0.7 | 5.1 |
| A53 | 29.0 s | A-30s | 1/3 | 0 | 1 | 0.3 | 4.2 |
| A53 | 29.0 s | C2 | 0/3 | 0 | 1 | 0.7 | 26.8 |
| A54 | 30.8 s | A+vocab | 0/3 | 5 | 14 | 8.0 | 4.5 |
| A54 | 30.8 s | A-30s | 0/3 | 0 | 3 | 1.0 | 5.6 |
| A54 | 30.8 s | C2 | 3/3 | 0 | 0 | 0.0 | 14.0 |
| A55 | 31.4 s | A+vocab | 0/3 | 0 | 1 | 0.7 | 4.7 |
| A55 | 31.4 s | A-30s | 0/3 | 1 | 1 | 1.0 | 5.4 |
| A55 | 31.4 s | C2 | 0/3 | 0 | 1 | 0.3 | 33.7 |
| A56 | 30.8 s | A+vocab | 3/3 | 0 | 0 | 0.0 | 1.7 |
| A56 | 30.8 s | A-30s | 0/3 | 0 | 4 | 1.7 | 4.0 |
| A56 | 30.8 s | C2 | 2/3 | 0 | 0 | 0.0 | 12.1 |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 0/3 | 0 | 3 | 1.7 | 7.2 |
| A57 | 49.3 s **(over 40 s)** | A-30s | 0/3 | 1 | 1 | 1.0 | 4.5 |
| A57 | 49.3 s **(over 40 s)** | C2 | 0/3 | 0 | 0 | 0.0 | 6.8 |
| A58 | 31.4 s | A+vocab | 0/3 | 0 | 0 | 0.0 | 4.6 |
| A58 | 31.4 s | A-30s | 0/3 | 0 | 4 | 1.3 | 4.4 |
| A58 | 31.4 s | C2 | 0/3 | 0 | 0 | 0.0 | 18.8 |
| A59 | 31.0 s | A+vocab | 0/3 | 1 | 9 | 3.7 | 5.6 |
| A59 | 31.0 s | A-30s | 0/3 | 0 | 3 | 1.3 | 5.0 |
| A59 | 31.0 s | C2 | 0/3 | 0 | 0 | 0.0 | 28.0 |
| A60 | 19.6 s | A+vocab | 0/3 | 0 | 0 | 0.0 | 3.1 |
| A60 | 19.6 s | A-30s | 0/3 | 0 | 0 | 0.0 | 4.1 |
| A60 | 19.6 s | C2 | 2/3 | 0 | 1 | 0.3 | 20.0 |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 0/3 | 0 | 5 | 2.7 | 8.4 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 0/3 | 0 | 8 | 4.3 | 9.6 |
| A61 | 76.1 s **(over 40 s)** | C2 | 0/3 | 0 | 2 | 1.3 | 21.4 |
| A62 | 51.4 s **(over 40 s)** | A+vocab | 0/3 | 0 | 3 | 1.0 | 7.5 |
| A62 | 51.4 s **(over 40 s)** | A-30s | 0/3 | 0 | 1 | 0.3 | 7.6 |
| A62 | 51.4 s **(over 40 s)** | C2 | 2/3 | 0 | 0 | 0.0 | 17.2 |
| A51 | 27.9 s | A | 1/3 | 0 | 1 | 0.7 | 4.8 |
| A51 | 27.9 s | B | 3/3 | 0 | 0 | 0.0 | 2.6 |
| A51 | 27.9 s | C | 2/3 | 0 | 0 | 0.0 | 3.7 |
| A51 | 27.9 s | D | 3/3 | 0 | 0 | 0.0 | 3.7 |
| A52 | 23.3 s | A | 0/3 | 0 | 8 | 2.7 | 4.8 |
| A52 | 23.3 s | B | 3/3 | 0 | 0 | 0.0 | 2.7 |
| A52 | 23.3 s | C | 3/3 | 0 | 0 | 0.0 | 3.6 |
| A52 | 23.3 s | D | 3/3 | 0 | 0 | 0.0 | 3.6 |
| A53 | 29.0 s | A | 1/3 | 0 | 1 | 0.3 | 4.8 |
| A53 | 29.0 s | B | 3/3 | 0 | 0 | 0.0 | 2.8 |
| A53 | 29.0 s | C | 0/3 | 0 | 0 | 0.0 | 4.4 |
| A53 | 29.0 s | D | 0/3 | 0 | 0 | 0.0 | 4.4 |
| A54 | 30.8 s | A | 0/3 | 0 | 1 | 0.7 | 4.8 |
| A54 | 30.8 s | B | 0/3 | 0 | 1 | 0.3 | 4.9 |
| A54 | 30.8 s | C | 0/3 | 0 | 0 | 0.0 | 3.7 |
| A54 | 30.8 s | D | 0/3 | 0 | 0 | 0.0 | 3.7 |
| A55 | 31.4 s | A | 0/3 | 0 | 3 | 1.7 | 5.7 |
| A55 | 31.4 s | B | 0/3 | 0 | 0 | 0.0 | 4.2 |
| A55 | 31.4 s | C | 0/3 | 1 | 2 | 1.7 | 4.6 |
| A55 | 31.4 s | D | 0/3 | 1 | 2 | 1.7 | 4.6 |
| A56 | 30.8 s | A | 1/3 | 0 | 0 | 0.0 | 4.3 |
| A56 | 30.8 s | B | 3/3 | 0 | 0 | 0.0 | 2.5 |
| A56 | 30.8 s | C | 1/3 | 0 | 0 | 0.0 | 3.5 |
| A56 | 30.8 s | D | 1/3 | 0 | 0 | 0.0 | 3.5 |
| A57 | 49.3 s **(over 40 s)** | A | 0/3 | 0 | 2 | 0.7 | 4.8 |
| A57 | 49.3 s **(over 40 s)** | B | 0/3 | 2 | 3 | 2.7 | 4.8 |
| A57 | 49.3 s **(over 40 s)** | C | 0/3 | 2 | 3 | 2.7 | 3.8 |
| A57 | 49.3 s **(over 40 s)** | D | 0/3 | 2 | 4 | 3.0 | 3.8 |
| A58 | 31.4 s | A | 0/3 | 0 | 5 | 1.7 | 4.8 |
| A58 | 31.4 s | B | 3/3 | 0 | 0 | 0.0 | 2.9 |
| A58 | 31.4 s | C | 0/3 | 0 | 0 | 0.0 | 3.9 |
| A58 | 31.4 s | D | 0/3 | 0 | 0 | 0.0 | 3.9 |
| A59 | 31.0 s | A | 0/3 | 0 | 4 | 2.0 | 5.6 |
| A59 | 31.0 s | B | 0/3 | 3 | 3 | 3.0 | 3.9 |
| A59 | 31.0 s | C | 0/3 | 0 | 0 | 0.0 | 3.7 |
| A59 | 31.0 s | D | 0/3 | 0 | 0 | 0.0 | 3.7 |
| A60 | 19.6 s | A | 0/3 | 0 | 0 | 0.0 | 3.3 |
| A60 | 19.6 s | B | 0/3 | 0 | 0 | 0.0 | 4.8 |
| A60 | 19.6 s | C | 0/3 | 1 | 2 | 1.7 | 3.3 |
| A60 | 19.6 s | D | 0/3 | 0 | 1 | 0.7 | 3.3 |
| A61 | 76.1 s **(over 40 s)** | A | 1/3 | 0 | 0 | 0.0 | 10.6 |
| A61 | 76.1 s **(over 40 s)** | B | 3/3 | 0 | 0 | 0.0 | 4.9 |
| A61 | 76.1 s **(over 40 s)** | C | 0/3 | 0 | 2 | 0.7 | 6.3 |
| A61 | 76.1 s **(over 40 s)** | D | 0/3 | 0 | 2 | 0.7 | 6.3 |
| A62 | 51.4 s **(over 40 s)** | A | 0/3 | 0 | 0 | 0.0 | 6.6 |
| A62 | 51.4 s **(over 40 s)** | B | 3/3 | 0 | 0 | 0.0 | 3.3 |
| A62 | 51.4 s **(over 40 s)** | C | 3/3 | 0 | 0 | 0.0 | 4.9 |
| A62 | 51.4 s **(over 40 s)** | D | 3/3 | 0 | 0 | 0.0 | 4.9 |

## Every wrong line
| Recording | Length | Candidate | Run | What was wrong | What it heard |
|---|---|---|---|---|---|
| A02 | 7.2 s | C2 | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | एक किलो तूर दाल 150 रुपए किलो एक किलो फल्ली दाने 140 रुपए किलो |
| A03 | 6.8 s | C2 | 1 | जवारी: wrong product - heard "जवारी" (Jowar Sabut) [NO warning] | एक किलो जवारी चौंतीस रुपए किलो एक किलो दालिया एक सौ बीस रुपए किलो |
| A09 | 4.0 s | A+vocab | 1 | जवारी: wrong product - heard "जवारी" (Jowar Atta) [NO warning] | एक किलो बाजरा, एक किलो जवारी |
| A09 | 4.0 s | C2 | 1 | जवारी: wrong product - heard "जवारी" (Jowar Sabut) [NO warning] | एक किलो बाजरा एक किलो जवारी |
| A10 | 3.8 s | C2 | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [a Theek hai warned] | एक किलो फल्ली दाने एक किलो दालिया |
| A14 | 16.3 s | A+vocab | 1 | बटाना: wrong product - heard "बटाना दाल" (बटाना दाल) [NO warning] | 10 kg गेहूं 340 रुपए, 5 kg गेहूं 36 रुपए कीलो, 5 kg चावल 90 रुपए कीलो, 8 kg बटाना दाल 60 रुपए कीलो, 1 kg हरा बटाना 56 रुपए कीलो |
| A14 | 16.3 s | C2 | 1 | बटाना: wrong product - heard "बटाना दाल" (बटाना दाल) [NO warning] | 10 किलो गेहूं 340 रुपए 5 किलो गेहूं 36 रुपए किलो 5 किलो चावल 90 रुपए किलो 8 किलो बटाना दाल 60 रुपए किलो 1 किलो हरा बटाना 56 रुपए किलो |
| A15 | 15.1 s | C2 | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [a Theek hai warned] | दो किलो चीनी दो किलो गुड़ एक किलो फल्ली दाने एक किलो चना एक किलो मैदा |
| A17 | 14.9 s | A+vocab | 1 | an extra line: dettol set [NO warning] | 1 Dettol Set, 125 रुप, 1 Santur Set, 40 रुप, 1 Santur Hand Wash Set, 105 रुप, 1 Harapek, 100 रुप, 1 Lysol, 110 रुप |
| A17 | 14.9 s | A+vocab | 1 | an extra line: 125 रुप [NO warning] | 1 Dettol Set, 125 रुप, 1 Santur Set, 40 रुप, 1 Santur Hand Wash Set, 105 रुप, 1 Harapek, 100 रुप, 1 Lysol, 110 रुप |
| A17 | 14.9 s | A+vocab | 1 | an extra line: 1 Santur Hand Wash Set [NO warning] | 1 Dettol Set, 125 रुप, 1 Santur Set, 40 रुप, 1 Santur Hand Wash Set, 105 रुप, 1 Harapek, 100 रुप, 1 Lysol, 110 रुप |
| A17 | 14.9 s | A+vocab | 1 | an extra line: 1 Lysol [NO warning] | 1 Dettol Set, 125 रुप, 1 Santur Set, 40 रुप, 1 Santur Hand Wash Set, 105 रुप, 1 Harapek, 100 रुप, 1 Lysol, 110 रुप |
| A19 | 16.4 s | A+vocab | 1 | an extra line: moong daal [NO warning] | 2 Kg. Moong Daal, 2 Kg. Chana Daal, 2 Kg. Urad Mogar, 1 Kg. Moong Mogar, 1 Kg. Barabati Daal, 1 Kg. Chana Daal, 1 Kg. LAL MILCHI Packet |
| A19 | 16.4 s | A+vocab | 1 | an extra line: chana daal [NO warning] | 2 Kg. Moong Daal, 2 Kg. Chana Daal, 2 Kg. Urad Mogar, 1 Kg. Moong Mogar, 1 Kg. Barabati Daal, 1 Kg. Chana Daal, 1 Kg. LAL MILCHI Packet |
| A19 | 16.4 s | C2 | 1 | an extra line: मूंग दाल [NO warning] | दो किलो मूंग दाल दो किलो चना दाल दो किलो उड़द मोगर एक किलो मूंग मोगर एक किलो बरबटी दाल एक किलो चना दाल एक किलो लाल मिर्ची पैकेट |
| A19 | 16.4 s | C2 | 1 | an extra line: चना दाल [NO warning] | दो किलो मूंग दाल दो किलो चना दाल दो किलो उड़द मोगर एक किलो मूंग मोगर एक किलो बरबटी दाल एक किलो चना दाल एक किलो लाल मिर्ची पैकेट |
| A20 | 20.8 s | A+vocab | 1 | खड़ी हल्दी: wrong product - heard "खड़ी हलदी" (हल्दी गाठ) [a Theek hai warned] | 1 किलो गरम मसाला पैकेट, 1 किलो धनिया मसाला पैकेट, 1 किलो हलदी पैकेट, 1 किलो खड़ी हलदी, 1 किलो दाने, 1 किलो चावल, 1 किलो मसूर दाल, |
| A25 | 16.1 s | A+vocab | 1 | गेहूं: wrong quantity 34 (expected 10) [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल 150 किलों |
| A25 | 16.1 s | A+vocab | 1 | गेहूं: wrong quantity 36 (expected 30) [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल 150 किलों |
| A25 | 16.1 s | A+vocab | 1 | आटा: wrong quantity 175 (expected 5) [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल 150 किलों |
| A25 | 16.1 s | A+vocab | 1 | तुअर दाल: wrong quantity 150 (expected 5) [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल 150 किलों |
| A25 | 16.1 s | A+vocab | 1 | an extra line: गेहूं [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल 150 किलों |
| A32 | 22.3 s | C2 | 1 | an extra line: मूंग दाल [NO warning] | मोठ 1 किलो 130 रुपए किलो काबुली चना 1 किलो 120 रुपए किलो काबुली चना 1 किलो मीडियम वाला 100 रुपए किलो आटा 1 किलो 40 रुपए किलो मूंग दाल 1 किलो 88 चना 1 किलो 88 |
| A33 | 20.3 s | A+vocab | 1 | an extra line: दाली [a Theek hai warned] | फल्ली दाने 140 रुपए क्यों स कैलो मेरा फल्ली द मिनट पचय रुपए किलो दूर दाल 140 रुपए क्यों स iKhanda दाल 80 रुपए के लिए आल्युक्रील से इन कि दाली 120 रुपए के लिए |
| A33 | 20.3 s | A+vocab | 1 | खंडा तुअर दाल: wrong product - heard "Khanda दाल" (खंडा दाल) [a Theek hai warned] | फल्ली दाने 140 रुपए क्यों स कैलो मेरा फल्ली द मिनट पचय रुपए किलो दूर दाल 140 रुपए क्यों स iKhanda दाल 80 रुपए के लिए आल्युक्रील से इन कि दाली 120 रुपए के लिए |
| A33 | 20.3 s | C2 | 1 | फल्ली दाना: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | फल्ली दाने 140 रुपए किलो फल्ली दाने 150 रुपए किलो तुवर दाल 140 रुपए किलो खंडा तुवर दाल 80 रुपए किलो फुटाने 120 रुपए किलो दालिया 120 रुपए किलो |
| A33 | 20.3 s | C2 | 1 | फल्ली दाना: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | फल्ली दाने 140 रुपए किलो फल्ली दाने 150 रुपए किलो तुवर दाल 140 रुपए किलो खंडा तुवर दाल 80 रुपए किलो फुटाने 120 रुपए किलो दालिया 120 रुपए किलो |
| A33 | 20.3 s | C2 | 1 | खंडा तुअर दाल: wrong product - heard "तुवर दाल" (Toor Daal) [NO warning] | फल्ली दाने 140 रुपए किलो फल्ली दाने 150 रुपए किलो तुवर दाल 140 रुपए किलो खंडा तुवर दाल 80 रुपए किलो फुटाने 120 रुपए किलो दालिया 120 रुपए किलो |
| A34 | 11.4 s | A+vocab | 1 | बंसल तेल: wrong product - heard "तेल" (Tel Pouch) [a Theek hai warned] | 1.25 किलो मूंग दाल, 96 रुपए किलो, तेल 1 पैकेट 140 वाला, तेल 1 लीटर 150 रुपए, बनसल |
| A34 | 11.4 s | C2 | 1 | बंसल तेल: wrong product - heard "तेल" (Tel Packet 1L) [NO warning] | सवा किलो मूंग दाल छानवे रुपए किलो तेल एक पैकेट एक सौ चालीस वाला तेल एक लीटर एक सौ पचास रुपए बंसल |
| A35 | 12.5 s | A+vocab | 1 | फॉर्च्यून तेल: wrong product - heard "तेल पैकेट एक" (Tel Pouch) [NO warning] | तेल पैकेट एक, Fortune, 160 रुपए, Mother Delight, तेल 1 लिटर, 150 रुपए, आधा किलो रवा पैकेट, 23 रुपए |
| A35 | 12.5 s | A+vocab | 1 | मदर डिलाइट तेल: wrong product - heard "तेल 1 लिटर" (Tel (1L)) [NO warning] | तेल पैकेट एक, Fortune, 160 रुपए, Mother Delight, तेल 1 लिटर, 150 रुपए, आधा किलो रवा पैकेट, 23 रुपए |
| A36 | 10.4 s | A+vocab | 1 | बंसल तेल: wrong unit litre (expected liter) [a Theek hai warned] | आधा किलो मैदा पैकेट 22 रुपए, एक बंसल तेल पैकेट 140 रुपए, एक बंसल एक लिटर 150 रुपए |
| A40 | 20.0 s | A+vocab | 1 | गेहूं: wrong price 3200/32000 (expected rate 3400) [a Theek hai warned] | गेहूं 10 किलों, तीन ची डोराहीर्थान 2.8ी 13.6 रुपाए गेहूं 10 किलों 34 रुपए किलोहान Sour Custody Oil Tepal, पंचल प्रणा पंसल पंचल पंचल पंचल तेल 1 रुपए लाइट मर्ग ला |
| A43 | 6.6 s | A+vocab | 1 | रजवाडी गुड: wrong product - heard "रजवाडी गुड 1 Kg" (Gur) [NO warning] | Marble Chai 1 Kg, 300 रुपए, रजवाडी गुड 1 Kg, 80 रुपए |
| A44 | 9.1 s | A+vocab | 1 | एवरेस्ट किचन किंग मसाला: wrong product - heard "एवरेस्ट किचन किंग मसाला 100 ग्राम" (Kitchen King) [NO warning] | एवरेस्ट किचन किंग मसाला 100 ग्राम 100 रुपए, छोले मसाला 50 ग्राम 45 रुपए |
| A44 | 9.1 s | C2 | 1 | एवरेस्ट किचन किंग मसाला: wrong product - heard "एवरेस्ट किचन किंग मसाला" (Kitchen King) [NO warning] | एवरेस्ट किचन किंग मसाला 100 ग्राम 100 रुपए छोले मसाला 50 ग्राम 45 रुपए हो गया |
| A46 | 7.3 s | C2 | 1 | इंडिपेंडेंस सरसों तेल: wrong unit litre (expected liter) [a Theek hai warned] | इंडिपेंडेंस सरसों तेल एक लीटर दो सौ रुपए पॉन्ड्स पाउडर एक बड़ा सौ रुपए |
| A47 | 19.5 s | A+vocab | 1 | लाइज़ॉल: wrong product - heard "लाइजॉल" (Lizol) [NO warning] | फुटाने 110 रुपे किलो, लाइजॉल 110 रुपे, गुड 98 रुपे, चावल 98 रुपे |
| A47 | 19.5 s | C2 | 1 | लाइज़ॉल: wrong product - heard "लाइज़ोल" (Lizol) [NO warning] | फुटाने एक सौ दस रुपये किलो लाइज़ोल एक सौ दस रुपये गुड़ अट्ठानवे रुपये चावल अट्ठानवे रुपये |
| A49 | 8.2 s | A+vocab | 1 | रिफाइंड सोयाबीन ऑयल: wrong total 20000 (expected 17000) [NO warning] | Refined Soya Bean Oil 170 रुपए, Ground Nut Oil 200 रुपए |
| A49 | 8.2 s | A+vocab | 1 | ग्राउंडनट ऑयल: wrong total 17000 (expected 20000) [NO warning] | Refined Soya Bean Oil 170 रुपए, Ground Nut Oil 200 रुपए |
| A50 | 9.5 s | A+vocab | 1 | स्वाद चायपत्ती: wrong product - heard "चाय पत्ती 1 किलो 500 रुपए" (Chai Patti) [NO warning] | स्वाच चाय पत्ती 1 किलो 500 रुपए, सायद, तूद ब्रस 1 35 रुपए, तूद ब्रस 1 60 रुपए |
| A50 | 9.5 s | C2 | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती एक किलो 500 रुपये शायद टूथब्रश एक 35 रुपये टूथब्रश एक 60 रुपये |
| A50 | 9.5 s | C2 | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती एक किलो 500 रुपये शायद टूथब्रश एक 35 रुपये टूथब्रश एक 60 रुपये |
| A52 | 23.3 s | A+vocab | 2 | पतला पोहा: wrong price 6800/6800 (expected rate 6000) [NO warning] | पतला पोहा एक किलो 68 रुपआ किलो, फुटाने एक किलो 120 रुपए किलो, दालिया एक किलो 120 रुपए किलो, चना दाल एक किलो 92 रुपए किलो, हरा बटाना एक किलो 56 रुपए किलो, रवा एक |
| A52 | 23.3 s | A-30s | 3 | फुटाने: wrong price 2000/2000 (expected rate 12000) [NO warning] | पतला पोहा एक किलो साठ रुपई किलो फुटाने एक किलो एकसू बीस रुपई किलो दालिया एक किलो एकसू बीस रुपई किलो चना दाल एक किलो ब्यानु रुपई किलो हरा बताना एक किलो चपण रुपई  |
| A52 | 23.3 s | A-30s | 3 | दालिया: wrong price 2000/2000 (expected rate 12000) [NO warning] | पतला पोहा एक किलो साठ रुपई किलो फुटाने एक किलो एकसू बीस रुपई किलो दालिया एक किलो एकसू बीस रुपई किलो चना दाल एक किलो ब्यानु रुपई किलो हरा बताना एक किलो चपण रुपई  |
| A53 | 29.0 s | A+vocab | 1 | सैगी मूंग: wrong product - heard "मूंग" (Moong) [NO warning] | राजमा एक किलो एक सो तीस रुपई किलो कुल्था एक किलो एक सो बीस रुपई किलो हरा बटाना एक किलो छपन रुपई किलो जाडा पोहा एक किलो पचास रुपई किलो सैगी मूंग एक किलो छेनो रुप |
| A53 | 29.0 s | C2 | 1 | सैगी मूंग: wrong product - heard "सगी मूंग" (Moong) [NO warning] | राजमा एक किलो एक सौ तीस रुपए किलो कुलथा एक किलो एक सौ बीस रुपए किलो हरा बटाना एक किलो छप्पन रुपए किलो जाड़ा पोहा एक किलो पचास रुपए किलो सगी मूंग एक किलो छानवे र |
| A53 | 29.0 s | A+vocab | 3 | सैगी मूंग: wrong product - heard "सैगी मूंग" (Moong) [NO warning] | Rajma, एक किलो, एकसोतीस रुपई किलो, Kulthaa, एक किलो, एकसोतीस रुपई किलो हरा बटाना, एक किलो, चफ़पन रुपई किलो, जाड़ा पोहा, एक किलो, पचास रुपई किलो सैगी मूंग 1 किलो |
| A53 | 29.0 s | A-30s | 3 | सैगी मूंग: wrong product - heard "सैगी मूँग 1 किलो" (Moong) [a Theek hai warned] | राजमा 1 किलो एकसो 30 रुपाय किलो कुलथा 1 किलो एकसो 20 रुपाय किलो हरा बटाना 1 किलो एकसो 56 रुपाय किलो जड़ा पुहा 1 किलो पचास रुपाय किलो सैगी मूँग 1 किलो एकसो 96 रु |
| A53 | 29.0 s | C2 | 3 | सैगी मूंग: wrong product - heard "सगी मूंग" (Moong) [NO warning] | राजमा एक किलो 130 रुपए किलो कुलथा एक किलो 120 रुपए किलो हरा बटाना एक किलो 56 रुपए किलो जाड़ा पोहा एक किलो 50 रुपए किलो सगी मूंग एक किलो 96 रुपए किलो काबुली चना  |
| A54 | 30.8 s | A+vocab | 1 | तुअर दाल: wrong price 9000/9000 (expected rate 15000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | मूंग दाल: wrong price 11000/11000 (expected rate 9600) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | चावल: wrong total 25000 (expected 60000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | बासमती चावल: wrong total 45000 (expected 80000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | आटा: wrong total 19000 (expected 17500) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | चना दाल: wrong price 8000/8000 (expected rate 9200) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | आटा: wrong price 3800/3800 (expected rate 4000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 150 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 96 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 600 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 800 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 175 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 92 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 40 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A-30s | 1 | चावल: wrong total 300000 (expected 60000) [a Theek hai warned] | तुवर डाल एक किलो फटका 150 किलो मूंग डाल एक किलो 96 किलो चावल पाँच किलो 600 किलो बासमति चावल पाँच किलो 800 किलो आटा 5 किलो 175 किलो चना डाल एक किलो 92 किलो आटा ए |
| A54 | 30.8 s | A-30s | 1 | बासमती चावल: wrong total 400000 (expected 80000) [a Theek hai warned] | तुवर डाल एक किलो फटका 150 किलो मूंग डाल एक किलो 96 किलो चावल पाँच किलो 600 किलो बासमति चावल पाँच किलो 800 किलो आटा 5 किलो 175 किलो चना डाल एक किलो 92 किलो आटा ए |
| A54 | 30.8 s | A-30s | 1 | आटा: wrong total 87500 (expected 17500) [a Theek hai warned] | तुवर डाल एक किलो फटका 150 किलो मूंग डाल एक किलो 96 किलो चावल पाँच किलो 600 किलो बासमति चावल पाँच किलो 800 किलो आटा 5 किलो 175 किलो चना डाल एक किलो 92 किलो आटा ए |
| A54 | 30.8 s | A+vocab | 2 | तुअर दाल: wrong price 9000/9000 (expected rate 15000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 2 | चावल: wrong total 300000 (expected 60000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 2 | बासमती चावल: wrong total 400000 (expected 80000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 2 | आटा: wrong total 87500 (expected 17500) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 2 | an extra line: फटका [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 3 | तुअर दाल: wrong price 9000/9000 (expected rate 15000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 3 | चावल: wrong total 300000 (expected 60000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 3 | बासमती चावल: wrong total 400000 (expected 80000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 3 | आटा: wrong total 87500 (expected 17500) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A54 | 30.8 s | A+vocab | 3 | an extra line: फटका [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 Kg, 600 Rs. Kg, बासमती चावल 5 Kg, 800 Rs. Kg, आटा 5 Kg, 175 Rs. Kg, चना दाल 1 Kg, 92 Rs. Kg, आट |
| A55 | 31.4 s | A+vocab | 1 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | चना दाल 1 किलो, तूर दाल 1 किलो, बंसल तेल 1 लिटर 1 पैकेट, फॉर्चुन तेल 1 लिटर, Mung Daal 1, Kilo, Urad Mogar 1, Kilo, Mung Mogar 1, Kilo, हरा बटाना 1, Kilo, मोठ 1 |
| A55 | 31.4 s | A-30s | 1 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | कि चना दाल 1 किलो तूअर दाल 1 किलो बंसल तेल एक लिटर एक पैकेट फॉर्चून तेल एक लिटर कि मुत एक किलो उड़द मूघर एक किलो मूघर एक किलो नो जब बटाना एक किलो एक मोठ एक किलो |
| A55 | 31.4 s | A-30s | 2 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | कमागमामा चननामो में चना दाल 1 किलो तुउऽ दाल 1 किलो भन्सल तेल 1 लीटर एक पैकेट फॉर्चून तेल 1 लीटर मूँग मूँगर एक किलो हरा बटाना एक किलो मोठ एक किलो एक किलो फुटाने  |
| A55 | 31.4 s | C2 | 2 | फॉर्च्यून तेल: wrong unit litre (expected liter) [a Theek hai warned] | चना दाल 1 किलो तुवर दाल 1 किलो बंसल तेल 1 लीटर 1 पैकेट फॉर्च्यून तेल 1 लीटर मूंग दाल 1 किलो उड़द मोगर 1 किलो मूंग मोगर 1 किलो हरा बटाना 1 किलो मोठ 1 किलो 1 किलो |
| A55 | 31.4 s | A+vocab | 3 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | चना दाल 1 किलो, तूर दाल 1 किलो, बंसल तेल 1 लिटर 1 पैकेट, फॉर्चुन तेल 1 लिटर, Mung Daal 1 Kg, उडद मूंगर 1 Kg, मूंग मूंगर 1 Kg, हरा बटाना 1 Kg, मोठ 1 Kg, 1 Kg फ़ु |
| A55 | 31.4 s | A-30s | 3 | हरा बटाना: wrong quantity 2 (expected 1) [a Theek hai warned] | एक किलो हरा बटाना एक किलो कि एक मोठ एक किलो कि एक किलो फुटाने एक किलो दालिया अ |
| A56 | 30.8 s | A-30s | 1 | हरा बटाना: wrong quantity 1.25 (expected 1.5) [a Theek hai warned] | 1.25 किलो मूँगडाल 1.25 किलो हरा बटाना 2 किलो चनादाल 1.25 किलो रवा 1.25 किलो मैदा 1.25 किलो शक्कर 1.25 किलो बरबटीदाल 1.25 किलो राजमा कर दो |
| A56 | 30.8 s | A-30s | 1 | रवा: wrong quantity 1.25 (expected 1.5) [a Theek hai warned] | 1.25 किलो मूँगडाल 1.25 किलो हरा बटाना 2 किलो चनादाल 1.25 किलो रवा 1.25 किलो मैदा 1.25 किलो शक्कर 1.25 किलो बरबटीदाल 1.25 किलो राजमा कर दो |
| A56 | 30.8 s | A-30s | 1 | बरबटी दाल: wrong quantity 1.25 (expected 1.75) [a Theek hai warned] | 1.25 किलो मूँगडाल 1.25 किलो हरा बटाना 2 किलो चनादाल 1.25 किलो रवा 1.25 किलो मैदा 1.25 किलो शक्कर 1.25 किलो बरबटीदाल 1.25 किलो राजमा कर दो |
| A56 | 30.8 s | A-30s | 1 | राजमा: wrong quantity 1.25 (expected 1.5) [a Theek hai warned] | 1.25 किलो मूँगडाल 1.25 किलो हरा बटाना 2 किलो चनादाल 1.25 किलो रवा 1.25 किलो मैदा 1.25 किलो शक्कर 1.25 किलो बरबटीदाल 1.25 किलो राजमा कर दो |
| A56 | 30.8 s | A-30s | 3 | मूंग दाल: wrong quantity 2.5 (expected 1.25) [NO warning] | 2.5 किलो मूंग दाल, 1.5 किलो हरा बटाना, 2 किलो चना दाल, 1.5 किलो रवा, सवा किलो मैदा सवा किलो शक्कर पौने दो किलो बरवटी दाल देड किलो राजमा |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 1 | पार्ले जी बिस्किट: wrong product - heard "पालेजी बिस्किट" (Parle-G 10) [NO warning] | रिन साबुन 10 वाली 5 पीस, पालेजी बिस्किट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए फेना साबुन 10 वाली 5 पीस, फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटर्जे |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 1 | बंसल तेल पाउच: wrong product - heard "बंसल तेल पाउच" (Tel Pouch) [NO warning] | रिन साबुन 10 वाली 5 पीस, पालेजी बिस्किट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए फेना साबुन 10 वाली 5 पीस, फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटर्जे |
| A57 | 49.3 s **(over 40 s)** | A-30s | 1 | बंसल तेल पाउच: wrong product - heard "बंसल तेल पाउच" (Tel Pouch) [NO warning] | रिन साबुन 10 वाली 5 पीस, पालेजी बिसकिट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन 10 वाली 5 पीस फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटरजेंट |
| A57 | 49.3 s **(over 40 s)** | A-30s | 2 | बंसल तेल पाउच: wrong product - heard "बंसल तेल पाउच" (Tel Pouch) [NO warning] | रिन साबुन 10 वाली 5 पीस, पालेजी बिसकिट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन 10 वाली 5 पीस फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटरजेंट |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 3 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली 5 पीस, पारलेजी बिस्किट 30 वाला 5 पैकेट, बनसल तेल पाउच 1 पैकेट 140 रुपए फेना साबुन 10 वाली 5 पीस, फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटर्ज |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 3 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली 5 पीस, पारलेजी बिस्किट 30 वाला 5 पैकेट, बनसल तेल पाउच 1 पैकेट 140 रुपए फेना साबुन 10 वाली 5 पीस, फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटर्ज |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 3 | बंसल तेल पाउच: wrong product - heard "बनसल तेल पाउच" (Tel Pouch) [NO warning] | रिन साबुन 10 वाली 5 पीस, पारलेजी बिस्किट 30 वाला 5 पैकेट, बनसल तेल पाउच 1 पैकेट 140 रुपए फेना साबुन 10 वाली 5 पीस, फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटर्ज |
| A57 | 49.3 s **(over 40 s)** | A-30s | 3 | बंसल तेल पाउच: wrong product - heard "बंसल तेल पाउच 1 पैकेट 140 रुपए" (Tel Pouch) [NO warning] | रिन साबुन 10 वाली 5 पीस, पालेजी बिसकिट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन 10 वाली 5 पीस फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटरजेंट |
| A58 | 31.4 s | A-30s | 2 | मूंग दाल: wrong quantity 1.96 (expected 1) [a Theek hai warned] | मोंग दाल 1.96 किलो, चना दाल 1.92 किलो, बर्बटी दाल 88 किलो मॉंग मोगर 110 किलो, उड़द मोगर 130 किलो, फोटाने 120 किलो, डाल्डा 160 किलो कर दो |
| A58 | 31.4 s | A-30s | 2 | चना दाल: wrong quantity 1.92 (expected 1) [a Theek hai warned] | मोंग दाल 1.96 किलो, चना दाल 1.92 किलो, बर्बटी दाल 88 किलो मॉंग मोगर 110 किलो, उड़द मोगर 130 किलो, फोटाने 120 किलो, डाल्डा 160 किलो कर दो |
| A58 | 31.4 s | A-30s | 2 | बरबटी दाल: wrong quantity 88 (expected 1) [a Theek hai warned] | मोंग दाल 1.96 किलो, चना दाल 1.92 किलो, बर्बटी दाल 88 किलो मॉंग मोगर 110 किलो, उड़द मोगर 130 किलो, फोटाने 120 किलो, डाल्डा 160 किलो कर दो |
| A58 | 31.4 s | A-30s | 2 | उड़द मोगर: wrong quantity 130 (expected 1) [a Theek hai warned] | मोंग दाल 1.96 किलो, चना दाल 1.92 किलो, बर्बटी दाल 88 किलो मॉंग मोगर 110 किलो, उड़द मोगर 130 किलो, फोटाने 120 किलो, डाल्डा 160 किलो कर दो |
| A59 | 31.0 s | A+vocab | 1 | चना दाल: wrong price 2200/6600 (expected rate 9200) [a Theek hai warned] | एक कीलो आटा, चालिस रुपए कीलो, पाँच कीलो आटा, एक सोपचत्टर रुपए, दो कीलो चीनी, छपन रुपए कीलो नहीं नहीं, तीन कीलो चीनी, छपन रुपए कीलो पाँच कीलो गेहूं, चोतिस रुपए क |
| A59 | 31.0 s | A-30s | 1 | गेहूँ: wrong quantity 15 (expected 5) [a Theek hai warned] | 1 किलो आटा 40 रुपए किलू 5 किलो आटा 175 रुपए 2 किलो चीनी 56 रुपए किलो नहीं नहीं 3 किलो चीनी 56 रुपए किलो 15 किलो गेहू 34 रुपए किलो कि शार किलो चंदाल बन रुपए किलो |
| A59 | 31.0 s | A+vocab | 2 | चीनी: wrong quantity 2 (expected 3) [a Theek hai warned] | एक किलो आटा, चालिस रुपई किलो, पाँच किलो आटा, एक सो पाचपतर रुपई, दो किलो चीनी, चपन रुपई किलो, नहीं नहीं प्रेमाण |
| A59 | 31.0 s | A+vocab | 3 | आटा: wrong price 3800/3800 (expected rate 4000) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A+vocab | 3 | आटा: wrong total 20000 (expected 17500) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A+vocab | 3 | चीनी: wrong quantity 2 (expected 3) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A+vocab | 3 | गेहूँ: wrong price 5600/28000 (expected rate 3400) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A+vocab | 3 | चना दाल: wrong price 8000/24000 (expected rate 9200) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A+vocab | 3 | an extra line: नहीं [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A+vocab | 3 | an extra line: चीनी [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A+vocab | 3 | an extra line: चना दाल [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A+vocab | 3 | an extra line: नहीं [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो नहीं, 4 किलो चीनी, 56 रूपए किलो 5 किलो गेहू, 34 रूपए किलो 4 किलो चना दाल, 92 रूपए किलो न |
| A59 | 31.0 s | A-30s | 3 | चना दाल: wrong price 8000/24000 (expected rate 9200) [NO warning] | 1 किलो आटा 40 रुपए किलो 5 किलो आटा 175 रुपए 2 किलो चीनी 56 रुपए किलो नहीं नहीं 3 किलो चीनी 56 रुपति लो MP5 किलो गेहु 34 रुपए किलो अ चारी किलो चनादाल प्यास को 90 |
| A59 | 31.0 s | A-30s | 3 | an extra line: चीनी [NO warning] | 1 किलो आटा 40 रुपए किलो 5 किलो आटा 175 रुपए 2 किलो चीनी 56 रुपए किलो नहीं नहीं 3 किलो चीनी 56 रुपति लो MP5 किलो गेहु 34 रुपए किलो अ चारी किलो चनादाल प्यास को 90 |
| A59 | 31.0 s | A-30s | 3 | an extra line: अ चारी चनादाल प्यास को [NO warning] | 1 किलो आटा 40 रुपए किलो 5 किलो आटा 175 रुपए 2 किलो चीनी 56 रुपए किलो नहीं नहीं 3 किलो चीनी 56 रुपति लो MP5 किलो गेहु 34 रुपए किलो अ चारी किलो चनादाल प्यास को 90 |
| A60 | 19.6 s | C2 | 3 | मदर डिलाइट तेल: wrong unit litre (expected liter) [a Theek hai warned] | मदर डिलाइट तेल 1 लीटर ₹150 हार्पिक 1 बड़ा ₹110 हार्पिक 1 छोटा ₹60 फिनाइल बॉटल 1 ₹60 |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 1 | an extra line: FENA साबुन [a Theek hai warned] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 RUPAY, RIN साबुन सेट 1, 105 RUPAY, FENA DETERGENT 3 KILO, 285 RUPAY विदीसा, डि |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 1 | an extra line: RIN साबुन [a Theek hai warned] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 RUPAY, RIN साबुन सेट 1, 105 RUPAY, FENA DETERGENT 3 KILO, 285 RUPAY विदीसा, डि |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 1 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [a Theek hai warned] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 RUPAY, RIN साबुन सेट 1, 105 RUPAY, FENA DETERGENT 3 KILO, 285 RUPAY विदीसा, डि |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | विदिशा डिटर्जेंट: wrong total 13000 (expected 7000) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलों, 285 रुपए विदीसा डिटर्जन्ट 1 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | चना दाल: wrong price null/7000 (expected rate 9200) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलों, 285 रुपए विदीसा डिटर्जन्ट 1 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | मूंग दाल: wrong price 9200/18400 (expected rate 9600) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलों, 285 रुपए विदीसा डिटर्जन्ट 1 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | बरबटी दाल: wrong price 9600/28800 (expected rate 8800) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलों, 285 रुपए विदीसा डिटर्जन्ट 1 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | उड़द मोगर: wrong price 8800/8800 (expected rate 13000) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलों, 285 रुपए विदीसा डिटर्जन्ट 1 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | मूंग मोगर: wrong product - heard "मुँँ मुगर" (Moong Daal) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलों, 285 रुपए विदीसा डिटर्जन्ट 1 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | सैगी मूंग: wrong product - heard "सैगी मुँँँग" (Moong Daal) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलों, 285 रुपए विदीसा डिटर्जन्ट 1 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलों, 285 रुपए विदीसा डिटर्जन्ट 1 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | चना दाल: wrong price 13000/13000 (expected rate 9200) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलो, 285 रुपे विधिसा डिटर्जन्ट1 क |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | मूंग दाल: wrong price 9200/18400 (expected rate 9600) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलो, 285 रुपे विधिसा डिटर्जन्ट1 क |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | बरबटी दाल: wrong price 9600/28800 (expected rate 8800) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलो, 285 रुपे विधिसा डिटर्जन्ट1 क |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | उड़द मोगर: wrong price 8800/8800 (expected rate 13000) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलो, 285 रुपे विधिसा डिटर्जन्ट1 क |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 रुपए, रिन साबुन सेट 1 105 रुपए, फेना डिटर्जन्ट 3 किलो, 285 रुपे विधिसा डिटर्जन्ट1 क |
| A61 | 76.1 s **(over 40 s)** | C2 | 2 | सैगी मूंग: wrong product - heard "सैगी मूंग" (Moong) [NO warning] | तुवर दाल 5 किलो ₹150 किलो डेटॉल साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 रिन साबुन सेट 1 ₹105 फेना डिटर्जेंट 3 किलो ₹285 विदीशा डिटर्जेंट 1 किलो ₹70 चना दाल 1 किलो ₹ |
| A61 | 76.1 s **(over 40 s)** | C2 | 2 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [NO warning] | तुवर दाल 5 किलो ₹150 किलो डेटॉल साबुन सेट 1 ₹175 फेना साबुन 12 ₹110 रिन साबुन सेट 1 ₹105 फेना डिटर्जेंट 3 किलो ₹285 विदीशा डिटर्जेंट 1 किलो ₹70 चना दाल 1 किलो ₹ |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | an extra line: DETOL साबुन सेट [NO warning] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 RUPAY, RIN साबुन सेट 1, 105 RUPAY, FENA DETERGENT 3 KILO, 285 RUPAY विदीसा, डि |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | an extra line: FENA साबुन [NO warning] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 RUPAY, RIN साबुन सेट 1, 105 RUPAY, FENA DETERGENT 3 KILO, 285 RUPAY विदीसा, डि |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | an extra line: गुड [a Theek hai warned] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 RUPAY, RIN साबुन सेट 1, 105 RUPAY, FENA DETERGENT 3 KILO, 285 RUPAY विदीसा, डि |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | सैगी मूंग: wrong product - heard "सैगी मूंग" (Moong) [NO warning] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 RUPAY, RIN साबुन सेट 1, 105 RUPAY, FENA DETERGENT 3 KILO, 285 RUPAY विदीसा, डि |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [NO warning] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 RUPAY, RIN साबुन सेट 1, 105 RUPAY, FENA DETERGENT 3 KILO, 285 RUPAY विदीसा, डि |
| A61 | 76.1 s **(over 40 s)** | C2 | 3 | सैगी मूंग: wrong product - heard "सैगी मूंग" (Moong) [NO warning] | तुवर दाल 5 किलो 150 रुपए किलो डेटॉल साबुन सेट 1 175 रुपए फेना साबुन 12 110 रुपए रिन साबुन सेट 1 105 रुपए फेना डिटर्जेंट 3 किलो 285 रुपए विदीसा डिटर्जेंट 1 किलो  |
| A61 | 76.1 s **(over 40 s)** | C2 | 3 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [NO warning] | तुवर दाल 5 किलो 150 रुपए किलो डेटॉल साबुन सेट 1 175 रुपए फेना साबुन 12 110 रुपए रिन साबुन सेट 1 105 रुपए फेना डिटर्जेंट 3 किलो 285 रुपए विदीसा डिटर्जेंट 1 किलो  |
| A62 | 51.4 s **(over 40 s)** | A+vocab | 2 | उड़द मोगर: wrong price null/17000 (expected rate 13000) [NO warning] | Toor Daal 1 Kg, 150 Rs. Kg, Moong Daal 1 Kg, 96 Rs. Kg, बरबटी दाल 2 Kg, 88 Rs. Kg, Moong Mogar 1 Kg, 110 Rs. Kg, Urad Mogar, 1 Kg, 170 Rupees, Chana Dhal, 2 Kg, |
| A62 | 51.4 s **(over 40 s)** | A+vocab | 2 | चना दाल: wrong price null/9200 (expected rate 9200) [NO warning] | Toor Daal 1 Kg, 150 Rs. Kg, Moong Daal 1 Kg, 96 Rs. Kg, बरबटी दाल 2 Kg, 88 Rs. Kg, Moong Mogar 1 Kg, 110 Rs. Kg, Urad Mogar, 1 Kg, 170 Rupees, Chana Dhal, 2 Kg, |
| A62 | 51.4 s **(over 40 s)** | A+vocab | 2 | an extra line: Popat Dhal [NO warning] | Toor Daal 1 Kg, 150 Rs. Kg, Moong Daal 1 Kg, 96 Rs. Kg, बरबटी दाल 2 Kg, 88 Rs. Kg, Moong Mogar 1 Kg, 110 Rs. Kg, Urad Mogar, 1 Kg, 170 Rupees, Chana Dhal, 2 Kg, |
| A62 | 51.4 s **(over 40 s)** | A-30s | 3 | मोठ: wrong price 18000/18000 (expected rate 12000) [a Theek hai warned] | तूवर दाल 1 किलो 150 रुपए किलो मुँग दाल 1 किलो 96 रुपए किलो बरबटी दाल 2 किलो 88 रुपए किलो मुंग मुगर 1 किलो 110 रुपए किलो उडद मुगर 1 किलो 130 रुपए किलो चना दाल 2  |
| A02 | 7.2 s | C | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | एक किलो तूर दाल 150 रुपए किलो एक किलो फल्ली दाने 140 रुपए किलो |
| A02 | 7.2 s | D | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | 1 किलो तुवर दाल 150 रुपए किलो, 1 किलो फल्ली दाने 140 रुपए किलो। |
| A10 | 3.8 s | C | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [a Theek hai warned] | एक किलो फल्ली दाने एक किलो दालिया |
| A10 | 3.8 s | D | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [a Theek hai warned] | 1 किलो फल्ली दाने, 1 किलो दलिया |
| A15 | 15.1 s | A | 1 | फली दाने: wrong product - heard "फली दाने" (Moongfali) [a Theek hai warned] | 2 किलो चीनी, 2 किलो गुड, 1 किलो फली दाने, 1 किलो चना, 1 किलो मैदा |
| A15 | 15.1 s | C | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [a Theek hai warned] | दो किलो चीनी दो किलो गुड़ एक किलो फल्ली दाने एक किलो चना एक किलो मैदा |
| A15 | 15.1 s | D | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [a Theek hai warned] | 2 किलो चीनी, 2 किलो गुड़, 1 किलो फल्ली दाने, 1 किलो चना, 1 किलो मैदा। |
| A17 | 14.9 s | B | 1 | डेटॉल सेट: wrong total 18500 (expected 12500) [NO warning] | एक डेटॉल सेट ₹185 एक संतूर सेट ₹40 एक संतूर हैंडवॉश सेट ₹105 एक हार्पिक ₹100 एक लाइज़ोल ₹110 |
| A19 | 16.4 s | B | 1 | an extra line: मूंग दाल [NO warning] | 2 किलो मूंग दाल, 2 किलो चना दाल, 2 किलो उड़द मोगर, 1 किलो मूंग मोगर, 1 किलो बरबटी दाल, 1 किलो चना दाल, 1 किलो लाल मिर्ची पैकेट। |
| A19 | 16.4 s | B | 1 | an extra line: चना दाल [NO warning] | 2 किलो मूंग दाल, 2 किलो चना दाल, 2 किलो उड़द मोगर, 1 किलो मूंग मोगर, 1 किलो बरबटी दाल, 1 किलो चना दाल, 1 किलो लाल मिर्ची पैकेट। |
| A19 | 16.4 s | C | 1 | लाल मिर्च: wrong unit packet (expected kg) [a Theek hai warned] | दो किलो मूंग दाल दो किलो चना दाल दो किलो उड़द मुगर एक किलो मूंग मुगर एक किलो बरबटी दाल एक किलो चना दाल एक किलो लाल मिर्ची पैकेट |
| A19 | 16.4 s | C | 1 | an extra line: मूंग दाल [NO warning] | दो किलो मूंग दाल दो किलो चना दाल दो किलो उड़द मुगर एक किलो मूंग मुगर एक किलो बरबटी दाल एक किलो चना दाल एक किलो लाल मिर्ची पैकेट |
| A19 | 16.4 s | C | 1 | an extra line: चना दाल [NO warning] | दो किलो मूंग दाल दो किलो चना दाल दो किलो उड़द मुगर एक किलो मूंग मुगर एक किलो बरबटी दाल एक किलो चना दाल एक किलो लाल मिर्ची पैकेट |
| A19 | 16.4 s | D | 1 | लाल मिर्च: wrong unit packet (expected kg) [a Theek hai warned] | 2 किलो मूंग दाल, 2 किलो चना दाल, 2 किलो उड़द मोगर, 1 किलो मूंग मोगर, 1 किलो बरबटी दाल, 1 किलो चना दाल, 1 किलो लाल मिर्ची पैकेट। |
| A19 | 16.4 s | D | 1 | an extra line: मूंग दाल [NO warning] | 2 किलो मूंग दाल, 2 किलो चना दाल, 2 किलो उड़द मोगर, 1 किलो मूंग मोगर, 1 किलो बरबटी दाल, 1 किलो चना दाल, 1 किलो लाल मिर्ची पैकेट। |
| A19 | 16.4 s | D | 1 | an extra line: चना दाल [NO warning] | 2 किलो मूंग दाल, 2 किलो चना दाल, 2 किलो उड़द मोगर, 1 किलो मूंग मोगर, 1 किलो बरबटी दाल, 1 किलो चना दाल, 1 किलो लाल मिर्ची पैकेट। |
| A20 | 20.8 s | A | 1 | गरम मसाला: wrong unit packet (expected kg) [NO warning] | 1 किलो गर्म मसाला पैकेट, 1 किलो धनिया मसाला पैकेट, 1 किलो हल्दी पैकेट, 1 किलो खड़ी हल्दी, 1 किलो दाने, 1 किलो चावल, 1 किलो मसूर दाल, |
| A20 | 20.8 s | A | 1 | धनिया मसाला: wrong unit packet (expected kg) [a Theek hai warned] | 1 किलो गर्म मसाला पैकेट, 1 किलो धनिया मसाला पैकेट, 1 किलो हल्दी पैकेट, 1 किलो खड़ी हल्दी, 1 किलो दाने, 1 किलो चावल, 1 किलो मसूर दाल, |
| A24 | 16.6 s | B | 1 | उड़द मोगर: wrong product - heard "मूंग मोगर" (Moong Mogar) [NO warning] | Toor Daal 2 किलो ₹150 किलो वाली, मूंग दाल 1 किलो ₹96 किलो, 2 किलो बरबटी दाल, 2 किलो मूंग मोगर, 1 किलो फुटाने, 2 किलो दलिया, 2 किलो हरा बटाना ₹56 किलो। |
| A27 | 31.4 s | B | 1 | हार्पिक: a quantity 1 nobody said [NO warning] | डेटॉल साबुन सेट एक ₹185, संतूर साबुन सेट एक ₹140, डेटॉल हैंड वॉश एक ₹100, लाइज़ोल एक ₹110, हार्पिक एक ₹100, रिन साबुन एक सेट ₹100, फेना साबुन पांच ₹50, फेना डिट |
| A27 | 31.4 s | C | 1 | हार्पिक: a quantity 1 nobody said [NO warning] | डेटॉल साबुन सेट एक 185 रुपए, संतुर साबुन सेट एक 140 रुपए, डेटॉल हैंडवॉश एक 100 रुपए, लाइजॉल एक 110 रुपए, हारपिक एक 100 रुपए, रिन साबुन एक सेट 100 रुपए, फेना साब |
| A27 | 31.4 s | D | 1 | हार्पिक: a quantity 1 nobody said [NO warning] | डेटॉल साबुन सेट एक ₹185, संतूर साबुन सेट एक ₹140, डेटॉल हैंड वॉश एक ₹100, लाइज़ोल एक ₹110, हार्पिक एक ₹100, रिन साबुन एक सेट ₹100, फेना साबुन पांच ₹50, फेना डिट |
| A32 | 22.3 s | A | 1 | मोठ: wrong price null/13200 (expected rate 13000) [NO warning] | करने के लिए मोठ एक किल 132 काबुली चनट टीज रुपए थील लो काबुली चनट एक किलेम वाला 100 रूपए कि लो ताकि हम आपसे 340 रुपे कि आप सॉफ्ट किस टिश को या रेटा किसी इंडिया प |
| A32 | 22.3 s | A | 1 | आटा: wrong product - heard "इंडिया गेट बासमती" (India Gate Basmati) [NO warning] | करने के लिए मोठ एक किल 132 काबुली चनट टीज रुपए थील लो काबुली चनट एक किलेम वाला 100 रूपए कि लो ताकि हम आपसे 340 रुपे कि आप सॉफ्ट किस टिश को या रेटा किसी इंडिया प |
| A32 | 22.3 s | A | 1 | चना: wrong product - heard "टिशू पेपर" (Tissue Paper) [NO warning] | करने के लिए मोठ एक किल 132 काबुली चनट टीज रुपए थील लो काबुली चनट एक किलेम वाला 100 रूपए कि लो ताकि हम आपसे 340 रुपे कि आप सॉफ्ट किस टिश को या रेटा किसी इंडिया प |
| A32 | 22.3 s | A | 1 | काबुली चना मीडियम: wrong product - heard "काबुली चना" (Kabuli Chana) [NO warning] | करने के लिए मोठ एक किल 132 काबुली चनट टीज रुपए थील लो काबुली चनट एक किलेम वाला 100 रूपए कि लो ताकि हम आपसे 340 रुपे कि आप सॉफ्ट किस टिश को या रेटा किसी इंडिया प |
| A32 | 22.3 s | B | 1 | an extra line: मूंग दाल [NO warning] | मोठ 1 किलो ₹130 किलो, काबुली चना 1 किलो ₹120 किलो, काबुली चना 1 किलो मीडियम वाला ₹100 किलो, आटा 1 किलो ₹40 किलो, मूंग दाल 1 किलो 88, चना 1 किलो 88 |
| A32 | 22.3 s | B | 1 | काबुली चना मीडियम: wrong product - heard "काबुली चना" (Kabuli Chana) [NO warning] | मोठ 1 किलो ₹130 किलो, काबुली चना 1 किलो ₹120 किलो, काबुली चना 1 किलो मीडियम वाला ₹100 किलो, आटा 1 किलो ₹40 किलो, मूंग दाल 1 किलो 88, चना 1 किलो 88 |
| A32 | 22.3 s | C | 1 | an extra line: मूंग दाल [NO warning] | मोठ एक किलो 130 रुपये किलो काबुली चना एक किलो 120 रुपये किलो काबुली चना एक किलो मीडियम वाला 100 रुपये किलो आटा एक किलो 40 रुपये किलो मूंग दाल एक किलो 88 चना एक  |
| A32 | 22.3 s | C | 1 | काबुली चना मीडियम: wrong product - heard "काबुली चना" (Kabuli Chana) [NO warning] | मोठ एक किलो 130 रुपये किलो काबुली चना एक किलो 120 रुपये किलो काबुली चना एक किलो मीडियम वाला 100 रुपये किलो आटा एक किलो 40 रुपये किलो मूंग दाल एक किलो 88 चना एक  |
| A32 | 22.3 s | D | 1 | an extra line: मूंग दाल [NO warning] | मोठ 1 किलो ₹130 किलो, काबुली चना 1 किलो ₹120 किलो, काबुली चना 1 किलो मीडियम वाला ₹100 किलो, आटा 1 किलो ₹40 किलो, मूंग दाल 1 किलो 88, चना 1 किलो 88 |
| A32 | 22.3 s | D | 1 | काबुली चना मीडियम: wrong product - heard "काबुली चना" (Kabuli Chana) [NO warning] | मोठ 1 किलो ₹130 किलो, काबुली चना 1 किलो ₹120 किलो, काबुली चना 1 किलो मीडियम वाला ₹100 किलो, आटा 1 किलो ₹40 किलो, मूंग दाल 1 किलो 88, चना 1 किलो 88 |
| A33 | 20.3 s | A | 1 | फल्ली दाना: wrong price 12000/12000 (expected rate 15000) [a Theek hai warned] | अजय को कवली दान 140 किलो कि फलीद कान 150 किलो दौड़ 140 रुपई किलो खंड दालू 80 किलो की फुंट आने 120 रुपई किलो डाली 120 रुपई किलो |
| A33 | 20.3 s | A | 1 | तुअर दाल: wrong price 12000/12000 (expected rate 14000) [a Theek hai warned] | अजय को कवली दान 140 किलो कि फलीद कान 150 किलो दौड़ 140 रुपई किलो खंड दालू 80 किलो की फुंट आने 120 रुपई किलो डाली 120 रुपई किलो |
| A33 | 20.3 s | A | 1 | फुटाना: wrong product - heard "कवली दान" (Kabuli Chana) [a Theek hai warned] | अजय को कवली दान 140 किलो कि फलीद कान 150 किलो दौड़ 140 रुपई किलो खंड दालू 80 किलो की फुंट आने 120 रुपई किलो डाली 120 रुपई किलो |
| A33 | 20.3 s | A | 1 | फुटाना: wrong price 14000/14000 (expected rate 12000) [a Theek hai warned] | अजय को कवली दान 140 किलो कि फलीद कान 150 किलो दौड़ 140 रुपई किलो खंड दालू 80 किलो की फुंट आने 120 रुपई किलो डाली 120 रुपई किलो |
| A33 | 20.3 s | A | 1 | दालिया: wrong price 15000/15000 (expected rate 12000) [a Theek hai warned] | अजय को कवली दान 140 किलो कि फलीद कान 150 किलो दौड़ 140 रुपई किलो खंड दालू 80 किलो की फुंट आने 120 रुपई किलो डाली 120 रुपई किलो |
| A33 | 20.3 s | A | 1 | खंडा तुअर दाल: wrong product - heard "खंड दालू" (खंडा दाल) [a Theek hai warned] | अजय को कवली दान 140 किलो कि फलीद कान 150 किलो दौड़ 140 रुपई किलो खंड दालू 80 किलो की फुंट आने 120 रुपई किलो डाली 120 रुपई किलो |
| A33 | 20.3 s | C | 1 | फल्ली दाना: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | फल्ली दाने 140 रुपये किलो फल्ली दाने 150 रुपये किलो तूवर दाल 140 रुपये किलो खंडा तूवर दाल 80 रुपये किलो फुटाने 120 रुपये किलो दालिया 120 रुपये किलो |
| A33 | 20.3 s | C | 1 | फल्ली दाना: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | फल्ली दाने 140 रुपये किलो फल्ली दाने 150 रुपये किलो तूवर दाल 140 रुपये किलो खंडा तूवर दाल 80 रुपये किलो फुटाने 120 रुपये किलो दालिया 120 रुपये किलो |
| A33 | 20.3 s | D | 1 | फल्ली दाना: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | फल्ली दाने ₹140 किलो, फल्ली दाने ₹150 किलो, तुवर दाल ₹140 किलो, खंडा तुवर दाल ₹80 किलो, फुटाने ₹120 किलो, डालिया ₹120 किलो। |
| A33 | 20.3 s | D | 1 | फल्ली दाना: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | फल्ली दाने ₹140 किलो, फल्ली दाने ₹150 किलो, तुवर दाल ₹140 किलो, खंडा तुवर दाल ₹80 किलो, फुटाने ₹120 किलो, डालिया ₹120 किलो। |
| A34 | 11.4 s | A | 1 | मूंग दाल: wrong quantity 0.25 (expected 1.25) [a Theek hai warned] | पावा किलो मूंग दाल छैननो रुपए किलो तेल एक पैकेट एक सो जालिस वाला तेल एक लीटर एक सो पचास रुपए बनसल |
| A34 | 11.4 s | A | 1 | बंसल तेल: wrong product - heard "तेल" (Tel Pouch) [a Theek hai warned] | पावा किलो मूंग दाल छैननो रुपए किलो तेल एक पैकेट एक सो जालिस वाला तेल एक लीटर एक सो पचास रुपए बनसल |
| A34 | 11.4 s | B | 1 | मूंग दाल: wrong quantity 0.5 (expected 1.25) [a Theek hai warned] | 1/2 किलो मूंग दाल ₹96 किलो। तेल एक पैकेट 140 वाला। तेल 1 लीटर ₹150 बंसल। |
| A34 | 11.4 s | B | 1 | बंसल तेल: wrong product - heard "तेल" (Tel Pouch) [a Theek hai warned] | 1/2 किलो मूंग दाल ₹96 किलो। तेल एक पैकेट 140 वाला। तेल 1 लीटर ₹150 बंसल। |
| A34 | 11.4 s | C | 1 | बंसल तेल: wrong unit litre (expected liter) [NO warning] | सवा किलो मूंग दाल छानबे रुपये किलो तेल एक पैकेट 140 वाला तेल एक लीटर 150 रुपये बंसल |
| A34 | 11.4 s | C | 1 | बंसल तेल: wrong product - heard "तेल" (Tel Pouch) [a Theek hai warned] | सवा किलो मूंग दाल छानबे रुपये किलो तेल एक पैकेट 140 वाला तेल एक लीटर 150 रुपये बंसल |
| A34 | 11.4 s | D | 1 | बंसल तेल: wrong unit litre (expected liter) [NO warning] | 1/2 किलो मूंग दाल ₹96 किलो। तेल एक पैकेट 140 वाला। तेल 1 लीटर ₹150 बंसल। |
| A34 | 11.4 s | D | 1 | बंसल तेल: wrong product - heard "तेल" (Tel Pouch) [a Theek hai warned] | 1/2 किलो मूंग दाल ₹96 किलो। तेल एक पैकेट 140 वाला। तेल 1 लीटर ₹150 बंसल। |
| A35 | 12.5 s | A | 1 | फॉर्च्यून तेल: wrong product - heard "तेल पैकेट एक फॉल्चून" (Tel Pouch) [NO warning] | तेल पैकेट एक फॉल्चून 160 रुपए, मदर डिलाइट तेल एक लिटर 150 रुपए, आधा किलो रवा पैकेट 23 रुपए |
| A35 | 12.5 s | C | 1 | फॉर्च्यून तेल: wrong product - heard "तेल पैकेट एक फॉर्च्यून" (Tel Packet 1L) [NO warning] | तेल पैकेट एक फॉर्च्यून 160 रुपए मदर डिलाइट तेल एक लीटर 150 रुपए आधा किलो रवा पैकेट 23 रुपए |
| A35 | 12.5 s | D | 1 | फॉर्च्यून तेल: wrong product - heard "तेल पैकेट एक फॉर्च्यून" (Tel Packet 1L) [NO warning] | तेल पैकेट एक फॉर्च्यून ₹160 मदर डेयरी तेल एक लीटर ₹150 आधा किलो रवा पैकेट ₹23 |
| A36 | 10.4 s | C | 1 | बंसल तेल: wrong unit litre (expected liter) [a Theek hai warned] | आधा किलो मैदा पैकेट बाईस रुपए एक बंसल तेल पैकेट एक सौ चालीस रुपए एक बंसल एक लीटर एक सौ पचास रुपए |
| A36 | 10.4 s | D | 1 | बंसल तेल: wrong unit litre (expected liter) [a Theek hai warned] | आधा किलो मैदा पैकेट 22 रुपए, एक बंसल तेल पैकेट 140 रुपए, एक बंसल एक लीटर 150 रुपए। |
| A39 | 16.3 s | C | 1 | बंसल तेल: wrong unit litre (expected liter) [a Theek hai warned] | दो किलो शक्कर दो किलो शक्कर एक किलो आटा एक किलो आटा रबा एक किलो मैदा एक किलो एक बंसल तेल पैकेट एक लीटर 150 रुपये एक बंसल तेल पैकेट एक लीटर |
| A39 | 16.3 s | C | 1 | बंसल तेल: wrong unit litre (expected liter) [a Theek hai warned] | दो किलो शक्कर दो किलो शक्कर एक किलो आटा एक किलो आटा रबा एक किलो मैदा एक किलो एक बंसल तेल पैकेट एक लीटर 150 रुपये एक बंसल तेल पैकेट एक लीटर |
| A39 | 16.3 s | D | 1 | बंसल तेल: wrong unit litre (expected liter) [a Theek hai warned] | 2 किलो शक्कर 2 किलो शक्कर 1 किलो आटा 1 किलो आटा रवा 1 किलो मैदा 1 किलो 1 बंसल तेल पैकेट 1 लीटर 150 रुपए 1 बंसल तेल पैकेट 1 लीटर |
| A39 | 16.3 s | D | 1 | बंसल तेल: wrong unit litre (expected liter) [a Theek hai warned] | 2 किलो शक्कर 2 किलो शक्कर 1 किलो आटा 1 किलो आटा रवा 1 किलो मैदा 1 किलो 1 बंसल तेल पैकेट 1 लीटर 150 रुपए 1 बंसल तेल पैकेट 1 लीटर |
| A40 | 20.0 s | A | 1 | गेहूं: wrong total 3400 (expected 34000) [NO warning] | मैं कि यह शो 10 किलो 340 रुपए गेहु 10 किलो 34 रुपए किर्लाला अ कि पंशल तेल एक लीटर 150 रुपए मदर डिलाइट तेल एक लीटर 150 रुपए फॉर्चुन तेल एक लीटर 160 रुपए टोटल गुल |
| A44 | 9.1 s | C | 1 | एवरेस्ट किचन किंग मसाला: wrong product - heard "एवरेस्ट किचन किंग मसाला" (Everest Masala) [a Theek hai warned] | एवरेस्ट किचन किंग मसाला १०० ग्राम १०० रुपये छोले मसाला ५० ग्राम ४५ रुपये |
| A44 | 9.1 s | D | 1 | एवरेस्ट किचन किंग मसाला: wrong product - heard "एवरेस्ट किचन किंग मसाला" (Everest Masala) [NO warning] | एवरेस्ट किचन किंग मसाला 100 ग्राम ₹100, छोले मसाला 50 ग्राम ₹45 |
| A45 | 17.7 s | C | 1 | साइकिल अगरबत्ती: wrong product - heard "धूप अगरबत्ती" (Dhoop) [NO warning] | चिन्नौर काली मूछ एक किलो अस्सी रुपये धूप अगरबत्ती साइकिल बीस रुपये वश निर्मा एक किलो सत्तर रुपये |
| A45 | 17.7 s | D | 1 | साइकिल अगरबत्ती: wrong product - heard "धूप अगरबत्ती" (Dhoop) [NO warning] | चिन्नौर काली मूंछ 1 किलो ₹80 धूप अगरबत्ती साइकिल ₹20 वॉश निर्मा 1 किलो ₹70 |
| A47 | 19.5 s | B | 1 | फुटाना: wrong price 10400/10400 (expected rate 11000) [NO warning] | फुटाने ₹104 किलो, लाइज़ोल ₹110, गुड़ ₹98, चावल ₹98। |
| A49 | 8.2 s | A | 1 | रिफाइंड सोयाबीन ऑयल: wrong product - heard "रिफाइंड सोयाबिन ओयल" (Soya Tel) [NO warning] | रिफाइंड सोयाबिन ओयल 170 रुपए ग्राउंड नट ओयल 200 रुपए |
| A49 | 8.2 s | C | 1 | ग्राउंडनट ऑयल: a quantity 1 nobody said [a Theek hai warned] | रिपाइन्ड सोयाबीन आयल एकसौ सत्तर रुपये ग्राउन्डनट आयल एक दोसौ रुपये |
| A49 | 8.2 s | C | 1 | ग्राउंडनट ऑयल: wrong product - heard "ग्राउन्डनट आयल" (Moongfali Tel) [a Theek hai warned] | रिपाइन्ड सोयाबीन आयल एकसौ सत्तर रुपये ग्राउन्डनट आयल एक दोसौ रुपये |
| A49 | 8.2 s | D | 1 | रिफाइंड सोयाबीन ऑयल: wrong product - heard "रिपाइन्ड सोयाबीन आयल" (Soya Tel) [NO warning] | रिफाइंड सोयाबीन ऑयल 170 रुपए, ग्राउंडनट ऑयल 200 रुपए। |
| A49 | 8.2 s | D | 1 | ग्राउंडनट ऑयल: wrong product - heard "ग्राउन्डनट आयल" (Moongfali Tel) [NO warning] | रिफाइंड सोयाबीन ऑयल 170 रुपए, ग्राउंडनट ऑयल 200 रुपए। |
| A51 | 27.9 s | A | 1 | तुअर दाल: wrong price 9000/9000 (expected rate 15000) [a Theek hai warned] | तूवर दाल 1 किलो 10.15 किलो मसूर दाल 1 किलो 80 किलो बरबटी दाल 1 किलो 88 किलो मूंग दाल 1 किलो 96 किलो चना दाल 1 किलो 92 किलो मोठ 1 किलो 120 किलो |
| A51 | 27.9 s | A | 2 | an extra line: तूबा दाल [NO warning] | तूबा दाल 1 किलो, देड़सु रुपए किलो बरबटी दाल 1 किलो, 88 रुपए किलो मूँ दाल 1 किलो, 96 रुपए किलो चना दाल 1 किलो, 92 रुपए किलो मोट 1 किलो, 120 रुपए किलो |
| A52 | 23.3 s | A | 2 | फुटाने: wrong price 9000/9000 (expected rate 12000) [NO warning] | पतला पोहा एक किलो साठ रुपए किलो फुटाने एक किलो एकसू बीस रुपए किलो दालिया एक किलो एकसू बीस रुपए किलो पानी एक किलो एकसू बीस रुपए किलो रवा एक किलो एकसू बीस रुपए कि |
| A52 | 23.3 s | A | 2 | दालिया: wrong price 32000/32000 (expected rate 12000) [NO warning] | पतला पोहा एक किलो साठ रुपए किलो फुटाने एक किलो एकसू बीस रुपए किलो दालिया एक किलो एकसू बीस रुपए किलो पानी एक किलो एकसू बीस रुपए किलो रवा एक किलो एकसू बीस रुपए कि |
| A52 | 23.3 s | A | 2 | रवा: wrong price 4000/4000 (expected rate 4400) [NO warning] | पतला पोहा एक किलो साठ रुपए किलो फुटाने एक किलो एकसू बीस रुपए किलो दालिया एक किलो एकसू बीस रुपए किलो पानी एक किलो एकसू बीस रुपए किलो रवा एक किलो एकसू बीस रुपए कि |
| A52 | 23.3 s | A | 2 | an extra line: एकसू [NO warning] | पतला पोहा एक किलो साठ रुपए किलो फुटाने एक किलो एकसू बीस रुपए किलो दालिया एक किलो एकसू बीस रुपए किलो पानी एक किलो एकसू बीस रुपए किलो रवा एक किलो एकसू बीस रुपए कि |
| A52 | 23.3 s | A | 2 | an extra line: एकसू [a Theek hai warned] | पतला पोहा एक किलो साठ रुपए किलो फुटाने एक किलो एकसू बीस रुपए किलो दालिया एक किलो एकसू बीस रुपए किलो पानी एक किलो एकसू बीस रुपए किलो रवा एक किलो एकसू बीस रुपए कि |
| A52 | 23.3 s | A | 2 | an extra line: एकसू [a Theek hai warned] | पतला पोहा एक किलो साठ रुपए किलो फुटाने एक किलो एकसू बीस रुपए किलो दालिया एक किलो एकसू बीस रुपए किलो पानी एक किलो एकसू बीस रुपए किलो रवा एक किलो एकसू बीस रुपए कि |
| A52 | 23.3 s | A | 2 | an extra line: एकसू [a Theek hai warned] | पतला पोहा एक किलो साठ रुपए किलो फुटाने एक किलो एकसू बीस रुपए किलो दालिया एक किलो एकसू बीस रुपए किलो पानी एक किलो एकसू बीस रुपए किलो रवा एक किलो एकसू बीस रुपए कि |
| A52 | 23.3 s | A | 2 | an extra line: पानी [NO warning] | पतला पोहा एक किलो साठ रुपए किलो फुटाने एक किलो एकसू बीस रुपए किलो दालिया एक किलो एकसू बीस रुपए किलो पानी एक किलो एकसू बीस रुपए किलो रवा एक किलो एकसू बीस रुपए कि |
| A53 | 29.0 s | A | 2 | राजमा: wrong price 3000/3000 (expected rate 13000) [a Theek hai warned] | राजमा एक किलो एकसो तीस रुपई किलो सोथा एक किलो एकसो आया किलो हरा बटाना एक किलो एकसो अक्षर वाय किलो जड़ा पहाई एक किलो पचास प्रशेष वाय किलो सह्गी मुंग एक किलो भी द |
| A54 | 30.8 s | A | 2 | an extra line: तूवल डाल फटका [a Theek hai warned] | तूवल डाल एक किलो फटका देड़ सो रूपए किलो मुह्ंग डाल एक किलो छैनौ रूपए किलो बास्मती चावल पाच किलो आठ सो रूपए आटा पाच किलो एक सो पचत्तर रूपए चना दाल 1 किलो ब्याननो |
| A54 | 30.8 s | A | 3 | an extra line: फटका [a Theek hai warned] | कर दो ही तुअर दाल 1 किलो फटका 150 रुपए किलो मूँग दाल 1 किलो 96.org किलो कि चावल 5 किलो 600 रुपए मैं बात मती चावल 5 लोग आठ सो रुपए कि आठा 5 किलो एक सुन सफत तरफ ह |
| A54 | 30.8 s | B | 3 | an extra line: फटका [a Theek hai warned] | Toor Daal 1 किलो, फटका ₹150 किलो। Moong Daal 1 किलो, ₹96 किलो। चावल 5 किलो, ₹600। बासमती चावल 5 किलो, ₹800। आटा 5 किलो, ₹175। चना दाल 1 किलो, ₹92 किलो। आटा 1 कि |
| A55 | 31.4 s | C | 1 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | चना दाल एक किलो तूर दाल एक किलो बंसल तेल एक लीटर एक पैकेट फॉर्चून तेल एक लीटर मूंग दाल एक किलो उड़द मोगर एक किलो मूंग मोगर एक किलो हरा बटाना एक किलो मोठ एक किलो  |
| A55 | 31.4 s | D | 1 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | चना दाल 1 किलो, तुअर दाल 1 किलो, बंसल तेल 1 लीटर एक पैकेट, फॉर्च्यून तेल 1 लीटर, मूंग दाल 1 किलो, उड़द मोगर 1 किलो, मूंग मोगर 1 किलो, हरा बटाना 1 किलो, मोठ 1 कि |
| A55 | 31.4 s | A | 2 | बंसल तेल: wrong unit liter (expected packet) [NO warning] | कि चना दाल एक किलो दोर दाल एक किलो बंसर तेल एक लीटर एक पैकेट फोर्चून तेल 1 लीटर की मूं का लार्म एक-किलोड़ मोगणी के लड़न मौकर एक किलो घृत बटानाओं अ कि का लो है क |
| A55 | 31.4 s | A | 2 | an extra line: मूं का लार्म [NO warning] | कि चना दाल एक किलो दोर दाल एक किलो बंसर तेल एक लीटर एक पैकेट फोर्चून तेल 1 लीटर की मूं का लार्म एक-किलोड़ मोगणी के लड़न मौकर एक किलो घृत बटानाओं अ कि का लो है क |
| A55 | 31.4 s | A | 2 | an extra line: मौकर [NO warning] | कि चना दाल एक किलो दोर दाल एक किलो बंसर तेल एक लीटर एक पैकेट फोर्चून तेल 1 लीटर की मूं का लार्म एक-किलोड़ मोगणी के लड़न मौकर एक किलो घृत बटानाओं अ कि का लो है क |
| A55 | 31.4 s | C | 2 | बंसल तेल: wrong unit litre (expected packet) [a Theek hai warned] | चना दाल एक किलो, तूअर दाल एक किलो, बंसल तेल एक लीटर एक पैकेट, फॉर्चून तेल एक लीटर, मूंग दाल एक किलो, उड़द मोगर एक किलो, मूंग मोगर एक किलो, हरा बटाना एक किलो, मो |
| A55 | 31.4 s | C | 2 | फॉर्च्यून तेल: wrong unit litre (expected liter) [a Theek hai warned] | चना दाल एक किलो, तूअर दाल एक किलो, बंसल तेल एक लीटर एक पैकेट, फॉर्चून तेल एक लीटर, मूंग दाल एक किलो, उड़द मोगर एक किलो, मूंग मोगर एक किलो, हरा बटाना एक किलो, मो |
| A55 | 31.4 s | D | 2 | बंसल तेल: wrong unit litre (expected packet) [a Theek hai warned] | चना दाल 1 किलो, तुअर दाल 1 किलो, बंसल तेल 1 लीटर एक पैकेट, फॉर्च्यून तेल 1 लीटर, मूंग दाल 1 किलो, उड़द मोगर 1 किलो, मूंग मोगर 1 किलो, हरा बटाना 1 किलो, मोठ 1 कि |
| A55 | 31.4 s | D | 2 | फॉर्च्यून तेल: wrong unit litre (expected liter) [a Theek hai warned] | चना दाल 1 किलो, तुअर दाल 1 किलो, बंसल तेल 1 लीटर एक पैकेट, फॉर्च्यून तेल 1 लीटर, मूंग दाल 1 किलो, उड़द मोगर 1 किलो, मूंग मोगर 1 किलो, हरा बटाना 1 किलो, मोठ 1 कि |
| A55 | 31.4 s | A | 3 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | चनडाल 1 किलो तूर दाल एक किलो बनसल तेल एक लिटर 1 पैकेट फॉर्चुएं तेल एक लीटर काम मुगर थए कि लोगोड मोगर 1 किलो मुगर 1 किलो हरा बटाना एक किलो मोठ एक किलो एक किलो फु |
| A55 | 31.4 s | A | 3 | an extra line: चनडाल 1 किलो [a Theek hai warned] | चनडाल 1 किलो तूर दाल एक किलो बनसल तेल एक लिटर 1 पैकेट फॉर्चुएं तेल एक लीटर काम मुगर थए कि लोगोड मोगर 1 किलो मुगर 1 किलो हरा बटाना एक किलो मोठ एक किलो एक किलो फु |
| A55 | 31.4 s | C | 3 | बंसल तेल: wrong unit liter (expected packet) [NO warning] | चना दाल 1 किलो तूर दाल 1 किलो बंसल तेल 1 लीटर 1 पैकेट फॉर्चून तेल 1 लीटर मूंग दाल 1 किलो उड़द मोगर 1 किलो मूंग मोगर 1 किलो हरा बटाना 1 किलो मोठ 1 किलो 1 किलो फु |
| A55 | 31.4 s | C | 3 | an extra line: बंसल तेल [NO warning] | चना दाल 1 किलो तूर दाल 1 किलो बंसल तेल 1 लीटर 1 पैकेट फॉर्चून तेल 1 लीटर मूंग दाल 1 किलो उड़द मोगर 1 किलो मूंग मोगर 1 किलो हरा बटाना 1 किलो मोठ 1 किलो 1 किलो फु |
| A55 | 31.4 s | D | 3 | बंसल तेल: wrong unit liter (expected packet) [NO warning] | चना दाल 1 किलो, तुअर दाल 1 किलो, बंसल तेल 1 लीटर एक पैकेट, फॉर्च्यून तेल 1 लीटर, मूंग दाल 1 किलो, उड़द मोगर 1 किलो, मूंग मोगर 1 किलो, हरा बटाना 1 किलो, मोठ 1 कि |
| A55 | 31.4 s | D | 3 | an extra line: बंसल तेल [NO warning] | चना दाल 1 किलो, तुअर दाल 1 किलो, बंसल तेल 1 लीटर एक पैकेट, फॉर्च्यून तेल 1 लीटर, मूंग दाल 1 किलो, उड़द मोगर 1 किलो, मूंग मोगर 1 किलो, हरा बटाना 1 किलो, मोठ 1 कि |
| A57 | 49.3 s **(over 40 s)** | A | 1 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली 5 पीस, पालेजी बिसकिट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन 10 वाली 5 पीस फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटरजेंट |
| A57 | 49.3 s **(over 40 s)** | A | 1 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली 5 पीस, पालेजी बिसकिट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन 10 वाली 5 पीस फेना डिटरजेंट 1 किलो पैकेट 75 रुपए वुश डिटरजेंट |
| A57 | 49.3 s **(over 40 s)** | B | 1 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | B | 1 | वुश डिटर्जेंट: wrong product - heard "वुश डिटर्जेंट" (Washing Powder) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | C | 1 | फेना डिटर्जेंट: wrong unit kg (expected packet) [a Theek hai warned] | रिन साबुन 10 वाली 5 पीस पार्ले जी बिस्किट 30 वाला 5 पैकेट बंसल तेल पाउच 1 पैकेट 140 रुपए फेना साबुन 10 वाली 5 पीस फेना डिटर्जेंट 1 किलो पैकेट 75 रुपए वुश डिटर्ज |
| A57 | 49.3 s **(over 40 s)** | C | 1 | सर्फ एक्सेल: wrong unit kg (expected packet) [a Theek hai warned] | रिन साबुन 10 वाली 5 पीस पार्ले जी बिस्किट 30 वाला 5 पैकेट बंसल तेल पाउच 1 पैकेट 140 रुपए फेना साबुन 10 वाली 5 पीस फेना डिटर्जेंट 1 किलो पैकेट 75 रुपए वुश डिटर्ज |
| A57 | 49.3 s **(over 40 s)** | C | 1 | रिन साबुन: wrong product - heard "रिन साबुन" (Sabun) [a Theek hai warned] | रिन साबुन 10 वाली 5 पीस पार्ले जी बिस्किट 30 वाला 5 पैकेट बंसल तेल पाउच 1 पैकेट 140 रुपए फेना साबुन 10 वाली 5 पीस फेना डिटर्जेंट 1 किलो पैकेट 75 रुपए वुश डिटर्ज |
| A57 | 49.3 s **(over 40 s)** | D | 1 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | D | 1 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | D | 1 | रिन साबुन: wrong product - heard "रिन साबुन" (Sabun) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | B | 2 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | B | 2 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | B | 2 | वुश डिटर्जेंट: wrong product - heard "वुश डिटर्जेंट" (Washing Powder) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | C | 2 | रिन साबुन: wrong quantity 1 (expected 5) [a Theek hai warned] | rin sabun 10 wali 5 pis parle-g biscuit 30 wala 5 packet bansal tel pouch ek packet 140 rupaye fena sabun 10 wali 5 pis fena detergent 1 kilo packet 75 rupaye w |
| A57 | 49.3 s **(over 40 s)** | C | 2 | फेना डिटर्जेंट: wrong unit kg (expected packet) [a Theek hai warned] | rin sabun 10 wali 5 pis parle-g biscuit 30 wala 5 packet bansal tel pouch ek packet 140 rupaye fena sabun 10 wali 5 pis fena detergent 1 kilo packet 75 rupaye w |
| A57 | 49.3 s **(over 40 s)** | C | 2 | सर्फ एक्सेल: wrong unit kg (expected packet) [a Theek hai warned] | rin sabun 10 wali 5 pis parle-g biscuit 30 wala 5 packet bansal tel pouch ek packet 140 rupaye fena sabun 10 wali 5 pis fena detergent 1 kilo packet 75 rupaye w |
| A57 | 49.3 s **(over 40 s)** | D | 2 | रिन साबुन: wrong quantity 1 (expected 5) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | D | 2 | बंसल तेल पाउच: wrong quantity 5 (expected 1) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | D | 2 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | D | 2 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | B | 3 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | B | 3 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | B | 3 | वुश डिटर्जेंट: wrong product - heard "वुश डिटर्जेंट" (Washing Powder) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | C | 3 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | ऋण साबुन 10 वाली 5 पीस, पारलेजी बिस्किट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन 10 वाली 5 पीस, फेना डिटर्जेंट 1 किलो पैकेट 75 रुपए, वुश डिटर |
| A57 | 49.3 s **(over 40 s)** | C | 3 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | ऋण साबुन 10 वाली 5 पीस, पारलेजी बिस्किट 30 वाला 5 पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन 10 वाली 5 पीस, फेना डिटर्जेंट 1 किलो पैकेट 75 रुपए, वुश डिटर |
| A57 | 49.3 s **(over 40 s)** | D | 3 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A57 | 49.3 s **(over 40 s)** | D | 3 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, फेना साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक किलो पैकेट ₹75, वुश |
| A58 | 31.4 s | A | 1 | मूंग दाल: wrong quantity 1.96 (expected 1) [a Theek hai warned] | मुँग दाल 1.96 किलो रूपे, चना दाल 1 किलो 92 किलो, बरबटी दाल 88 किलो मुँग मोगर 110 किलो, उड़द मोगर 130 किलो, फुटाने 120 किलो, डालडा 160 किलो कर दो |
| A58 | 31.4 s | A | 1 | बरबटी दाल: wrong quantity 88 (expected 1) [a Theek hai warned] | मुँग दाल 1.96 किलो रूपे, चना दाल 1 किलो 92 किलो, बरबटी दाल 88 किलो मुँग मोगर 110 किलो, उड़द मोगर 130 किलो, फुटाने 120 किलो, डालडा 160 किलो कर दो |
| A58 | 31.4 s | A | 1 | मूंग मोगर: wrong quantity 110 (expected 1) [a Theek hai warned] | मुँग दाल 1.96 किलो रूपे, चना दाल 1 किलो 92 किलो, बरबटी दाल 88 किलो मुँग मोगर 110 किलो, उड़द मोगर 130 किलो, फुटाने 120 किलो, डालडा 160 किलो कर दो |
| A58 | 31.4 s | A | 1 | उड़द मोगर: wrong quantity 130 (expected 1) [a Theek hai warned] | मुँग दाल 1.96 किलो रूपे, चना दाल 1 किलो 92 किलो, बरबटी दाल 88 किलो मुँग मोगर 110 किलो, उड़द मोगर 130 किलो, फुटाने 120 किलो, डालडा 160 किलो कर दो |
| A58 | 31.4 s | A | 1 | डालडा: wrong quantity 160 (expected 1) [a Theek hai warned] | मुँग दाल 1.96 किलो रूपे, चना दाल 1 किलो 92 किलो, बरबटी दाल 88 किलो मुँग मोगर 110 किलो, उड़द मोगर 130 किलो, फुटाने 120 किलो, डालडा 160 किलो कर दो |
| A59 | 31.0 s | A | 1 | आटा: wrong price 3800/3800 (expected rate 4000) [a Theek hai warned] | ओके एक किलो आटा ए चारेसदी किलो पांच किलो आटा 175 रुपए दो किलो चीनी 56 रुपए किलो नहीं नहीं तीन किलो चीनी 56 रुपए किलो और 15 किलो गहू चोती से रुपए किलो 14 किलों ज |
| A59 | 31.0 s | A | 1 | गेहूँ: wrong quantity 15 (expected 5) [a Theek hai warned] | ओके एक किलो आटा ए चारेसदी किलो पांच किलो आटा 175 रुपए दो किलो चीनी 56 रुपए किलो नहीं नहीं तीन किलो चीनी 56 रुपए किलो और 15 किलो गहू चोती से रुपए किलो 14 किलों ज |
| A59 | 31.0 s | A | 1 | an extra line: चीनी [a Theek hai warned] | ओके एक किलो आटा ए चारेसदी किलो पांच किलो आटा 175 रुपए दो किलो चीनी 56 रुपए किलो नहीं नहीं तीन किलो चीनी 56 रुपए किलो और 15 किलो गहू चोती से रुपए किलो 14 किलों ज |
| A59 | 31.0 s | A | 1 | an extra line: जनडाल [a Theek hai warned] | ओके एक किलो आटा ए चारेसदी किलो पांच किलो आटा 175 रुपए दो किलो चीनी 56 रुपए किलो नहीं नहीं तीन किलो चीनी 56 रुपए किलो और 15 किलो गहू चोती से रुपए किलो 14 किलों ज |
| A59 | 31.0 s | B | 1 | चना दाल: wrong price 8000/24000 (expected rate 9200) [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A59 | 31.0 s | B | 1 | an extra line: चीनी [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A59 | 31.0 s | B | 1 | an extra line: चना दाल [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A59 | 31.0 s | A | 2 | चना दाल: wrong price 8000/24000 (expected rate 9200) [a Theek hai warned] | एक किलो आटा 40 रुपय किलो, पाँच किलो आटा 175 रुपय, दो किलो चीनी 56 रुपय किलो, नहीं नहीं तीन किलो चीनी 56 रुपय किलो, पाँच किलो गेहु 34 रुपय किलो, चार किलो चना दाल |
| A59 | 31.0 s | A | 2 | an extra line: चना दाल रुपय [NO warning] | एक किलो आटा 40 रुपय किलो, पाँच किलो आटा 175 रुपय, दो किलो चीनी 56 रुपय किलो, नहीं नहीं तीन किलो चीनी 56 रुपय किलो, पाँच किलो गेहु 34 रुपय किलो, चार किलो चना दाल |
| A59 | 31.0 s | B | 2 | चना दाल: wrong price 8000/24000 (expected rate 9200) [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A59 | 31.0 s | B | 2 | an extra line: चीनी [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A59 | 31.0 s | B | 2 | an extra line: चना दाल [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A59 | 31.0 s | B | 3 | चना दाल: wrong price 8000/24000 (expected rate 9200) [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A59 | 31.0 s | B | 3 | an extra line: चीनी [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A59 | 31.0 s | B | 3 | an extra line: चना दाल [NO warning] | 1 किलो आटा ₹40 किलो, 5 किलो आटा ₹175, 2 किलो चीनी ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो चना दाल ₹92 किलो, नहीं नहीं 3 किलो करो |
| A60 | 19.6 s | C | 1 | मदर डिलाइट तेल: wrong unit litre (expected liter) [a Theek hai warned] | मदर डिलाइट तेल 1 लीटर ₹150
हर्पिक एक बड़ा ₹110
हर्पिक एक छोटा ₹60
फिनायल बॉटल 1 लीटर ₹60 |
| A60 | 19.6 s | C | 1 | फिनाइल: wrong unit litre (expected bottle) [a Theek hai warned] | मदर डिलाइट तेल 1 लीटर ₹150
हर्पिक एक बड़ा ₹110
हर्पिक एक छोटा ₹60
फिनायल बॉटल 1 लीटर ₹60 |
| A60 | 19.6 s | D | 1 | फिनाइल: wrong unit litre (expected bottle) [NO warning] | मदर डिलाईट तेल (1L) ₹150, हार्पिक एक बड़ा ₹110, हार्पिक एक छोटा ₹60, फिनाइल बोतल एक ₹60 |
| A60 | 19.6 s | C | 2 | मदर डिलाइट तेल: wrong unit litre (expected liter) [a Theek hai warned] | मदर डीलाइट तेल एक लीटर 150 रुपए हारपिक एक बड़ा 110 रुपए हारपिक एक छोटा 60 रुपए फिनायल बॉटल एक 60 रुपए |
| A60 | 19.6 s | C | 3 | मदर डिलाइट तेल: wrong unit litre (expected liter) [a Theek hai warned] | Mother Delight tel 1 litre 150 rupaye, Harpic ek bada 110 rupaye, Harpic ek chhota 60 rupaye, Finall bottle ek 60 rupaye |
| A60 | 19.6 s | C | 3 | फिनाइल: wrong product - heard "Finall bottle ek" (Lizol) [NO warning] | Mother Delight tel 1 litre 150 rupaye, Harpic ek bada 110 rupaye, Harpic ek chhota 60 rupaye, Finall bottle ek 60 rupaye |
| A60 | 19.6 s | D | 3 | फिनाइल: wrong product - heard "Finall bottle ek" (Lizol) [NO warning] | मदर डिलाईट तेल (1L) ₹150, हार्पिक एक बड़ा ₹110, हार्पिक एक छोटा ₹60, फिनाइल बोतल एक ₹60 |
| A61 | 76.1 s **(over 40 s)** | C | 3 | फेना साबुन: wrong product - heard "फेना साबुन" (Godrej No.1 Soap) [NO warning] | तूर दाल पांच किलो 150 रुपए किलो डिटॉल साबुन सेट एक 175 रुपए फेना साबुन 12 110 रुपए रिम साबुन सेट एक 105 रुपए फेना डिटर्जेंट 3 किलो 285 रुपए विदिसा डिटर्जेंट 1 क |
| A61 | 76.1 s **(over 40 s)** | C | 3 | फेना डिटर्जेंट: wrong product - heard "फेना डिटर्जेंट" (Nirma) [NO warning] | तूर दाल पांच किलो 150 रुपए किलो डिटॉल साबुन सेट एक 175 रुपए फेना साबुन 12 110 रुपए रिम साबुन सेट एक 105 रुपए फेना डिटर्जेंट 3 किलो 285 रुपए विदिसा डिटर्जेंट 1 क |
| A61 | 76.1 s **(over 40 s)** | D | 3 | फेना साबुन: wrong product - heard "फेना साबुन" (Godrej No.1 Soap) [NO warning] | Toor Daal 5 किलो ₹150 किलो, डेटॉल साबुन सेट 1 ₹175, फेना साबुन 12 ₹110, रिन साबुन सेट 1 ₹105, फेना डिटर्जेंट 3 किलो ₹285, विदिशा डिटर्जेंट 1 किलो ₹70, चना दाल 1 |
| A61 | 76.1 s **(over 40 s)** | D | 3 | फेना डिटर्जेंट: wrong product - heard "फेना डिटर्जेंट" (Nirma) [NO warning] | Toor Daal 5 किलो ₹150 किलो, डेटॉल साबुन सेट 1 ₹175, फेना साबुन 12 ₹110, रिन साबुन सेट 1 ₹105, फेना डिटर्जेंट 3 किलो ₹285, विदिशा डिटर्जेंट 1 किलो ₹70, चना दाल 1 |

## Errors and timeouts (the order showed nothing, never a wrong line)
| Recording | Candidate | Run | Error |
|---|---|---|---|
| A17 | C2 | 1 | timeout |
| A20 | C2 | 1 | timeout |
| A27 | C2 | 1 | timeout |
| A38 | C2 | 1 | timeout |
| A39 | C2 | 1 | timeout |
| A49 | C2 | 1 | timeout |
| A52 | C2 | 2 | timeout |
| A52 | C2 | 3 | timeout |
| A56 | C2 | 1 | timeout |
| A57 | C2 | 1 | fetch failed |
| A57 | C2 | 3 | timeout |
| A61 | C2 | 1 | timeout |
| A62 | C2 | 2 | timeout |
