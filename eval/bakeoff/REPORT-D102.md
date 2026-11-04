# KB-370 — Voice bake-off (V1, report only)

**Scoring:** D102 - names as said (owner, 4 Nov 2026) · **Run:** 2026-11-04 · **Results file:** `eval/bakeoff/results-2026-10-31-d102.json` · Nothing in the app changed; no deploy.
**Rule for any winner:** 0 wrong numbers on a final line (`docs/24-ROADMAP.md` Phase V, D100). "Wrong" = a confident number or product that is not what was said; "silent" = no Theek hai warned about it.

## Summary
<!-- summary -->
_Written by hand after the run: which candidate, why, and what it costs - in plain words._
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
| **A** | 48 x 1 | 27/48 (56%) | **11** (5) | 10 | 1 | 4 | 0 / 0 | 0 | 11 | 27 | 0 | 2.5 / 4.5 / 5.2 | Rs 0.15 | Rs 439 |
| **A+vocab (run 1, old scoring - reference only)** | 48 x 1 | 24/48 (50%) | **27** (21) | 16 | 11 | 16 | 2 / 0 | 9 | 3 | 28 | 0 | 2.5 / 4.7 / 6.6 | Rs 0.15 | Rs 464 |
| **B** | 48 x 1 | 34/48 (71%) | **13** (11) | 11 | 2 | 0 | 2 / 0 | 1 | 1 | 17 | 0 | 2.8 / 4.3 / 5.7 | Rs 0.16 | Rs 492 |
| **C** | 48 x 1 | 30/48 (63%) | **17** (9) | 15 | 2 | 0 | 2 / 0 | 1 | 1 | 27 | 0 | 3.1 / 4.2 / 4.8 | Rs 0.55 | Rs 1644 |
| **C2 (run 1, old scoring - reference only)** | 48 x 1 | 25/48 (52%) | **18** (15) | 4 | 14 | 34 | 1 / 0 | 2 | 0 | 7 | 6 | 13.1 / 27.6 / 42.8 | Rs 1 | Rs 3364 |
| **D** | 48 x 1 | 31/48 (65%) | **16** (9) | 14 | 2 | 0 | 2 / 0 | 1 | 1 | 30 | 0 | 3.1 / 4.2 / 4.8 | Rs 0.65 | Rs 1935 |

### The 7 orders Whisper mis-heard on 30 Oct (set aside from the gate): A19, A27, A32, A33, A34, A35, A39
| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated silent / warned | Invented | Numbers right, name wrong | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** | 7 x 1 | 1/7 (14%) | **6** (2) | 5 | 1 | 4 | 0 / 0 | 0 | 3 | 17 | 0 | 4.6 / 5.2 / 5.2 | Rs 0.25 | Rs 736 |
| **A+vocab (run 1, old scoring - reference only)** | 7 x 1 | 0/7 (0%) | **7** (4) | 3 | 4 | 9 | 1 / 0 | 3 | 1 | 13 | 0 | 4.4 / 5.6 / 5.6 | Rs 0.24 | Rs 729 |
| **B** | 7 x 1 | 2/7 (29%) | **5** (4) | 5 | 0 | 0 | 2 / 0 | 1 | 0 | 11 | 0 | 4.0 / 5.7 / 5.7 | Rs 0.27 | Rs 815 |
| **C** | 7 x 1 | 2/7 (29%) | **8** (5) | 8 | 0 | 0 | 2 / 0 | 1 | 0 | 10 | 0 | 3.9 / 4.4 / 4.4 | Rs 0.60 | Rs 1792 |
| **C2 (run 1, old scoring - reference only)** | 7 x 1 | 1/7 (14%) | **7** (7) | 3 | 4 | 17 | 1 / 0 | 2 | 0 | 0 | 2 | 24.7 / 42.8 / 42.8 | Rs 0.96 | Rs 2868 |
| **D** | 7 x 1 | 2/7 (29%) | **8** (5) | 8 | 0 | 0 | 2 / 0 | 1 | 0 | 11 | 0 | 3.9 / 4.4 / 4.4 | Rs 0.75 | Rs 2248 |

## Long orders (A51-A62, 3 runs each)
| Candidate | Orders x runs | Exact | Wrong lines (silent) | Wrong numbers | Wrong products | Dropped | Duplicated silent / warned | Invented | Numbers right, name wrong | Lines with a Theek hai | Errors | Seconds median / p90 / max | Rs per bill | Rs per month (100 bills a day) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** | 12 x 3 | 8/36 (22%) | **30** (9) | 30 | 0 | 32 | 1 / 3 | 14 | 10 | 113 | 0 | 5.1 / 7.6 / 11.8 | Rs 0.29 | Rs 859 |
| **A+vocab (run 1, old scoring - reference only)** | 12 x 3 | 9/36 (25%) | **56** (24) | 48 | 8 | 27 | 2 / 0 | 18 | 6 | 122 | 0 | 4.9 / 8.2 / 9.7 | Rs 0.32 | Rs 956 |
| **A-30s (run 1, old scoring - reference only)** | 12 x 3 | 3/36 (8%) | **39** (9) | 31 | 8 | 22 | 1 / 1 | 1 | 0 | 147 | 0 | 5.0 / 8.4 / 10.4 | Rs 0.30 | Rs 912 |
| **B** | 12 x 3 | 23/36 (64%) | **15** (14) | 15 | 0 | 0 | 6 / 0 | 1 | 0 | 41 | 0 | 3.7 / 5.2 / 5.7 | Rs 0.37 | Rs 1098 |
| **C** | 12 x 3 | 17/36 (47%) | **12** (3) | 12 | 0 | 0 | 1 / 4 | 0 | 17 | 90 | 0 | 3.8 / 5.4 / 6.5 | Rs 0.66 | Rs 1978 |
| **C2 (run 1, old scoring - reference only)** | 12 x 3 | 12/36 (33%) | **8** (6) | 2 | 6 | 68 | 0 / 0 | 0 | 0 | 79 | 7 | 20.2 / 35.9 / 43.9 | Rs 1 | Rs 3482 |
| **D** | 12 x 3 | 18/36 (50%) | **9** (8) | 9 | 0 | 0 | 1 / 4 | 0 | 18 | 62 | 0 | 3.8 / 5.4 / 6.5 | Rs 0.93 | Rs 2800 |

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
| A51 | 27.9 s | A | 1/3 | 0 | 1 | 0.3 | 4.8 |
| A51 | 27.9 s | B | 3/3 | 0 | 0 | 0.0 | 2.6 |
| A51 | 27.9 s | C | 2/3 | 0 | 0 | 0.0 | 3.7 |
| A51 | 27.9 s | D | 3/3 | 0 | 0 | 0.0 | 3.7 |
| A52 | 23.3 s | A | 0/3 | 0 | 8 | 2.7 | 4.8 |
| A52 | 23.3 s | B | 3/3 | 0 | 0 | 0.0 | 2.7 |
| A52 | 23.3 s | C | 3/3 | 0 | 0 | 0.0 | 3.6 |
| A52 | 23.3 s | D | 3/3 | 0 | 0 | 0.0 | 3.6 |
| A53 | 29.0 s | A | 2/3 | 0 | 1 | 0.3 | 4.8 |
| A53 | 29.0 s | B | 3/3 | 0 | 0 | 0.0 | 2.8 |
| A53 | 29.0 s | C | 3/3 | 0 | 0 | 0.0 | 4.4 |
| A53 | 29.0 s | D | 3/3 | 0 | 0 | 0.0 | 4.4 |
| A54 | 30.8 s | A | 1/3 | 0 | 2 | 0.7 | 4.8 |
| A54 | 30.8 s | B | 2/3 | 0 | 1 | 0.3 | 4.9 |
| A54 | 30.8 s | C | 3/3 | 0 | 0 | 0.0 | 3.7 |
| A54 | 30.8 s | D | 3/3 | 0 | 0 | 0.0 | 3.7 |
| A55 | 31.4 s | A | 0/3 | 1 | 2 | 1.7 | 5.7 |
| A55 | 31.4 s | B | 0/3 | 0 | 0 | 0.0 | 4.2 |
| A55 | 31.4 s | C | 0/3 | 0 | 1 | 0.7 | 4.6 |
| A55 | 31.4 s | D | 0/3 | 0 | 1 | 0.7 | 4.6 |
| A56 | 30.8 s | A | 1/3 | 0 | 0 | 0.0 | 4.3 |
| A56 | 30.8 s | B | 3/3 | 0 | 0 | 0.0 | 2.5 |
| A56 | 30.8 s | C | 1/3 | 0 | 0 | 0.0 | 3.5 |
| A56 | 30.8 s | D | 1/3 | 0 | 0 | 0.0 | 3.5 |
| A57 | 49.3 s **(over 40 s)** | A | 0/3 | 0 | 2 | 0.7 | 4.8 |
| A57 | 49.3 s **(over 40 s)** | B | 0/3 | 1 | 2 | 1.7 | 4.8 |
| A57 | 49.3 s **(over 40 s)** | C | 0/3 | 2 | 2 | 2.0 | 3.8 |
| A57 | 49.3 s **(over 40 s)** | D | 0/3 | 2 | 2 | 2.0 | 3.8 |
| A58 | 31.4 s | A | 0/3 | 0 | 5 | 1.7 | 4.8 |
| A58 | 31.4 s | B | 3/3 | 0 | 0 | 0.0 | 2.9 |
| A58 | 31.4 s | C | 0/3 | 0 | 0 | 0.0 | 3.9 |
| A58 | 31.4 s | D | 0/3 | 0 | 0 | 0.0 | 3.9 |
| A59 | 31.0 s | A | 0/3 | 0 | 3 | 2.0 | 5.6 |
| A59 | 31.0 s | B | 0/3 | 3 | 3 | 3.0 | 3.9 |
| A59 | 31.0 s | C | 0/3 | 0 | 0 | 0.0 | 3.7 |
| A59 | 31.0 s | D | 0/3 | 0 | 0 | 0.0 | 3.7 |
| A60 | 19.6 s | A | 0/3 | 0 | 0 | 0.0 | 3.3 |
| A60 | 19.6 s | B | 0/3 | 0 | 0 | 0.0 | 4.8 |
| A60 | 19.6 s | C | 0/3 | 1 | 2 | 1.3 | 3.3 |
| A60 | 19.6 s | D | 0/3 | 0 | 1 | 0.3 | 3.3 |
| A61 | 76.1 s **(over 40 s)** | A | 1/3 | 0 | 0 | 0.0 | 10.6 |
| A61 | 76.1 s **(over 40 s)** | B | 3/3 | 0 | 0 | 0.0 | 4.9 |
| A61 | 76.1 s **(over 40 s)** | C | 2/3 | 0 | 0 | 0.0 | 6.3 |
| A61 | 76.1 s **(over 40 s)** | D | 2/3 | 0 | 0 | 0.0 | 6.3 |
| A62 | 51.4 s **(over 40 s)** | A | 2/3 | 0 | 0 | 0.0 | 6.6 |
| A62 | 51.4 s **(over 40 s)** | B | 3/3 | 0 | 0 | 0.0 | 3.3 |
| A62 | 51.4 s **(over 40 s)** | C | 3/3 | 0 | 0 | 0.0 | 4.9 |
| A62 | 51.4 s **(over 40 s)** | D | 3/3 | 0 | 0 | 0.0 | 4.9 |

