# 23 — Acceptance: the owner's recorded orders, the release gate, the two-phone session

**Owner decision, 30 Oct 2026 (`KB-364`).** The owner records about 50 real orders in his own voice and writes the bill each one must give.
They become a PERMANENT, automatic regression test: no release without a pass. A final two-phone session (below) is the manual half.

## 1. The rule (the gate)

| | |
|---|---|
| **Hard stop** | **0 wrong lines.** A *wrong* line is a confident number or product that is not what was said: a wrong quantity, unit, product or price, a price where "Price needed" was expected, or a line nobody asked for. |
| **Quality** | **At least 90% of the orders exact** — every line right, "Not added" pieces as expected, no more Theek hai checks than the owner accepted for that order. |
| **No surprises** | **No order shows more Theek hai checks than the owner wrote for it** (usually 0). Fewer is fine. |
| **Not wrong, only inexact** | The app did not guess: a missing line, a price left as "Price needed" where a price was said, a custom line instead of a catalog match. Costs "exact", never "wrong". |

## 2. What is stored where

| | Where | In git? |
|---|---|---|
| The recordings (his voice) | `eval/acceptance/audio/A01.webm …` | **No** (git-ignored; stays on his PC — back it up with his other files) |
| The sheet: his words + the expected bill for each order | `eval/acceptance/sheet.txt` → `orders.json` | Yes |
| What Whisper heard, frozen | `orders.json` (`transcript`) | Yes |
| What Gemini answered, frozen | `eval/acceptance/recorded.json` | Yes |

## 3. Two tiers

- **Tier A — automatic, in `npm test`** (`eval/acceptance/gate.test.ts`): offline, free, deterministic. The frozen Whisper text goes through the shipped resolver; Gemini's recorded answer is replayed where Layer 2 is asked; the result is compared with the expected bill. A wrong line fails at any time. Once the set is **locked** (≥ 40 orders, a passing live run) the full gate is enforced.
- **Tier B — live, before every release** (`npm run accept:live`): each recording goes through the real `/voice` (Groq Whisper) and the real Gemini, exactly as the app does it. Prints how far Whisper's text drifted from the frozen one. **Declares its calls first** (one Groq call per recording, at most `--max-gemini` Gemini calls, default 30) and shares production's quota (D99 item 11).

## 4. Coverage checklist — what to record (50 orders)

Say each order in your own words, the way a customer's order is really said. Nothing is scripted. The phone shows the same list.

| # | Group | How many | What to cover |
|---|---|---|---|
| A01–A06 | Short, with prices | 6 | 1–2 items, you say the price: "2 किलो चीनी 45 रुपए किलो", "5 किलो चावल 225 रुपए" |
| A07–A12 | Short, no prices | 6 | 1–2 items, no price: the shop's own price is used |
| A13–A17 | Long, with prices | 5 | 4–6 items, each with its price — some with a pause between items, some in one breath |
| A18–A22 | Long, no prices | 5 | 4–6 items, no prices — name first ("दाल एक किलो चीनी दो किलो") and quantity first ("एक किलो दाल दो किलो चीनी") |
| A23–A27 | Mixed | 5 | priced and price-less in one breath: "चीनी दो किलो चावल 90 रुपए दाल एक किलो 96 रुपए किलो" |
| A28–A33 | Prices in Hindi words | 6 | अठासी, छियानवे, पचपन, एक सो दस, दो सो अठासी, डेढ़ सौ … |
| A34–A38 | Units and fractions | 5 | ग्राम, लीटर, पैकेट, आधा, डेढ़, सवा, ढाई … |
| A39–A41 | Repeated or corrected | 3 | the same item twice; a quick correction in the middle |
| A42–A46 | Unclear or unusual names | 5 | a brand, a mumbled product, a name that is not in the catalog |
| A47–A50 | A price you cannot say clearly | 4 | trail off or mumble the price — the bill must show **Price needed**, never a guessed number |

## 5. The steps

**On the draft (phone)**
1. Open `<draft URL>/?session=1` (the recorder exists **only** on a draft built for this; a production build has none — §7).
2. Allow the microphone. For each A-number: **Record A01** → say the order → **Stop A01**. **Play** to check it; **Re-record** if it is bad. Quiet room first, then a few in the shop's real noise.
3. When done: **Download session file** (one `.json`, a few MB). Send it to the PC.

**On the PC**
```bash
npm run accept:import                                  # once: creates eval/acceptance/sheet.txt, one blank block per order
npm run accept:import -- C:\path\kb-acceptance-2026-10-30.json   # the phone's file: audio to eval/acceptance/audio/
# fill in eval/acceptance/sheet.txt (§6), then
npm run accept:build                                   # sheet.txt -> orders.json (a sheet error stops it and says which block)
npm run accept:live -- --freeze                        # live run; freezes Whisper's text + Gemini's answers; locks the set when it passes with >= 40 orders
npm test                                               # tier A is now part of every VERIFY
```
`accept:import` can be run again after re-recording: the audio is replaced, and **a filled-in sheet block is never touched**.