## Every wrong line
| Recording | Length | Candidate | Run | What was wrong | What it heard |
|---|---|---|---|---|---|
| A02 | 7.2 s | C2 | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | … किलो तूर दाल 150 रुपए किलो एक किलो [फल्ली] दाने 140 रुपए किलो |
| A03 | 6.8 s | C2 | 1 | जवारी: wrong product - heard "जवारी" (Jowar Sabut) [NO warning] | एक किलो [जवारी] चौंतीस रुपए किलो एक किलो दालिया एक सौ … |
| A09 | 4.0 s | A+vocab | 1 | जवारी: wrong product - heard "जवारी" (Jowar Atta) [NO warning] | एक किलो बाजरा, एक किलो [जवारी] |
| A09 | 4.0 s | C2 | 1 | जवारी: wrong product - heard "जवारी" (Jowar Sabut) [NO warning] | एक किलो बाजरा एक किलो [जवारी] |
| A10 | 3.8 s | C2 | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [a Theek hai warned] | एक किलो [फल्ली] दाने एक किलो दालिया |
| A14 | 16.3 s | A+vocab | 1 | बटाना: wrong product - heard "बटाना दाल" (बटाना दाल) [NO warning] | … 5 kg चावल 90 रुपए कीलो, 8 kg [बटाना] दाल 60 रुपए कीलो, 1 kg हरा बटाना … |
| A14 | 16.3 s | C2 | 1 | बटाना: wrong product - heard "बटाना दाल" (बटाना दाल) [NO warning] | … 5 किलो चावल 90 रुपए किलो 8 किलो [बटाना] दाल 60 रुपए किलो 1 किलो हरा बटाना … |
| A15 | 15.1 s | C2 | 1 | फली दाने: wrong product - heard "फल्ली दाने" (Moongfali) [a Theek hai warned] | दो किलो चीनी दो किलो गुड़ एक किलो [फल्ली] दाने एक किलो चना एक किलो मैदा |
| A17 | 14.9 s | A+vocab | 1 | an extra line: dettol set [NO warning] | 1 Dettol Set, 125 रुप, 1 Santur Set, 40 रुप, 1 Santur Hand Wash Set, 105 रुप, |
| A17 | 14.9 s | A+vocab | 1 | an extra line: 125 रुप [NO warning] | 1 Dettol Set, 125 रुप, 1 Santur Set, 40 रुप, 1 Santur Hand Wash Set, 105 रुप, |
| A17 | 14.9 s | A+vocab | 1 | an extra line: 1 Santur Hand Wash Set [NO warning] | 1 Dettol Set, 125 रुप, 1 Santur Set, 40 रुप, 1 Santur Hand Wash Set, 105 रुप, |
| A17 | 14.9 s | A+vocab | 1 | an extra line: 1 Lysol [NO warning] | 1 Dettol Set, 125 रुप, 1 Santur Set, 40 रुप, 1 Santur Hand Wash Set, 105 रुप, |
| A19 | 16.4 s | A+vocab | 1 | an extra line: moong daal [NO warning] | 2 Kg. Moong Daal, 2 Kg. Chana Daal, 2 Kg. Urad Mogar, 1 Kg. Moong Mogar, 1 |
| A19 | 16.4 s | A+vocab | 1 | an extra line: chana daal [NO warning] | 2 Kg. Moong Daal, 2 Kg. Chana Daal, 2 Kg. Urad Mogar, 1 Kg. Moong Mogar, 1 |
| A19 | 16.4 s | C2 | 1 | an extra line: मूंग दाल [NO warning] | दो किलो मूंग दाल दो किलो चना दाल दो किलो उड़द मोगर एक किलो मूंग मोगर एक |
| A19 | 16.4 s | C2 | 1 | an extra line: चना दाल [NO warning] | दो किलो मूंग दाल दो किलो चना दाल दो किलो उड़द मोगर एक किलो मूंग मोगर एक |
| A20 | 20.8 s | A+vocab | 1 | खड़ी हल्दी: wrong product - heard "खड़ी हलदी" (हल्दी गाठ) [a Theek hai warned] | … मसाला पैकेट, 1 किलो हलदी पैकेट, 1 किलो [खड़ी] हलदी, 1 किलो दाने, 1 किलो चावल, 1 … |
| A25 | 16.1 s | A+vocab | 1 | गेहूं: wrong quantity 34 (expected 10) [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल |
| A25 | 16.1 s | A+vocab | 1 | गेहूं: wrong quantity 36 (expected 30) [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल |
| A25 | 16.1 s | A+vocab | 1 | आटा: wrong quantity 175 (expected 5) [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल |
| A25 | 16.1 s | A+vocab | 1 | तुअर दाल: wrong quantity 150 (expected 5) [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल |
| A25 | 16.1 s | A+vocab | 1 | an extra line: गेहूं [NO warning] | 10 गेहूं 34 किलों, 30 गेहूं 36 किलों, 5 गेहूं आटा 175 किलों, 5 गेहूं तूवर दाल |
| A32 | 22.3 s | C2 | 1 | an extra line: मूंग दाल [NO warning] | मोठ 1 किलो 130 रुपए किलो काबुली चना 1 किलो 120 रुपए किलो काबुली चना 1 किलो |
| A33 | 20.3 s | A+vocab | 1 | an extra line: दाली [a Theek hai warned] | फल्ली दाने 140 रुपए क्यों स कैलो मेरा फल्ली द मिनट पचय रुपए किलो दूर दाल 140 |
| A33 | 20.3 s | A+vocab | 1 | खंडा तुअर दाल: wrong product - heard "Khanda दाल" (खंडा दाल) [a Theek hai warned] | … रुपए किलो दूर दाल 140 रुपए क्यों स [iKhanda] दाल 80 रुपए के लिए आल्युक्रील से इन … |
| A33 | 20.3 s | C2 | 1 | फल्ली दाना: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | [फल्ली] दाने 140 रुपए किलो फल्ली दाने 150 रुपए … |
| A33 | 20.3 s | C2 | 1 | फल्ली दाना: wrong product - heard "फल्ली दाने" (Moongfali) [NO warning] | [फल्ली] दाने 140 रुपए किलो फल्ली दाने 150 रुपए … |
| A33 | 20.3 s | C2 | 1 | खंडा तुअर दाल: wrong product - heard "तुवर दाल" (Toor Daal) [NO warning] | … 140 रुपए किलो फल्ली दाने 150 रुपए किलो [तुवर] दाल 140 रुपए किलो खंडा तुवर दाल 80 … |
| A34 | 11.4 s | A+vocab | 1 | बंसल तेल: wrong product - heard "तेल" (Tel Pouch) [a Theek hai warned] | 1.25 किलो मूंग दाल, 96 रुपए किलो, [तेल] 1 पैकेट 140 वाला, तेल 1 लीटर 150 … |
| A34 | 11.4 s | C2 | 1 | बंसल तेल: wrong product - heard "तेल" (Tel Packet 1L) [NO warning] | सवा किलो मूंग दाल छानवे रुपए किलो [तेल] एक पैकेट एक सौ चालीस वाला तेल एक … |
| A35 | 12.5 s | A+vocab | 1 | फॉर्च्यून तेल: wrong product - heard "तेल पैकेट एक" (Tel Pouch) [NO warning] | [तेल] पैकेट एक, Fortune, 160 रुपए, Mother Delight, तेल … |
| A35 | 12.5 s | A+vocab | 1 | मदर डिलाइट तेल: wrong product - heard "तेल 1 लिटर" (Tel (1L)) [NO warning] | [तेल] पैकेट एक, Fortune, 160 रुपए, Mother Delight, तेल … |
| A36 | 10.4 s | A+vocab | 1 | बंसल तेल: wrong unit litre (expected liter) [a Theek hai warned] | आधा किलो मैदा पैकेट 22 रुपए, एक बंसल तेल पैकेट 140 रुपए, एक बंसल एक लिटर 150 |
| A40 | 20.0 s | A+vocab | 1 | गेहूं: wrong price 3200/32000 (expected rate 3400) [a Theek hai warned] | गेहूं 10 किलों, तीन ची डोराहीर्थान 2.8ी 13.6 रुपाए गेहूं 10 किलों 34 रुपए किलोहान Sour Custody |
| A43 | 6.6 s | A+vocab | 1 | रजवाडी गुड: wrong product - heard "रजवाडी गुड 1 Kg" (Gur) [NO warning] | Marble Chai 1 Kg, 300 रुपए, [रजवाडी] गुड 1 Kg, 80 रुपए |
| A44 | 9.1 s | A+vocab | 1 | एवरेस्ट किचन किंग मसाला: wrong product - heard "एवरेस्ट किचन किंग मसाला 100 ग्राम" (Kitchen King) [NO warning] | [एवरेस्ट] किचन किंग मसाला 100 ग्राम 100 रुपए, छोले … |
| A44 | 9.1 s | C2 | 1 | एवरेस्ट किचन किंग मसाला: wrong product - heard "एवरेस्ट किचन किंग मसाला" (Kitchen King) [NO warning] | [एवरेस्ट] किचन किंग मसाला 100 ग्राम 100 रुपए छोले … |
| A46 | 7.3 s | C2 | 1 | इंडिपेंडेंस सरसों तेल: wrong unit litre (expected liter) [a Theek hai warned] | इंडिपेंडेंस सरसों तेल एक लीटर दो सौ रुपए पॉन्ड्स पाउडर एक बड़ा सौ रुपए |
| A47 | 19.5 s | A+vocab | 1 | लाइज़ॉल: wrong product - heard "लाइजॉल" (Lizol) [NO warning] | फुटाने 110 रुपे किलो, [लाइजॉल] 110 रुपे, गुड 98 रुपे, चावल 98 रुपे |
| A47 | 19.5 s | C2 | 1 | लाइज़ॉल: wrong product - heard "लाइज़ोल" (Lizol) [NO warning] | फुटाने एक सौ दस रुपये किलो [लाइज़ोल] एक सौ दस रुपये गुड़ अट्ठानवे रुपये चावल … |
| A49 | 8.2 s | A+vocab | 1 | रिफाइंड सोयाबीन ऑयल: wrong total 20000 (expected 17000) [NO warning] | Refined Soya Bean Oil 170 रुपए, Ground Nut Oil 200 रुपए |
| A49 | 8.2 s | A+vocab | 1 | ग्राउंडनट ऑयल: wrong total 17000 (expected 20000) [NO warning] | Refined Soya Bean Oil 170 रुपए, Ground Nut Oil 200 रुपए |
| A50 | 9.5 s | A+vocab | 1 | स्वाद चायपत्ती: wrong product - heard "चाय पत्ती 1 किलो 500 रुपए" (Chai Patti) [NO warning] | स्वाच [चाय] पत्ती 1 किलो 500 रुपए, सायद, तूद ब्रस … |
| A50 | 9.5 s | C2 | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती एक किलो 500 रुपये शायद [टूथब्रश] एक 35 रुपये टूथब्रश एक 60 रुपये |
| A50 | 9.5 s | C2 | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती एक किलो 500 रुपये शायद [टूथब्रश] एक 35 रुपये टूथब्रश एक 60 रुपये |
| A52 | 23.3 s | A+vocab | 2 | पतला पोहा: wrong price 6800/6800 (expected rate 6000) [NO warning] | पतला पोहा एक किलो 68 रुपआ किलो, फुटाने एक किलो 120 रुपए किलो, दालिया एक किलो 120 |
| A52 | 23.3 s | A-30s | 3 | फुटाने: wrong price 2000/2000 (expected rate 12000) [NO warning] | पतला पोहा एक किलो साठ रुपई किलो फुटाने एक किलो एकसू बीस रुपई किलो दालिया एक किलो |
| A52 | 23.3 s | A-30s | 3 | दालिया: wrong price 2000/2000 (expected rate 12000) [NO warning] | पतला पोहा एक किलो साठ रुपई किलो फुटाने एक किलो एकसू बीस रुपई किलो दालिया एक किलो |
| A53 | 29.0 s | A+vocab | 1 | सैगी मूंग: wrong product - heard "मूंग" (Moong) [NO warning] | … जाडा पोहा एक किलो पचास रुपई किलो सैगी [मूंग] एक किलो छेनो रुपई किलो काबुली चना 1 … |
| A53 | 29.0 s | C2 | 1 | सैगी मूंग: wrong product - heard "सगी मूंग" (Moong) [NO warning] | … किलो जाड़ा पोहा एक किलो पचास रुपए किलो [सगी] मूंग एक किलो छानवे रुपए किलो काबुली चना … |
| A53 | 29.0 s | A+vocab | 3 | सैगी मूंग: wrong product - heard "सैगी मूंग" (Moong) [NO warning] | … किलो, जाड़ा पोहा, एक किलो, पचास रुपई किलो [सैगी] मूंग 1 किलो 96 रुपए किलो, काबुली चना … |
| A53 | 29.0 s | A-30s | 3 | सैगी मूंग: wrong product - heard "सैगी मूँग 1 किलो" (Moong) [a Theek hai warned] | … किलो जड़ा पुहा 1 किलो पचास रुपाय किलो [सैगी] मूँग 1 किलो एकसो 96 रुपाय किलो काबुली … |
| A53 | 29.0 s | C2 | 3 | सैगी मूंग: wrong product - heard "सगी मूंग" (Moong) [NO warning] | … किलो जाड़ा पोहा एक किलो 50 रुपए किलो [सगी] मूंग एक किलो 96 रुपए किलो काबुली चना … |
| A54 | 30.8 s | A+vocab | 1 | तुअर दाल: wrong price 9000/9000 (expected rate 15000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | मूंग दाल: wrong price 11000/11000 (expected rate 9600) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | चावल: wrong total 25000 (expected 60000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | बासमती चावल: wrong total 45000 (expected 80000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | आटा: wrong total 19000 (expected 17500) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | चना दाल: wrong price 8000/8000 (expected rate 9200) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | आटा: wrong price 3800/3800 (expected rate 4000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 150 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 96 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 600 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 800 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 175 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 92 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 1 | an extra line: 40 Rs. Kg [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A-30s | 1 | चावल: wrong total 300000 (expected 60000) [a Theek hai warned] | तुवर डाल एक किलो फटका 150 किलो मूंग डाल एक किलो 96 किलो चावल पाँच किलो 600 |
| A54 | 30.8 s | A-30s | 1 | बासमती चावल: wrong total 400000 (expected 80000) [a Theek hai warned] | तुवर डाल एक किलो फटका 150 किलो मूंग डाल एक किलो 96 किलो चावल पाँच किलो 600 |
| A54 | 30.8 s | A-30s | 1 | आटा: wrong total 87500 (expected 17500) [a Theek hai warned] | तुवर डाल एक किलो फटका 150 किलो मूंग डाल एक किलो 96 किलो चावल पाँच किलो 600 |
| A54 | 30.8 s | A+vocab | 2 | तुअर दाल: wrong price 9000/9000 (expected rate 15000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 2 | चावल: wrong total 300000 (expected 60000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 2 | बासमती चावल: wrong total 400000 (expected 80000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 2 | आटा: wrong total 87500 (expected 17500) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 2 | an extra line: फटका [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 3 | तुअर दाल: wrong price 9000/9000 (expected rate 15000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 3 | चावल: wrong total 300000 (expected 60000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 3 | बासमती चावल: wrong total 400000 (expected 80000) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 3 | आटा: wrong total 87500 (expected 17500) [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A54 | 30.8 s | A+vocab | 3 | an extra line: फटका [a Theek hai warned] | Tua Dal 1 Kg, फटका, 150 Rs. Kg, Mung Dal 1 Kg, 96 Rs. Kg, चावल 5 |
| A55 | 31.4 s | A+vocab | 1 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | चना दाल 1 किलो, तूर दाल 1 किलो, बंसल तेल 1 लिटर 1 पैकेट, फॉर्चुन तेल 1 |
| A55 | 31.4 s | A-30s | 1 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | कि चना दाल 1 किलो तूअर दाल 1 किलो बंसल तेल एक लिटर एक पैकेट फॉर्चून तेल |
| A55 | 31.4 s | A-30s | 2 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | कमागमामा चननामो में चना दाल 1 किलो तुउऽ दाल 1 किलो भन्सल तेल 1 लीटर एक पैकेट |
| A55 | 31.4 s | C2 | 2 | फॉर्च्यून तेल: wrong unit litre (expected liter) [a Theek hai warned] | चना दाल 1 किलो तुवर दाल 1 किलो बंसल तेल 1 लीटर 1 पैकेट फॉर्च्यून तेल 1 |
| A55 | 31.4 s | A+vocab | 3 | बंसल तेल: wrong unit liter (expected packet) [a Theek hai warned] | चना दाल 1 किलो, तूर दाल 1 किलो, बंसल तेल 1 लिटर 1 पैकेट, फॉर्चुन तेल 1 |
| A55 | 31.4 s | A-30s | 3 | हरा बटाना: wrong quantity 2 (expected 1) [a Theek hai warned] | एक किलो हरा बटाना एक किलो कि एक मोठ एक किलो कि एक किलो फुटाने एक किलो |
| A56 | 30.8 s | A-30s | 1 | हरा बटाना: wrong quantity 1.25 (expected 1.5) [a Theek hai warned] | 1.25 किलो मूँगडाल 1.25 किलो हरा बटाना 2 किलो चनादाल 1.25 किलो रवा 1.25 किलो मैदा 1.25 |
| A56 | 30.8 s | A-30s | 1 | रवा: wrong quantity 1.25 (expected 1.5) [a Theek hai warned] | 1.25 किलो मूँगडाल 1.25 किलो हरा बटाना 2 किलो चनादाल 1.25 किलो रवा 1.25 किलो मैदा 1.25 |
| A56 | 30.8 s | A-30s | 1 | बरबटी दाल: wrong quantity 1.25 (expected 1.75) [a Theek hai warned] | 1.25 किलो मूँगडाल 1.25 किलो हरा बटाना 2 किलो चनादाल 1.25 किलो रवा 1.25 किलो मैदा 1.25 |
| A56 | 30.8 s | A-30s | 1 | राजमा: wrong quantity 1.25 (expected 1.5) [a Theek hai warned] | 1.25 किलो मूँगडाल 1.25 किलो हरा बटाना 2 किलो चनादाल 1.25 किलो रवा 1.25 किलो मैदा 1.25 |
| A56 | 30.8 s | A-30s | 3 | मूंग दाल: wrong quantity 2.5 (expected 1.25) [NO warning] | 2.5 किलो मूंग दाल, 1.5 किलो हरा बटाना, 2 किलो चना दाल, 1.5 किलो रवा, सवा किलो |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 1 | पार्ले जी बिस्किट: wrong product - heard "पालेजी बिस्किट" (Parle-G 10) [NO warning] | रिन साबुन 10 वाली 5 पीस, [पालेजी] बिस्किट 30 वाला 5 पैकेट, बंसल तेल पाउच … |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 1 | बंसल तेल पाउच: wrong product - heard "बंसल तेल पाउच" (Tel Pouch) [NO warning] | … 5 पीस, पालेजी बिस्किट 30 वाला 5 पैकेट, [बंसल] तेल पाउच 1 पैकेट 140 रुपए फेना साबुन … |
| A57 | 49.3 s **(over 40 s)** | A-30s | 1 | बंसल तेल पाउच: wrong product - heard "बंसल तेल पाउच" (Tel Pouch) [NO warning] | … 5 पीस, पालेजी बिसकिट 30 वाला 5 पैकेट, [बंसल] तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन … |
| A57 | 49.3 s **(over 40 s)** | A-30s | 2 | बंसल तेल पाउच: wrong product - heard "बंसल तेल पाउच" (Tel Pouch) [NO warning] | … 5 पीस, पालेजी बिसकिट 30 वाला 5 पैकेट, [बंसल] तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन … |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 3 | फेना डिटर्जेंट: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली 5 पीस, पारलेजी बिस्किट 30 वाला 5 पैकेट, बनसल तेल पाउच 1 पैकेट |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 3 | सर्फ एक्सेल: wrong unit kg (expected packet) [NO warning] | रिन साबुन 10 वाली 5 पीस, पारलेजी बिस्किट 30 वाला 5 पैकेट, बनसल तेल पाउच 1 पैकेट |
| A57 | 49.3 s **(over 40 s)** | A+vocab | 3 | बंसल तेल पाउच: wrong product - heard "बनसल तेल पाउच" (Tel Pouch) [NO warning] | … 5 पीस, पारलेजी बिस्किट 30 वाला 5 पैकेट, [बनसल] तेल पाउच 1 पैकेट 140 रुपए फेना साबुन … |
| A57 | 49.3 s **(over 40 s)** | A-30s | 3 | बंसल तेल पाउच: wrong product - heard "बंसल तेल पाउच 1 पैकेट 140 रुपए" (Tel Pouch) [NO warning] | … 5 पीस, पालेजी बिसकिट 30 वाला 5 पैकेट, [बंसल] तेल पाउच 1 पैकेट 140 रुपए, फेना साबुन … |
| A58 | 31.4 s | A-30s | 2 | मूंग दाल: wrong quantity 1.96 (expected 1) [a Theek hai warned] | मोंग दाल 1.96 किलो, चना दाल 1.92 किलो, बर्बटी दाल 88 किलो मॉंग मोगर 110 किलो, उड़द |
| A58 | 31.4 s | A-30s | 2 | चना दाल: wrong quantity 1.92 (expected 1) [a Theek hai warned] | मोंग दाल 1.96 किलो, चना दाल 1.92 किलो, बर्बटी दाल 88 किलो मॉंग मोगर 110 किलो, उड़द |
| A58 | 31.4 s | A-30s | 2 | बरबटी दाल: wrong quantity 88 (expected 1) [a Theek hai warned] | मोंग दाल 1.96 किलो, चना दाल 1.92 किलो, बर्बटी दाल 88 किलो मॉंग मोगर 110 किलो, उड़द |
| A58 | 31.4 s | A-30s | 2 | उड़द मोगर: wrong quantity 130 (expected 1) [a Theek hai warned] | मोंग दाल 1.96 किलो, चना दाल 1.92 किलो, बर्बटी दाल 88 किलो मॉंग मोगर 110 किलो, उड़द |
| A59 | 31.0 s | A+vocab | 1 | चना दाल: wrong price 2200/6600 (expected rate 9200) [a Theek hai warned] | एक कीलो आटा, चालिस रुपए कीलो, पाँच कीलो आटा, एक सोपचत्टर रुपए, दो कीलो चीनी, छपन रुपए |
| A59 | 31.0 s | A-30s | 1 | गेहूँ: wrong quantity 15 (expected 5) [a Theek hai warned] | 1 किलो आटा 40 रुपए किलू 5 किलो आटा 175 रुपए 2 किलो चीनी 56 रुपए किलो |
| A59 | 31.0 s | A+vocab | 2 | चीनी: wrong quantity 2 (expected 3) [a Theek hai warned] | एक किलो आटा, चालिस रुपई किलो, पाँच किलो आटा, एक सो पाचपतर रुपई, दो किलो चीनी, चपन |
| A59 | 31.0 s | A+vocab | 3 | आटा: wrong price 3800/3800 (expected rate 4000) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A+vocab | 3 | आटा: wrong total 20000 (expected 17500) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A+vocab | 3 | चीनी: wrong quantity 2 (expected 3) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A+vocab | 3 | गेहूँ: wrong price 5600/28000 (expected rate 3400) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A+vocab | 3 | चना दाल: wrong price 8000/24000 (expected rate 9200) [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A+vocab | 3 | an extra line: नहीं [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A+vocab | 3 | an extra line: चीनी [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A+vocab | 3 | an extra line: चना दाल [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A+vocab | 3 | an extra line: नहीं [NO warning] | 1 किलो आटा, 40 रूपए किलो 5 किलो आटा, 175 रूपए 2 किलो चीनी, 56 रूपए किलो |
| A59 | 31.0 s | A-30s | 3 | चना दाल: wrong price 8000/24000 (expected rate 9200) [NO warning] | 1 किलो आटा 40 रुपए किलो 5 किलो आटा 175 रुपए 2 किलो चीनी 56 रुपए किलो |
| A59 | 31.0 s | A-30s | 3 | an extra line: चीनी [NO warning] | 1 किलो आटा 40 रुपए किलो 5 किलो आटा 175 रुपए 2 किलो चीनी 56 रुपए किलो |
| A59 | 31.0 s | A-30s | 3 | an extra line: अ चारी चनादाल प्यास को [NO warning] | 1 किलो आटा 40 रुपए किलो 5 किलो आटा 175 रुपए 2 किलो चीनी 56 रुपए किलो |
| A60 | 19.6 s | C2 | 3 | मदर डिलाइट तेल: wrong unit litre (expected liter) [a Theek hai warned] | मदर डिलाइट तेल 1 लीटर ₹150 हार्पिक 1 बड़ा ₹110 हार्पिक 1 छोटा ₹60 फिनाइल बॉटल 1 |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 1 | an extra line: FENA साबुन [a Theek hai warned] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 1 | an extra line: RIN साबुन [a Theek hai warned] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 1 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [a Theek hai warned] | … के लिए बटनातांस, ट्रापाना दिया चाहिए, रुपई किलो, [काटा] चना, एक किलो, अठ्यासी रुपई किलो, मोठ, एक … |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | विदिशा डिटर्जेंट: wrong total 13000 (expected 7000) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | चना दाल: wrong price null/7000 (expected rate 9200) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | मूंग दाल: wrong price 9200/18400 (expected rate 9600) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | बरबटी दाल: wrong price 9600/28800 (expected rate 8800) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | उड़द मोगर: wrong price 8800/8800 (expected rate 13000) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | मूंग मोगर: wrong product - heard "मुँँ मुगर" (Moong Daal) [a Theek hai warned] | … किलों उड़द मुगर 1 किलों, 130 रुपए किलों [मुँँ] मुगर एक किलो 110 रुपए किलो राजमा एक … |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | सैगी मूंग: wrong product - heard "सैगी मुँँँग" (Moong Daal) [a Theek hai warned] | … किलो हरा बटना एक किलो 56 रुपए किलो [सैगी] मुँँँग एक किलो 96 रुपए किलो पोपड दाल … |
| A61 | 76.1 s **(over 40 s)** | A-30s | 1 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [a Theek hai warned] | … किलो पोपड दाल एक किलो 72 रुपए किलो [काटा] चना एक किलो अठ्यासी रुपए किलो मोठ एक … |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | चना दाल: wrong price 13000/13000 (expected rate 9200) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | मूंग दाल: wrong price 9200/18400 (expected rate 9600) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | बरबटी दाल: wrong price 9600/28800 (expected rate 8800) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | उड़द मोगर: wrong price 8800/8800 (expected rate 13000) [a Theek hai warned] | तूअर दाल 5 किलो 150 रुपए किलो, डेटॉल साबुन सेट 1 175 रुपए, फेना साबुन 12 110 |
| A61 | 76.1 s **(over 40 s)** | A-30s | 2 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [a Theek hai warned] | … किलो पोपड दाल 1 किलो 72 रुपए किलो [काटा] चना 1 किलो 88 रुपए किलो मोठ 1 … |
| A61 | 76.1 s **(over 40 s)** | C2 | 2 | सैगी मूंग: wrong product - heard "सैगी मूंग" (Moong) [NO warning] | … ₹120 किलो हरा बटाना 1 किलो ₹56 किलो [सैगी] मूंग 1 किलो ₹96 किलो पोपट दाल 1 … |
| A61 | 76.1 s **(over 40 s)** | C2 | 2 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [NO warning] | … ₹96 किलो पोपट दाल 1 किलो ₹72 किलो [काटा] चना 1 किलो ₹88 किलो मोठ 1 किलो … |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | an extra line: DETOL साबुन सेट [NO warning] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | an extra line: FENA साबुन [NO warning] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | an extra line: गुड [a Theek hai warned] | TOOR DAL 5 KILO, 150 RUPAY KILO, DETOL साबुन सेट 1, 175 RUPAY, FENA साबुन 12, 110 |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | सैगी मूंग: wrong product - heard "सैगी मूंग" (Moong) [NO warning] | … किलो कुल्था दाना 1 किलो 120.00 रुपई किलो [सैगी] मूंग 1 किलो 96 रुपए किलो, पोपट दाल … |
| A61 | 76.1 s **(over 40 s)** | A+vocab | 3 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [NO warning] | … किलो, पोपट दाल 1 किलो 72 रुपए किलो, [काटा] चना 1 किलो 88 रुपए किलो, मोठ 1 … |
| A61 | 76.1 s **(over 40 s)** | C2 | 3 | सैगी मूंग: wrong product - heard "सैगी मूंग" (Moong) [NO warning] | … किलो हरा बटाना 1 किलो 56 रुपए किलो [सैगी] मूंग 1 किलो 96 रुपए किलो पोपट दाल … |
| A61 | 76.1 s **(over 40 s)** | C2 | 3 | काटा चना: wrong product - heard "काटा चना" (Kala Chana) [NO warning] | … किलो पोपट दाल 1 किलो 72 रुपए किलो [काटा] चना 1 किलो 88 रुपए किलो मोठ 1 … |
| A62 | 51.4 s **(over 40 s)** | A+vocab | 2 | उड़द मोगर: wrong price null/17000 (expected rate 13000) [NO warning] | Toor Daal 1 Kg, 150 Rs. Kg, Moong Daal 1 Kg, 96 Rs. Kg, बरबटी दाल 2 |
| A62 | 51.4 s **(over 40 s)** | A+vocab | 2 | चना दाल: wrong price null/9200 (expected rate 9200) [NO warning] | Toor Daal 1 Kg, 150 Rs. Kg, Moong Daal 1 Kg, 96 Rs. Kg, बरबटी दाल 2 |
| A62 | 51.4 s **(over 40 s)** | A+vocab | 2 | an extra line: Popat Dhal [NO warning] | Toor Daal 1 Kg, 150 Rs. Kg, Moong Daal 1 Kg, 96 Rs. Kg, बरबटी दाल 2 |
| A62 | 51.4 s **(over 40 s)** | A-30s | 3 | मोठ: wrong price 18000/18000 (expected rate 12000) [a Theek hai warned] | तूवर दाल 1 किलो 150 रुपए किलो मुँग दाल 1 किलो 96 रुपए किलो बरबटी दाल 2 |
| A09 | 4.0 s | A | 1 | जवारी: a price from another product (Jowar Atta) - heard "जवारी" [NO warning] | एक किलो बाजरा, एक किलो [जवारी] |
| A09 | 4.0 s | B | 1 | जवारी: a price from another product (Jowar Atta) - heard "1 किलो जवारी" [NO warning] | [1] किलो बाजरा, 1 किलो जवारी। |
| A09 | 4.0 s | C | 1 | जवारी: a price from another product (Jowar Atta) - heard "जवारी" [NO warning] | एक किलो बाजरा एक किलो [जवारी] |
| A09 | 4.0 s | D | 1 | जवारी: a price from another product (Jowar Atta) - heard "जवारी" [NO warning] | 1 किलो बाजरा, 1 किलो [जवारी।] |
| A10 | 3.8 s | C | 1 | फली दाने: a price from another product (Moongfali) - heard "फल्ली दाने" [a Theek hai warned] | एक किलो [फल्ली] दाने एक किलो दालिया |
| A10 | 3.8 s | D | 1 | फली दाने: a price from another product (Moongfali) - heard "फल्ली दाने" [a Theek hai warned] | 1 किलो [फल्ली] दाने, 1 किलो दलिया |
| A15 | 15.1 s | A | 1 | फली दाने: a price from another product (Moongfali) - heard "फली दाने" [a Theek hai warned] | 2 किलो चीनी, 2 किलो गुड, 1 किलो [फली] दाने, 1 किलो चना, 1 किलो मैदा |
| A15 | 15.1 s | C | 1 | फली दाने: a price from another product (Moongfali) - heard "फल्ली दाने" [a Theek hai warned] | दो किलो चीनी दो किलो गुड़ एक किलो [फल्ली] दाने एक किलो चना एक किलो मैदा |
| A15 | 15.1 s | D | 1 | फली दाने: a price from another product (Moongfali) - heard "फल्ली दाने" [a Theek hai warned] | 2 किलो चीनी, 2 किलो गुड़, 1 किलो [फल्ली] दाने, 1 किलो चना, 1 किलो मैदा। |
| A17 | 14.9 s | B | 1 | डेटॉल सेट: wrong total 18500 (expected 12500) - heard "एक डेटॉल सेट" [NO warning] | [एक] डेटॉल सेट ₹185 एक संतूर सेट ₹40 एक … |
| A19 | 16.4 s | B | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | 2 किलो [मूंग] दाल, 2 किलो चना दाल, 2 किलो उड़द … |
| A19 | 16.4 s | B | 1 | an extra line: चना दाल - heard "चना दाल" [NO warning] | 2 किलो मूंग दाल, 2 किलो [चना] दाल, 2 किलो उड़द मोगर, 1 किलो मूंग … |
| A19 | 16.4 s | C | 1 | लाल मिर्च: wrong unit packet (expected kg) - heard "लाल मिर्ची" [a Theek hai warned] | … बरबटी दाल एक किलो चना दाल एक किलो [लाल] मिर्ची पैकेट |
| A19 | 16.4 s | C | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | दो किलो [मूंग] दाल दो किलो चना दाल दो किलो उड़द … |
| A19 | 16.4 s | C | 1 | an extra line: चना दाल - heard "चना दाल" [NO warning] | दो किलो मूंग दाल दो किलो [चना] दाल दो किलो उड़द मुगर एक किलो मूंग … |
| A19 | 16.4 s | D | 1 | लाल मिर्च: wrong unit packet (expected kg) - heard "लाल मिर्ची" [a Theek hai warned] | … बरबटी दाल, 1 किलो चना दाल, 1 किलो [लाल] मिर्ची पैकेट। |
| A19 | 16.4 s | D | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | 2 किलो [मूंग] दाल, 2 किलो चना दाल, 2 किलो उड़द … |
| A19 | 16.4 s | D | 1 | an extra line: चना दाल - heard "चना दाल" [NO warning] | 2 किलो मूंग दाल, 2 किलो [चना] दाल, 2 किलो उड़द मोगर, 1 किलो मूंग … |
| A20 | 20.8 s | A | 1 | गरम मसाला: wrong unit packet (expected kg) - heard "गर्म मसाला" [NO warning] | 1 किलो [गर्म] मसाला पैकेट, 1 किलो धनिया मसाला पैकेट, 1 … |
| A20 | 20.8 s | A | 1 | खड़ी हल्दी: a price from another product (हल्दी गाठ) - heard "खड़ी हल्दी" [a Theek hai warned] | … मसाला पैकेट, 1 किलो हल्दी पैकेट, 1 किलो [खड़ी] हल्दी, 1 किलो दाने, 1 किलो चावल, 1 … |
| A20 | 20.8 s | B | 1 | गरम मसाला: a price from another product (Dhaniya Powder) - heard "धनिया मसाला" [NO warning] | 1 किलो गरम मसाला पैकेट, 1 किलो [धनिया] मसाला पैकेट, 1 किलो हल्दी पैकेट, 1 किलो … |
| A20 | 20.8 s | B | 1 | खड़ी हल्दी: a price from another product (हल्दी गाठ) - heard "खड़ी हल्दी" [a Theek hai warned] | … मसाला पैकेट, 1 किलो हल्दी पैकेट, 1 किलो [खड़ी] हल्दी, 1 किलो दाने, 1 किलो चावल, 1 … |
| A20 | 20.8 s | C | 1 | गरम मसाला: a price from another product (Dhaniya Powder) - heard "धनिया मसाला पैकेट" [NO warning] | एक किलो गरम मसाला पैकेट एक किलो [धनिया] मसाला पैकेट एक किलो हल्दी पैकेट एक किलो … |
| A20 | 20.8 s | C | 1 | खड़ी हल्दी: a price from another product (हल्दी गाठ) - heard "खड़ी हल्दी" [a Theek hai warned] | … मसाला पैकेट एक किलो हल्दी पैकेट एक किलो [खड़ी] हल्दी एक किलो दाने एक किलो चावल एक … |
| A20 | 20.8 s | D | 1 | गरम मसाला: a price from another product (Dhaniya Powder) - heard "धनिया मसाला पैकेट" [NO warning] | 1 किलो गरम मसाला पैकेट, 1 किलो [धनिया] मसाला पैकेट, 1 किलो हल्दी पैकेट, 1 किलो … |
| A20 | 20.8 s | D | 1 | खड़ी हल्दी: a price from another product (हल्दी गाठ) - heard "खड़ी हल्दी" [a Theek hai warned] | … मसाला पैकेट, 1 किलो हल्दी पैकेट, 1 किलो [खड़ी] हल्दी, 1 किलो दाने, 1 किलो चावल, 1 … |
| A24 | 16.6 s | B | 1 | उड़द मोगर: a price from another product (Moong Mogar) - heard "मूंग मोगर" [NO warning] | Toor Daal 2 किलो ₹150 किलो वाली, [मूंग] दाल 1 किलो ₹96 किलो, 2 किलो बरबटी … |
| A27 | 31.4 s | B | 1 | हार्पिक: a quantity 1 nobody said - heard "हार्पिक एक" [NO warning] | … डेटॉल हैंड वॉश एक ₹100, लाइज़ोल एक ₹110, [हार्पिक] एक ₹100, रिन साबुन एक सेट ₹100, फेना … |
| A27 | 31.4 s | C | 1 | हार्पिक: a quantity 1 nobody said - heard "हारपिक" [NO warning] | … हैंडवॉश एक 100 रुपए, लाइजॉल एक 110 रुपए, [हारपिक] एक 100 रुपए, रिन साबुन एक सेट 100 … |
| A27 | 31.4 s | D | 1 | हार्पिक: a quantity 1 nobody said - heard "हारपिक" [NO warning] | डेटॉल साबुन सेट एक ₹185, संतूर साबुन सेट एक ₹140, डेटॉल हैंड वॉश एक ₹100, लाइज़ोल एक |
| A32 | 22.3 s | A | 1 | मोठ: wrong price null/13200 (expected rate 13000) - heard "मोठ" [NO warning] | करने के लिए [मोठ] एक किल 132 काबुली चनट टीज रुपए थील … |
| A32 | 22.3 s | A | 1 | चना: wrong product - heard "टिशू पेपर" (Tissue Paper) [NO warning] | … हम आपसे 340 रुपे कि आप सॉफ्ट किस [टिश] को या रेटा किसी इंडिया पूर्ण इज दॉपर … |
| A32 | 22.3 s | B | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | … वाला ₹100 किलो, आटा 1 किलो ₹40 किलो, [मूंग] दाल 1 किलो 88, चना 1 किलो 88 |
| A32 | 22.3 s | C | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | … रुपये किलो आटा एक किलो 40 रुपये किलो [मूंग] दाल एक किलो 88 चना एक किलो 88 |
| A32 | 22.3 s | D | 1 | an extra line: मूंग दाल - heard "मूंग दाल" [NO warning] | … वाला ₹100 किलो, आटा 1 किलो ₹40 किलो, [मूंग] दाल 1 किलो 88, चना 1 किलो 88 |
| A33 | 20.3 s | A | 1 | फल्ली दाना: wrong price 14000/14000 (expected rate 15000) - heard "दौड" [a Theek hai warned] | … दान 140 किलो कि फलीद कान 150 किलो [दौड़] 140 रुपई किलो खंड दालू 80 किलो की … |
| A33 | 20.3 s | A | 1 | तुअर दाल: wrong price 12000/12000 (expected rate 14000) - heard "की फुंट आने" [a Theek hai warned] | … दौड़ 140 रुपई किलो खंड दालू 80 किलो [की] फुंट आने 120 रुपई किलो डाली 120 रुपई … |
| A33 | 20.3 s | A | 1 | दालिया: wrong price 15000/15000 (expected rate 12000) - heard "कि फलीद कान" [a Theek hai warned] | अजय को कवली दान 140 [किलो] कि फलीद कान 150 किलो दौड़ 140 रुपई … |
| A34 | 11.4 s | A | 1 | मूंग दाल: wrong quantity 0.25 (expected 1.25) - heard "मूंग दाल" [a Theek hai warned] | पावा किलो [मूंग] दाल छैननो रुपए किलो तेल एक पैकेट एक … |
| A34 | 11.4 s | B | 1 | मूंग दाल: wrong quantity 0.5 (expected 1.25) - heard "मूंग दाल" [a Theek hai warned] | 1/2 किलो [मूंग] दाल ₹96 किलो। तेल एक पैकेट 140 वाला। … |
| A34 | 11.4 s | C | 1 | बंसल तेल: wrong unit litre (expected liter) - heard "तेल बंसल" [NO warning] | सवा किलो मूंग दाल छानबे रुपये किलो [तेल] एक पैकेट 140 वाला तेल एक लीटर 150 … |
| A34 | 11.4 s | D | 1 | बंसल तेल: wrong unit litre (expected liter) - heard "तेल बंसल" [NO warning] | 1/2 किलो मूंग दाल ₹96 किलो। [तेल] एक पैकेट 140 वाला। तेल 1 लीटर ₹150 … |
| A36 | 10.4 s | C | 1 | बंसल तेल: wrong unit litre (expected liter) - heard "तेल" [a Theek hai warned] | आधा किलो मैदा पैकेट बाईस रुपए एक बंसल [तेल] पैकेट एक सौ चालीस रुपए एक बंसल एक … |
| A36 | 10.4 s | D | 1 | बंसल तेल: wrong unit litre (expected liter) - heard "तेल" [a Theek hai warned] | आधा किलो मैदा पैकेट 22 रुपए, एक बंसल [तेल] पैकेट 140 रुपए, एक बंसल एक लीटर 150 … |
| A39 | 16.3 s | C | 1 | बंसल तेल: wrong unit litre (expected liter) - heard "बंसल तेल पैकेट" [a Theek hai warned] | … आटा रबा एक किलो मैदा एक किलो एक [बंसल] तेल पैकेट एक लीटर 150 रुपये एक बंसल … |
| A39 | 16.3 s | C | 1 | बंसल तेल: wrong unit litre (expected liter) - heard "बंसल तेल पैकेट" [a Theek hai warned] | … आटा रबा एक किलो मैदा एक किलो एक [बंसल] तेल पैकेट एक लीटर 150 रुपये एक बंसल … |
| A39 | 16.3 s | D | 1 | बंसल तेल: wrong unit litre (expected liter) - heard "बंसल तेल पैकेट" [a Theek hai warned] | … आटा रवा 1 किलो मैदा 1 किलो 1 [बंसल] तेल पैकेट 1 लीटर 150 रुपए 1 बंसल … |
| A39 | 16.3 s | D | 1 | बंसल तेल: wrong unit litre (expected liter) - heard "बंसल तेल पैकेट" [a Theek hai warned] | … आटा रवा 1 किलो मैदा 1 किलो 1 [बंसल] तेल पैकेट 1 लीटर 150 रुपए 1 बंसल … |
| A40 | 20.0 s | A | 1 | गेहूं: wrong total 3400 (expected 34000) - heard "गेहु" [NO warning] | मैं कि यह शो 10 किलो 340 रुपए [गेहु] 10 किलो 34 रुपए किर्लाला अ कि पंशल … |
| A47 | 19.5 s | B | 1 | फुटाना: wrong price 10400/10400 (expected rate 11000) - heard "फुटाने" [NO warning] | [फुटाने] ₹104 किलो, लाइज़ोल ₹110, गुड़ ₹98, चावल ₹98। |
| A49 | 8.2 s | C | 1 | ग्राउंडनट ऑयल: a quantity 1 nobody said - heard "ग्राउन्डनट आयल" [a Theek hai warned] | रिपाइन्ड सोयाबीन आयल एकसौ सत्तर रुपये [ग्राउन्डनट] आयल एक दोसौ रुपये |
| A50 | 9.5 s | B | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती 1 किलो ₹500 [टूथब्रश] एक ₹35 टूथब्रश एक ₹60 |
| A50 | 9.5 s | B | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती 1 किलो ₹500 [टूथब्रश] एक ₹35 टूथब्रश एक ₹60 |
| A50 | 9.5 s | C | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चायपत्ती एक किलो 500 रुपये शायद [टूथब्रश] एक 35 रुपये टूथब्रश एक 60 रुपये |
| A50 | 9.5 s | C | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चायपत्ती एक किलो 500 रुपये शायद [टूथब्रश] एक 35 रुपये टूथब्रश एक 60 रुपये |
| A50 | 9.5 s | D | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती 1 किलो ₹500 [टूथब्रश] एक ₹35 टूथब्रश एक ₹60 |
| A50 | 9.5 s | D | 1 | टूथ ब्रश: wrong product - heard "टूथब्रश" (Toothbrush) [NO warning] | स्वाद चाय पत्ती 1 किलो ₹500 [टूथब्रश] एक ₹35 टूथब्रश एक ₹60 |
| A51 | 27.9 s | A | 1 | तुअर दाल: wrong price 9000/9000 (expected rate 15000) - heard "तूवर दाल 1 किलो" [a Theek hai warned] | [तूवर] दाल 1 किलो 10.15 किलो मसूर दाल 1 … |
| A52 | 23.3 s | A | 2 | फुटाने: wrong price 9000/9000 (expected rate 12000) - heard "फुटाने" [NO warning] | पतला पोहा एक किलो साठ रुपए किलो [फुटाने] एक किलो एकसू बीस रुपए किलो दालिया एक … |
| A52 | 23.3 s | A | 2 | दालिया: wrong price 32000/32000 (expected rate 12000) - heard "दालिया" [NO warning] | … किलो फुटाने एक किलो एकसू बीस रुपए किलो [दालिया] एक किलो एकसू बीस रुपए किलो पानी एक … |
| A52 | 23.3 s | A | 2 | रवा: wrong price 4000/4000 (expected rate 4400) - heard "रवा" [NO warning] | … किलो पानी एक किलो एकसू बीस रुपए किलो [रवा] एक किलो एकसू बीस रुपए किलो |
| A52 | 23.3 s | A | 2 | an extra line: एकसू - heard "एकसू" [NO warning] | पतला पोहा [एक] किलो साठ रुपए किलो फुटाने एक किलो एकसू … |
| A52 | 23.3 s | A | 2 | an extra line: एकसू - heard "एकसू" [a Theek hai warned] | पतला पोहा [एक] किलो साठ रुपए किलो फुटाने एक किलो एकसू … |
| A52 | 23.3 s | A | 2 | an extra line: एकसू - heard "एकसू" [a Theek hai warned] | पतला पोहा [एक] किलो साठ रुपए किलो फुटाने एक किलो एकसू … |
| A52 | 23.3 s | A | 2 | an extra line: एकसू - heard "एकसू" [a Theek hai warned] | पतला पोहा [एक] किलो साठ रुपए किलो फुटाने एक किलो एकसू … |
| A52 | 23.3 s | A | 2 | an extra line: पानी - heard "पानी" [NO warning] | … किलो दालिया एक किलो एकसू बीस रुपए किलो [पानी] एक किलो एकसू बीस रुपए किलो रवा एक … |
| A53 | 29.0 s | A | 2 | राजमा: wrong price 3000/3000 (expected rate 13000) - heard "राजमा एकसो" [a Theek hai warned] | [राजमा] एक किलो एकसो तीस रुपई किलो सोथा एक … |
| A54 | 30.8 s | A | 3 | an extra line: फटका - heard "फटका" [a Theek hai warned] | कर दो ही तुअर दाल 1 किलो [फटका] 150 रुपए किलो मूँग दाल 1 किलो 96.org … |
| A54 | 30.8 s | A | 3 | an extra line: चनादाल - heard "चनादाल" [a Theek hai warned] | कर दो ही तुअर [दाल] 1 किलो फटका 150 रुपए किलो मूँग दाल … |
| A54 | 30.8 s | B | 3 | an extra line: फटका - heard "फटका" [a Theek hai warned] | Toor Daal 1 किलो, [फटका] ₹150 किलो। Moong Daal 1 किलो, ₹96 किलो। … |
| A55 | 31.4 s | A | 1 | an extra line: मौंघडाल - heard "मौंघडाल" [a Theek hai warned] | 2- [मौंघडाल] 1 किलो ऊडद मोहग़ एक किलो मउन मोहग़ … |
| A55 | 31.4 s | A | 1 | an extra line: मउन मोहग़ - heard "मउन मोहग़" [a Theek hai warned] | 2- मौंघडाल 1 किलो ऊडद मोहग़ एक किलो [मउन] मोहग़ एक किलो आरा बताना 1 किलो मोठ … |
| A55 | 31.4 s | A | 2 | an extra line: मौकर - heard "मौकर" [NO warning] | … की मूं का लार्म एक-किलोड़ मोगणी के लड़न [मौकर] एक किलो घृत बटानाओं अ कि का लो … |
| A55 | 31.4 s | C | 2 | फॉर्च्यून तेल: wrong unit litre (expected liter) - heard "फॉर्चून तेल" [a Theek hai warned] | … एक किलो, बंसल तेल एक लीटर एक पैकेट, [फॉर्चून] तेल एक लीटर, मूंग दाल एक किलो, उड़द … |
| A55 | 31.4 s | D | 2 | फॉर्च्यून तेल: wrong unit litre (expected liter) - heard "फॉर्चून तेल" [a Theek hai warned] | चना दाल 1 किलो, तुअर दाल 1 किलो, बंसल तेल 1 लीटर एक पैकेट, फॉर्च्यून तेल 1 |
| A55 | 31.4 s | A | 3 | उड़द मोगर: a price from another product (Moong Mogar) - heard "मुगर 1 किलो" [a Theek hai warned] | … लिटर 1 पैकेट फॉर्चुएं तेल एक लीटर काम [मुगर] थए कि लोगोड मोगर 1 किलो मुगर 1 … |
| A55 | 31.4 s | A | 3 | an extra line: चनडाल 1 किलो - heard "चनडाल 1 किलो" [a Theek hai warned] | [चनडाल] 1 किलो तूर दाल एक किलो बनसल तेल … |
| A55 | 31.4 s | C | 3 | an extra line: बंसल तेल - heard "बंसल तेल" [NO warning] | चना दाल 1 किलो तूर दाल 1 किलो [बंसल] तेल 1 लीटर 1 पैकेट फॉर्चून तेल 1 … |
| A55 | 31.4 s | D | 3 | an extra line: बंसल तेल - heard "बंसल तेल" [NO warning] | चना दाल 1 किलो, तुअर दाल 1 किलो, [बंसल] तेल 1 लीटर एक पैकेट, फॉर्च्यून तेल 1 … |
| A57 | 49.3 s **(over 40 s)** | A | 1 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "फेना डिटरजेंट" [NO warning] | … पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, [फेना] साबुन 10 वाली 5 पीस फेना डिटरजेंट 1 … |
| A57 | 49.3 s **(over 40 s)** | A | 1 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "सर्फेक्सल" [NO warning] | … 75 रुपए वुश डिटरजेंट 1 पैकेट 20 रुपए [सर्फेक्सल] 1 किलो पैकेट 140 रुपए पतनजली कुकोनट विस्किट … |
| A57 | 49.3 s **(over 40 s)** | B | 1 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "सर्फ एक्सेल" [NO warning] | … किलो पैकेट ₹75, वुश डिटर्जेंट एक पैकेट ₹20, [सर्फ] एक्सेल एक किलो पैकेट ₹140, पतंजलि कोकोनट बिस्किट … |
| A57 | 49.3 s **(over 40 s)** | C | 1 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "फेना डिटर्जेंट" [a Theek hai warned] | … पैकेट बंसल तेल पाउच 1 पैकेट 140 रुपए [फेना] साबुन 10 वाली 5 पीस फेना डिटर्जेंट 1 … |
| A57 | 49.3 s **(over 40 s)** | C | 1 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "सर्फ एक्सेल" [a Theek hai warned] | … 75 रुपए वुश डिटर्जेंट 1 पैकेट 20 रुपए [सर्फ] एक्सेल 1 किलो पैकेट 140 रुपए पतंजलि कोकोनट … |
| A57 | 49.3 s **(over 40 s)** | D | 1 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "फेना डिटर्जेंट" [NO warning] | … पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, [फेना] साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक … |
| A57 | 49.3 s **(over 40 s)** | D | 1 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "सर्फ एक्सेल" [NO warning] | … किलो पैकेट ₹75, वुश डिटर्जेंट एक पैकेट ₹20, [सर्फ] एक्सेल एक किलो पैकेट ₹140, पतंजलि कोकोनट बिस्किट … |
| A57 | 49.3 s **(over 40 s)** | B | 2 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "फेना डिटर्जेंट" [NO warning] | … पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, [फेना] साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक … |
| A57 | 49.3 s **(over 40 s)** | B | 2 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "सर्फ एक्सेल" [NO warning] | … किलो पैकेट ₹75, वुश डिटर्जेंट एक पैकेट ₹20, [सर्फ] एक्सेल एक किलो पैकेट ₹140, पतंजलि कोकोनट बिस्किट … |
| A57 | 49.3 s **(over 40 s)** | C | 2 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "fena detergent" [a Theek hai warned] | … packet bansal tel pouch ek packet 140 rupaye [fena] sabun 10 wali 5 pis fena detergent 1 … |
| A57 | 49.3 s **(over 40 s)** | C | 2 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "sarfexcel" [a Theek hai warned] | … 75 rupaye wush detergent ek packet 20 rupaye [sarfexcel] 1 kilo packet 140 rupaye patanjali coconut biscuit … |
| A57 | 49.3 s **(over 40 s)** | D | 2 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "fena detergent" [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक |
| A57 | 49.3 s **(over 40 s)** | D | 2 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "sarfexcel" [NO warning] | रिन साबुन 10 वाली पांच पीस, पारले जी बिस्किट 30 वाला पांच पैकेट, बंसल तेल पाउच एक |
| A57 | 49.3 s **(over 40 s)** | B | 3 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "फेना डिटर्जेंट" [NO warning] | … पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, [फेना] साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक … |
| A57 | 49.3 s **(over 40 s)** | B | 3 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "सर्फ एक्सेल" [NO warning] | … किलो पैकेट ₹75, वुश डिटर्जेंट एक पैकेट ₹20, [सर्फ] एक्सेल एक किलो पैकेट ₹140, पतंजलि कोकोनट बिस्किट … |
| A57 | 49.3 s **(over 40 s)** | C | 3 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "फेना डिटर्जेंट" [NO warning] | … पैकेट, बंसल तेल पाउच 1 पैकेट 140 रुपए, [फेना] साबुन 10 वाली 5 पीस, फेना डिटर्जेंट 1 … |
| A57 | 49.3 s **(over 40 s)** | C | 3 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "सर्फ एक्सेल" [NO warning] | … 75 रुपए, वुश डिटर्जेंट 1 पैकेट 20 रुपए, [सर्फ] एक्सेल 1 किलो पैकेट 140 रुपए, पतंजलि कोकोनट … |
| A57 | 49.3 s **(over 40 s)** | D | 3 | फेना डिटर्जेंट: wrong unit kg (expected packet) - heard "फेना डिटर्जेंट" [NO warning] | … पांच पैकेट, बंसल तेल पाउच एक पैकेट ₹140, [फेना] साबुन 10 वाली पांच पीस, फेना डिटर्जेंट एक … |
| A57 | 49.3 s **(over 40 s)** | D | 3 | सर्फ एक्सेल: wrong unit kg (expected packet) - heard "सर्फ एक्सेल" [NO warning] | … किलो पैकेट ₹75, वुश डिटर्जेंट एक पैकेट ₹20, [सर्फ] एक्सेल एक किलो पैकेट ₹140, पतंजलि कोकोनट बिस्किट … |
| A58 | 31.4 s | A | 1 | मूंग दाल: wrong quantity 1.96 (expected 1) - heard "मुंग दाल रूपे" [a Theek hai warned] | मुँग दाल 1.96 किलो रूपे, चना दाल 1 किलो 92 किलो, बरबटी दाल 88 किलो मुँग मोगर |
| A58 | 31.4 s | A | 1 | बरबटी दाल: wrong quantity 88 (expected 1) - heard "बरबटी दाल" [a Theek hai warned] | … किलो रूपे, चना दाल 1 किलो 92 किलो, [बरबटी] दाल 88 किलो मुँग मोगर 110 किलो, उड़द … |
| A58 | 31.4 s | A | 1 | मूंग मोगर: wrong quantity 110 (expected 1) - heard "मुंग मोगर" [a Theek hai warned] | मुँग दाल 1.96 किलो रूपे, चना दाल 1 किलो 92 किलो, बरबटी दाल 88 किलो मुँग मोगर |
| A58 | 31.4 s | A | 1 | उड़द मोगर: wrong quantity 130 (expected 1) - heard "उडद मोगर" [a Theek hai warned] | मुँग दाल 1.96 किलो रूपे, चना दाल 1 किलो 92 किलो, बरबटी दाल 88 किलो मुँग मोगर |
| A58 | 31.4 s | A | 1 | डालडा: wrong quantity 160 (expected 1) - heard "डालडा कर" [a Theek hai warned] | … किलो, उड़द मोगर 130 किलो, फुटाने 120 किलो, [डालडा] 160 किलो कर दो |
| A59 | 31.0 s | A | 1 | आटा: wrong price 3800/3800 (expected rate 4000) - heard "एक किलो आटा" [a Theek hai warned] | ओके [एक] किलो आटा ए चारेसदी किलो पांच किलो आटा … |
| A59 | 31.0 s | A | 1 | an extra line: जनडाल - heard "जनडाल" [a Theek hai warned] | … किलो गहू चोती से रुपए किलो 14 किलों [जनडाल] 72 रुपए किलो नहीं नहीं तीन लूप रूप … |
| A59 | 31.0 s | A | 1 | an extra line: 15 किलो गहू - heard "15 किलो गहू" [a Theek hai warned] | … नहीं तीन किलो चीनी 56 रुपए किलो और [15] किलो गहू चोती से रुपए किलो 14 किलों … |
| A59 | 31.0 s | B | 1 | चना दाल: wrong price 8000/24000 (expected rate 9200) - heard "चना दाल" [NO warning] | … किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो [चना] दाल ₹92 किलो, नहीं नहीं 3 किलो करो … |
| A59 | 31.0 s | B | 1 | an extra line: चीनी - heard "चीनी" [NO warning] | … ₹40 किलो, 5 किलो आटा ₹175, 2 किलो [चीनी] ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 … |
| A59 | 31.0 s | B | 1 | an extra line: चना दाल - heard "चना दाल" [NO warning] | … किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो [चना] दाल ₹92 किलो, नहीं नहीं 3 किलो करो … |
| A59 | 31.0 s | A | 2 | चना दाल: wrong price 8000/24000 (expected rate 9200) - heard "3 किलो करो उसको चना दालो" [a Theek hai warned] | … किलो चीनी 56 रुपय किलो, पाँच किलो गेहु [34] रुपय किलो, चार किलो चना दाल 92 रुपय … |
| A59 | 31.0 s | A | 2 | an extra line: चना दाल रुपय - heard "चना दाल रुपय" [NO warning] | … पाँच किलो गेहु 34 रुपय किलो, चार किलो [चना] दाल 92 रुपय किलो, नहीं नहीं 3 किलो … |
| A59 | 31.0 s | A | 2 | an extra line: पाँच किलो गेहु 34 रुपय किलो - heard "पाँच किलो गेहु 34 रुपय किलो" [a Theek hai warned] | एक किलो आटा 40 रुपय किलो, [पाँच] किलो आटा 175 रुपय, दो किलो चीनी 56 … |
| A59 | 31.0 s | B | 2 | चना दाल: wrong price 8000/24000 (expected rate 9200) - heard "चना दाल" [NO warning] | … किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो [चना] दाल ₹92 किलो, नहीं नहीं 3 किलो करो … |
| A59 | 31.0 s | B | 2 | an extra line: चीनी - heard "चीनी" [NO warning] | … ₹40 किलो, 5 किलो आटा ₹175, 2 किलो [चीनी] ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 … |
| A59 | 31.0 s | B | 2 | an extra line: चना दाल - heard "चना दाल" [NO warning] | … किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो [चना] दाल ₹92 किलो, नहीं नहीं 3 किलो करो … |
| A59 | 31.0 s | B | 3 | चना दाल: wrong price 8000/24000 (expected rate 9200) - heard "चना दाल" [NO warning] | … किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो [चना] दाल ₹92 किलो, नहीं नहीं 3 किलो करो … |
| A59 | 31.0 s | B | 3 | an extra line: चीनी - heard "चीनी" [NO warning] | … ₹40 किलो, 5 किलो आटा ₹175, 2 किलो [चीनी] ₹56 किलो, नहीं नहीं 3 किलो चीनी ₹56 … |
| A59 | 31.0 s | B | 3 | an extra line: चना दाल - heard "चना दाल" [NO warning] | … किलो, 5 किलो गेहूं ₹34 किलो, 4 किलो [चना] दाल ₹92 किलो, नहीं नहीं 3 किलो करो … |
| A60 | 19.6 s | C | 1 | मदर डिलाइट तेल: wrong unit litre (expected liter) - heard "मदर डिलाइट तेल" [a Theek hai warned] | [मदर] डिलाइट तेल 1 लीटर ₹150 हर्पिक एक बड़ा … |
| A60 | 19.6 s | C | 1 | फिनाइल: wrong unit litre (expected bottle) - heard "फिनायल बॉटल" [a Theek hai warned] | … हर्पिक एक बड़ा ₹110 हर्पिक एक छोटा ₹60 [फिनायल] बॉटल 1 लीटर ₹60 |
| A60 | 19.6 s | D | 1 | फिनाइल: wrong unit litre (expected bottle) - heard "फिनायल बॉटल" [NO warning] | मदर डिलाईट तेल (1L) ₹150, हार्पिक एक बड़ा ₹110, हार्पिक एक छोटा ₹60, फिनाइल बोतल एक ₹60 |
| A60 | 19.6 s | C | 2 | मदर डिलाइट तेल: wrong unit litre (expected liter) - heard "मदर डीलाइट तेल" [a Theek hai warned] | [मदर] डीलाइट तेल एक लीटर 150 रुपए हारपिक एक … |
| A60 | 19.6 s | C | 3 | मदर डिलाइट तेल: wrong unit litre (expected liter) - heard "Mother Delight tel" [a Theek hai warned] | [Mother] Delight tel 1 litre 150 rupaye, Harpic ek … |

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