## 6. Writing the expected bill (the sheet)

One block per order, the same A-number as on the phone. Plain words — the app's own matcher turns a name into a product, so write the name as you would say it.

```
## A01 short-priced
said: दो किलो चीनी पैंतालीस रुपए किलो
- 2 kg चीनी @45
checks: 0

## A25 mixed
said: चीनी दो किलो चावल नब्बे रुपए दाल एक किलो छियानवे रुपए किलो
- 2 kg चीनी
- चावल =90
- 1 kg दाल @96
checks: 0

## A48 unreadable-price
said: एक किलो मूंग दाल चैन रुपए किलो
- 1 kg मूंग दाल price needed
checks: 0
```

| Write | Means |
|---|---|
| `- 2 kg चीनी @45` | 2 kg at a **rate** of ₹45 a kg you said |
| `- 5 kg चावल =225` | 5 kg for a **total** of ₹225 you said |
| `- चावल =90` | a total with no quantity |
| `- 1 kg मूंग दाल` | nothing said about price: the **shop's own price** |
| `- 1 kg बेसन price needed` | the price was not clear: the bill must show **Price needed** |
| `- NOT ADDED` (or `NOT ADDED 2`) | a piece nothing can read — it must show as "Not added" |
| `checks: N` | how many Theek hai checks you accept for this order (usually 0) |

Units: `kg gm liter ml piece packet dozen` (or किलो, ग्राम, लीटर, पैकेट …). Amounts are rupees, `45` or `45.50`. A block with nothing filled in is skipped.

## 7. The recorder stays out of production

The recorder is built **only** when a draft is built with `VITE_ACCEPTANCE=1`. In every other build the page and its code are removed at build time. Before **every release marker**:
```bash
npm run build
npm run check:recorder        # must print: "no acceptance recorder in dist/ - safe for production"
```
(`npm run check:recorder -- --present` is the opposite check, for the draft.) The production bundle served after the 30 Oct release is checked the same way, and the result is recorded in the tracker.

## 8. Before every release (checklist)

1. `npm test`, `npm run test:e2e`, `npm run test:rls`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm audit --omit=dev`, `npm run bench:numbers`, `npm run eval:real`.
2. `npm run smoke:voice` (Layer-2 wiring, 7 calls).
3. `npm run accept:live` — **PASSED** (0 wrong, ≥ 90% exact, no unexpected check).
4. `npm run check:recorder` on the production build.
5. The two-phone session (§9) when the release touches sync, bill numbers, history, cancel, the catalog, or the screen.
6. The owner's draft check, then his written approval of the exact commit; only then the `[deploy]` marker.

## 9. The two-phone session (about 20 minutes)

**Setup.** Phone A and phone B, **same Google account / same shop**, both on the draft URL, both online. Settings shows the **same build id** on both. Tick each step; write down any failure with a screenshot.

| # | Step | Expected |
|---|---|---|
| 1 | Sign in on A, then on B. | Same shop name; same catalog on both. |
| 2 | On A: make a bill by voice (2 items), **Bill Banao**. | A receipt with a bill number, call it **N**. |
| 3 | On B: open **History**; wait up to a minute. | Bill **N** is there with the same lines and total; its receipt opens. |
| 4 | On B: make a bill. | Number **N+1** — never the same number as A's. |
| 5 | On A: **History**. | B's bill **N+1** appears. |
| 6 | Put B in **airplane mode**. On B make a bill; on A make another. | B shows **Offline**, still saves its bill (the sync details say "1 bill hasn't reached the server yet"); A's bill is saved normally. |
| 7 | Turn B's network back on. | Within a minute both bills are on both phones; **all numbers distinct**, none missing. |
| 8 | On A: **cancel** B's bill (give a reason). | B shows it as **Cancelled** in History after the next sync. |
| 9 | On A: change one product's price (e.g. Chini ₹45 → ₹46). On B, after a minute, bill that product with no price said. | B uses **₹46**. Put it back afterwards. |
| 10 | On B: switch the screen language to Hindi. | Only B changes; A stays as it was. |
| 11 | On A: start a bill, add an item, **reload** the page. | The half-built bill comes back. |
| 12 | On each phone: open a receipt and share/print it. | The receipt is correct (shop name, lines, total, number). |
| 13 | Orders that matter: say your 4:37 PM order, the price-less sentence and a mixed order on **both** phones. | The same bill on both; no extra Theek hai beyond what you expect. |
| 14 | On one phone: add to the home screen and open it from there. | Opens like an app; the microphone still works. |

Result goes into `docs/10-TRACKER.md` (date, build id, which steps passed, anything that did not).
