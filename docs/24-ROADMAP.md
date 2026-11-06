# 24 — Roadmap

**Last updated:** 7 Nov 2026 (rev 15) · **Status:** Living plan - every item's status is updated when its work lands
**Source of truth for:** the ORDER and the STATUS of work. The description of each deferred idea lives in `12-PARKED.md` (by id); a ticket's detail lives in `06-FEATURE-TICKETS.md`; the decisions are `07-DECISIONS.md` D100. The current state of the world is `10-TRACKER.md` "Right now".

**Status values:** `todo` · `in progress` · `done` (with date and commit). **D33** = the item touches numbers, money, sync, RLS or migrations, so it runs on the strongest model (`07` D33). **Owner** = only the owner can do it.

---

## a. Why

On 31 Oct 2026 the owner studied a competitor: **Ezy Parchi** (Play Store `com.parchi.parchi`, Android, free, 4.8 stars on about 690 reviews, 10K+ installs). His head-to-head test used the same 10-item dal order (about 40 s, one tap). Ezy billed all 10 lines correctly (Rs 1,672). KiranaBill did not. *(All of this is owner-reported; the agent has not re-verified it.)*

The cause is visible in our "Heard" text. Whisper (`whisper-large-v3` on Groq) transcribed the first seven items correctly, then **restarted and repeated the order with garbled number words** (डेड़सो, नबे, छैननो ...), so lines were duplicated or showed "Price needed". The safety held: 9 checks pending, no silent wrong bill, total shown Rs 2,148. Long audio (over about 30 s) is a Whisper failure mode, and our provider sends the whole recording with no length handling.

**The goal: Ezy-level accuracy WITH our never-silently-wrong safety.** Voice accuracy comes before the pilot (`KB-405` waits), then the rest in the order of D100. The hard rules do not move: the AI may only use numbers that were spoken, and a line gets at most one warning.

---

## b. Phase V — Voice accuracy (top priority, before the pilot)

| # | Ticket | What | D33 | Status |
|---|---|---|---|---|
| V1 | `KB-370` | **Bake-off (a report only; no app change)** - see below. Folds in `KB-369`. | yes | **done** 4 Nov 2026 - `eval/bakeoff/REPORT.md`: B best (exact 73% short, 58% long; A 56% / 11%), no candidate at 0 wrong lines; B in production is capped by 100 transcribe requests a day on Tier 1 **Note (4 Nov 2026): on short orders B still had 7 wrong numbers - B is the best ear tested, not a solved one.** **Round 2 done 5 Nov 2026** (`eval/bakeoff/REPORT-ROUND2.md`, D102 scoring): E-flash (audio -> gemini-3.8-flash, D102 prompt) the only one that applies spoken corrections, 6 wrong lines on long orders (all A61's "set" unit) but about 3 Theek hai per long order; Sarvam cheapest, fewest wrong on short orders, batch wait about 5 s; B still best exact rate (73% / 64%). No candidate at 0 wrong lines. |
| V2 | `KB-371` | **Owner picks** from the report. | Owner | **done 6 Nov 2026 (D104):** production voice = "nocat-D103" (audio -> `gemini-3.8-flash`, no catalog in the prompt; our code fills unspoken prices and computes every total); Sarvam `saaras:v4` is the backup; Whisper and B are not the production ear. No more bake-off rounds - the 60 recordings are V3's regression set. |
| V3 | `KB-372` | **Build the winner (D104: nocat-D103, Sarvam the backup) - design in `25-V3-VOICE-DESIGN.md` (PLAN first).** Long orders (30-90 s) must work: no restart, no duplicated lines. **Built TOGETHER with `KB-378`** (the new recording flow, D101). | yes | todo |
| V3a | `KB-378` | **Record-review-generate flow** (owner, Nov 2026, D101 - the Ezy Parchi style): tap to record -> a timer -> Pause / Resume (paused time is NOT recorded) -> Stop -> optional playback -> Re-record or Generate bill -> a processing screen -> the full bill with the usual checks; "add more by voice" inside a bill uses the same flow and APPENDS lines; maximum length 5 min (owner to confirm). Why: today's push-to-talk has no pause (side conversations get billed) and no review step (a bad take goes straight into the bill); the owner's head-to-head with Ezy Parchi. **Safety rules unchanged** (only spoken numbers, one warning per line, Price needed, never a question mid-bill). Built with `KB-372`. | yes (the voice path and the draft) | todo |
| V3.1 | `KB-379` | **Regression harness (offline replay of saved raw answers) + the scorer fixes (the gate's product hole, script artifacts).** Finish line: the replay reproduces REPORT-NOCAT's nocat-D103 numbers exactly; then no artifact wrong line is left. | yes | done 7 Nov 2026 - `npm run bakeoff:replay` (offline, free) replays nocat-D103's 84 saved raw answers through `nocatBill` (the live run's own path) - 0 bills differ from the saved ones; with the 5494bde sheet it reproduces REPORT-NOCAT exactly (short 36/48, 11 wrong (7 / 4); long 20/36, 7 (5 / 2)); after the scorer fixes (the three owner-confirmed spellings; the gate's product hole closed - the owner's name resolves to X, the line claims another product Y with his words = wrong; spellings moved to `eval/acceptance/spellings.ts`) no artifact wrong line is left: short 37/48 exact, 5 wrong (1 silent: A49), long 20/36, 7 (5 silent: A60). The gate is unchanged (28/41 exact, 0 wrong). |
| V3.2 | `KB-380` | **The six check adaptations for an AI-read bill (`25` §4).** Finish line: fewer Theek hai on long orders (103 today) with no real warning lost (A38, A39, A40, A54, A19). | yes | todo |
| V3.3 | `KB-381` | **The quantity check on an AI answer (replaces KB-359's piece rule there), the implied-1 rules, the "पौने 2" reader bug (`25` §3).** Finish line: A57 keeps both 5s comma or not; A42 = 1 piece; A49 no quantity; A56 run 3 exact; `bench:numbers` 0 wrong. | yes | todo |
| V3.4 | `KB-382` | **Both A38 fixes: the price unit read from the words; the 100x flag a Theek hai cannot clear (`25` §3.3, §4).** Finish line: A38 exact; a 100x line cannot reach Bill Banao (tested in `canFinalize` and `buildFinalBill`). | yes | todo |
| V3.5 | `KB-383` | **The V3 prompt: listed units, repeats as two lines, "हटा दो" (`KB-367`), Devanagari names, the quantity rule (`25` §2).** Finish line: live run: A60 no size word as a unit; A39 / A40 keep both lines; A41 exact; 0 Latin names; no line shows Price needed only because of the script (a Devanagari brand name must find the catalog's Latin name - transliteration-aware matching + Devanagari aliases, `25` §11); no new wrong line. | yes | todo |
| V3.6 | `KB-384` | **Server path: Storage upload + RLS, `/voice` by path, the result cache, the 7-day clean-up, the Sarvam backup under D102 / D103, the time limit measured (`25` §1, §6, §7).** Finish line: a 3-4 minute recording (the longest real order, owner 7 Nov 2026; the 5-min cap stays as the stop limit) works end to end and the function's time is measured on it; a retry makes no second Gemini call; with Gemini forced to fail, every recording gives a Sarvam bill with 0 silent wrong lines and the same names / units as the Gemini bill on every line Layer 1 reads; `public/privacy.html` (English + Hindi) updated in the same release, before any recording is stored (`25` §15). | yes | todo |
| V3.7 | `KB-385` | **The phone: the D101 flow, Pause / Resume, the 5-min cap, recording at 24 kbps, the local queue, Retry, one recording = one bill, the error states, Devanagari names (`25` §5, §6, §8).** Finish line: every error state ends in Retry or Add by hand; a retry or a double tap never adds lines twice; preview browser, then the owner's phone. | yes | todo |
| V3.8 | `KB-386` | **VERIFY the 24 kbps recording (built in `KB-385`) on fresh recordings (`25` §9).** Finish line: the measured kbps; the same exact rate and 0 silent wrong lines as the 126 kbps originals. | no | todo |
| V3.9 | `KB-387` | **The final live regression run, then V4 / V5 (`25` §12).** Finish line: 0 silent wrong lines, at least 90% exact on short AND at least 90% on long orders (each separately), live; then the draft, the phone check, the head-to-head. | yes | todo |
| V3b | - | **The owner repeats the head-to-head test against Ezy Parchi** on the V3 draft (the new ear + the new flow) - **before the pilot**. | Owner | todo |
| V4 | `KB-373` | **Re-run the acceptance set** (`23`) on the new voice; decide the >= 90% exact unlock (the set is not locked today: 28 of 41, 68%). **First fix the gate's product hole** (`23` known issue, found by the `KB-370` canary 1 Nov 2026: a wrong catalog product carrying the owner's words scores as right). | yes | todo |
| V5 | `KB-374` | **Draft -> the owner's phone check -> release** (marker only on his approval, D55; rollback target recorded first). | yes | todo |

**Open questions before V2 / V3 - NOT decided (recorded 4 Nov 2026).** V2 (`KB-371`) is **open**: the owner is doing his own outside research before choosing (started 4 Nov 2026). Nothing below is decided; a "suggestion only" is the reviewer's current view, recorded as the question was asked, and changes nothing.

1. **Which ear - and a backup ear?** B (`gemini-3.5-transcribe`) was best in `KB-370`, but still had 7 wrong numbers on short orders. A backup ear is needed for failures and for the Tier 1 cap of 100 a day. *Suggestion only:* B as the ear, with a backup ear for failures and the daily cap.
2. **Keep the recording on the phone until the bill is made?** *Suggestion only:* yes - Retry resends the same audio, and recordings wait in an offline queue (today Retry needs the order spoken again - `12` SG-12).
3. **Spoken corrections** ("नहीं नहीं 3 किलो", A59) - handle them or not? `KB-367` was dropped on 30 Oct. *No suggestion recorded.*
4. **Product names - DECIDED (D102, owner, 4 Nov 2026):** the bill line keeps the name the shopkeeper SAID, with the spoken quantity and price; the catalog / the shop's remembered prices only fill a price that was NOT said, and only when the name clearly matches one item - several or none = "Price needed", never a guess or another product's name. All reader rules stay. Affected, designed in V3 (not changed now): `KB-368`'s weak-match badge, the learning engine, the Catalog screen.
5. **Units - DECIDED (D103, owner, 5 Nov 2026):** units as said ("सेट" = set, "पैकेट" = packet, "किलो" = kg), money unchanged; when a phrase has two unit words ("1 किलो पैकेट", "आधा किलो रवा पैकेट"), the unit next to the NUMBER wins. Repeated identical items stay two lines with the "said twice or heard twice?" warning, never merged.
6. **Maximum recording length and the upload size limit:** 5 min is proposed in D101; to be checked against the Netlify request size limit, the base64 overhead and the recording bitrate. *No suggestion recorded* beyond D101's proposed 5 min.
7. **The 100-a-day limit, the path to Tier 2 or Vertex AI, and the cost per bill.** *No suggestion recorded.*
8. **Every error state ends in Retry or Add by hand.** *Suggestion only:* yes - no error leaves the shopkeeper without one of the two.

**Outside research (owner, 4 Nov 2026) - a note, nothing approved by it.** The owner ran the same brief in ChatGPT, Perplexity, Google AI Studio, Google AI Mode and Gemini.
- **Consensus:** names as said (now D102); a spoken correction edits the earlier line; every number traced to the transcript (the app already does this - `KB-359`, `KB-366`); keep the recording until the bill exists, Retry resends the same audio, an offline queue, one recording = one bill (no duplicates on a retry); upload the audio directly to Supabase Storage, not through Netlify; record at about 24 kbps Opus.
- **Disagreement:** "audio straight to one AI" (AI Studio, Gemini) is contradicted by our own `KB-370` result for candidate C.
- **Candidate ears for a round 2 (NOT approved):** `gemini-3.5-transcribe` (B), Sarvam Saaras v4 (the batch API is needed over 30 s), OpenAI gpt-transcribe.
- **Facts to verify in V3:** Gemini transcribe's "smart mode" may delete spoken corrections; Tier 2 = $100 paid + 3 days; the Vertex AI / Google Cloud quotas for `gemini-3.5-transcribe`; our recordings are about 126 kbps today (A61: 1,198 KB for 76 s - checked on the file), so a 5-min order is about 4.7 MB before encoding - too close to Netlify's 6 MB.
- **Ezy Parchi user reviews (AppBrain, Oct 2026):** users want saved per-item prices, an udhari khata and a UPI QR; one reports being locked out after a logout.
- **Proposed (NOT approved):** an Ezy benchmark - the owner plays the 12 long recordings into Ezy Parchi and records its bills.

**V1 - the four candidates and the optional fifth**

| | Ear | Then |
|---|---|---|
| **A** | The current pipeline: Groq Whisper (`whisper-large-v3`) | Layer 1 + Layer 2 + the checks (baseline) |
| **B** | `gemini-3.5-transcribe`, with the shop's catalog names as custom vocabulary | the SAME Layer 1 + Layer 2 + checks |
| **C** | Audio straight to a Gemini model, returning the items AND the transcript in one call | the same checks |
| **D** | Hybrid: B and C in parallel; **C's numbers must appear in B's transcript** (a number only C heard is not trusted) | the same checks |
| **E** | *Optional:* Sarvam `saaras:v4`. Note its **30 s real-time limit** (owner-reported; check the vendor's page when planning). | the same checks |

**Test data:** the owner's 50 acceptance recordings (`eval/acceptance/audio`, never in git) + **12 NEW long orders, A51-A62** (recorded 31 Oct 2026, 20-76 s; bills confirmed by the owner 1 Nov). The 31 Oct dal order itself was not re-recorded.
**Metrics, per candidate:** exact-bill rate; **wrong numbers reaching a final line** (the release rule is 0); dropped or duplicated items; lines flagged; seconds from stop to bill (compare `KB-355`, budget 1.5 s to transcript); rupees per bill.
**Rules:** pin exact model names; declare the call count first (`D99` item 11, shared quota); one table, one report, no change to the app. Related: `KB-007` (the Whisper vocabulary prompt, built OFF) is measured in the same run.

**`gemini-3.5-transcribe` limits - what they mean for B and D (1 Nov 2026).** The owner's AI Studio: Tier 1 = **10 requests and 10K tokens a minute, 100 requests a DAY**, per project - and the eval key and production are the SAME project ("Kirana Bill"), so they share the 100. Daily caps reset at midnight Pacific (13:30 IST). Google's rate-limits page (28 Oct 2026): **Tier 2 comes automatically after $100 paid + 3 days** from the first payment (Tier 3: $1,000 + 30 days); this model's per-day figure on Tier 2 / 3 is shown only in AI Studio, not on the page; a paid-tier increase can be requested (no guarantee). **Plainly: on Tier 1, B or D as the production ear would allow at most 100 voice orders a day for the whole app - every shop together, minus any tests - and the 101st order of the day would fail to transcribe.** The owner's shop alone may pass that. So B or D can be a production choice only after Tier 2 (and its per-day figure read in AI Studio) or a granted increase; C runs on `gemini-3.5-flash-lite`, whose limits are separate (to be read in AI Studio before V2). The bake-off itself stops at 90 transcribe calls a Pacific day (`eval/bakeoff/quota.ts`) and resumes the next day.

**V3 must also fix (found offline in round 2, 5 Nov 2026 - `eval/bakeoff/REPORT-ROUND2.md`; D103) - every item below is designed in `25-V3-VOICE-DESIGN.md` and owned by a ticket `KB-379` - `KB-387` (D105). **The whole V3 plan was approved by the owner on 7 Nov 2026.** Testing uses the owner's voice only, and he does the live tests on request; the pilot is the first test of other voices (a known risk, accepted).**
- **A38's 1,000x total - both fixes are required (D103 item 3):**
  - (a) our code reads the price unit from the spoken words ("56 रुपए किलो" after 500 ग्राम = per kilo), whatever the AI labels it;
  - (b) a backstop a Theek hai tap cannot clear - a line wildly out of proportion must be edited before Bill Banao.
- **The "पौने 2" reader bug:** `extractSpokenNumbers` reads "पौने 2" as 0.75 and 2 (it reads "पौने दो" as 1.75). Any ear that writes the digit hits it.
- **Old checks that give false alarms on an AI-read bill** (77 of E-flash's 112 long-order Theek hai):
  - `number_dropped` / `qty_dropped` on a spoken correction (A59) and on a pack size ("1 लीटर एक पैकेट", A55);
  - `number_misaligned`'s qty-1 rule - an unspoken 1 kg is excused only when no "1" is said anywhere in the order (A58);
  - `layer2_disagrees` / `number_unconsumed` when Layer 1 cuts the pieces differently from the AI (A57);
  - `unusual_rate` against the price of a catalog product the as-said name happens to claim (A34);
  - `duplicate_line` when two different as-said names claim one catalog product (A40).
- **PROVEN (6 Nov 2026, raw answers saved - `REPORT-NOCAT.md`):** `KB-359`'s quantity drop strips a quantity the AI DID say when Layer 1 puts the number in the next piece (A57 "रिन साबुन 10 वाली 5 पीस": the AI said 5 in all 9 runs, the bill kept it only when the transcript had a comma; A42 "दंतकांति 60 वाला": E-flash said 1). On an AI answer it must not trust Layer 1's cut.
- **A no-catalog prompt must keep units to the listed ones** (A60: "1 बड़ा हार्पिक", "1 बोतल फिनाइल" - size words used as units; the money right).
- **The E-flash D102 prompt's rule 3 ("1 किलो पैकेट" = 1 packet) contradicts D103** (the unit next to the number wins: 1 kg). Whatever prompt V3 ships must follow D103.
- **A line with a packet unit for a product priced per kg** shows a Theek hai (`missing_total`) where it should show Price needed (A19).

**V3 constraints that do not change:** a rate or total must be a number that was spoken (`KB-359`); a product from a name nothing explains is never silent (`KB-368`); a line with no price is priced before Bill Banao; one warning per line.

---

## c. Phase P — The pilot

| # | Ticket | What | D33 | Status |
|---|---|---|---|---|
| P0a | - | **Owner decides before P1 - PRD `01` section 8 S3** (median mic-tap to items < 2 s on the fast path, < 5 s otherwise). It is not in the `06` release gate, and today's voice probably fails it. **Reviewer's recommendation: keep S3 as a measured target, not a pass/fail gate; re-measure after Phase V.** **Decided (owner, 31 Oct 2026): as recommended - S3 is a measured target, not a gate.** | Owner | done 31 Oct 2026 |
| P0b | - | **Owner decides before P1 - one fresh restore of a real backup before the pilot.** The last restore of a real production backup with the real key was 11 Oct 2026 (15 tables, 553 rows, `22`); `bill_cancellations`, `bill_metrics` and the bill-number tables (migrations of 14 - 22 Oct) were added since. **Reviewer's recommendation: one step in the pilot checklist (`17`), run as in `22`.** **Decided (owner, 31 Oct 2026): as recommended - it is step 5 of the `17` checklist.** | Owner | done 31 Oct 2026 (decided; the restore itself is in P1) |
| P1 | `KB-405` | The owner's shop pilot **on the new voice**: the "Before the real shop" checklist in `17` unchanged, Review mode on for the first 20 bills, the weekly Drive look (`M-38`). Waits for Phase V. | Owner | todo (waits for V) |
| P2 | - | After the first 20 bills: read the Heard -> Billed pairs, decide whether to unlock the acceptance set, then the next big thing (`10`). | - | todo |

---

## d. Phase F — Bill features

| # | Ticket | What | D33 | Status |
|---|---|---|---|---|
| F1 | `KB-375` | **Hold bills:** several open bills on one phone at once (park one, serve the next, come back). It always touches the draft store. | yes | todo |
| F2 | `KB-376` | **Discount, charges, old due.** Money rules: **a decision record (the next D-number) BEFORE any code**; it replaces `SG-11` (round-off / discount), which keeps its text in `12`. | yes | todo |
| F3 | `KB-377` | **One-script item names** on the bill and the receipt (the owner's wording: "one-script item names"). What exactly is shown, and where, is fixed in its own PLAN. | no | todo |

---

## e. Phase A — The Android app (Capacitor, Android only; `KB-406` is the umbrella)

Capacitor around the existing code (D100, `11` SD-008). No iOS app: iOS stays the PWA.

| # | Ticket | What | D33 | Status |
|---|---|---|---|---|
| A1 | `KB-408` | **Thermal printing** - the list below. | no | todo |
| A2 | `KB-409` | **Native Google sign-in.** Google blocks sign-in inside embedded web views, so the app needs a native sign-in; the design is fixed in its own PLAN. It decides which shop's data a phone can see (auth -> shop -> RLS). | yes | todo |
| A3 | `KB-410` | **Play Store release** - the list below. | no | todo |
| A4 | - | **Profile & settings - owner to list before the final app.** *Placeholder: no ticket until the owner writes what the Profile and Settings screens must hold.* | Owner | todo |

**A1 `KB-408` - thermal printing, what it holds**
- Bluetooth Classic (SPP) **and** BLE printers.
- **Print the receipt as an IMAGE:** cheap printers have no Devanagari fonts. About **384 dots for 58 mm**, about **576 for 80 mm**, at 203 dpi.
- A printer setting and a paper-size setting (58 / 80 mm); a **test print**.
- Optional **auto-print on Bill Banao**; **reprint from History**, marked as a reprint; a copies setting.
- A clear "printer not connected" message, with **Share** as the fallback (printing never blocks the bill).
- Android 12+ Bluetooth permissions (`BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`).
- **Owner tests on real printers** (his own 58 mm and 80 mm).

**A3 `KB-410` - Play Store, what it holds**
- Developer account ($25 one-time, `11` SD-008) - **Owner**.
- App signing; the data-safety form; a **privacy policy URL**, so **`KB-347` (the privacy notice, DPDP; a lawyer reviews) becomes required** instead of "before more than the pilot shops".
- **How updates ship:** the web code is served from the app bundle or from the site - to be decided in its PLAN, with the foreground-update rule of `KB-401` in mind.

---

## f. Phase L — Later (ids only; the text is in `12-PARKED.md`)

| What | Where it is described | Status |
|---|---|---|
| UPI QR on the receipt | `12` section B "UPI link on receipt" | later |
| Khata (credit ledger) | `12` section B "Udhaar / credit ledger" (+ "Customer database") | later |
| Photo orders | `12` `SG-22` | later |
| Day totals | `12` `SG-15` | later |
| Item calculator | `12` `SG-23` | later |
| Receipt customization | `12` `SG-24` (a shop logo is `KB-327`) | later |
| Referral | `12` `SG-25` | later |

Everything else deferred stays in `12` (staff roles `SG-16`, GST `SG-17`, error monitoring `SG-18`, ...).

---

## g. Model policy (D33) — which items need the strongest model

The strongest available model runs every item that touches **numbers, money, sync, RLS or migrations**: V1, V3, V3a (`KB-378`: the voice path and the draft), V4, V5 (the number path and the release gate), F1 (it always touches the draft store), F2 (money) and A2 (native sign-in decides which shop's data a phone can see: auth -> shop -> RLS). Mechanical work (docs, scaffolding, the Android shell) may use a lighter model.

---

## Owner items (only the owner can do these)

| What | For | Status |
|---|---|---|
| Record **at least 10 long orders (30-90 s)** in his own voice, with the bill each must give - **slots A51-A62** on the recorder | V1 | **done** 31 Oct 2026 (recorded); bills confirmed 1 Nov 2026 |
| Pick the winner from the V1 report | V2 | todo |
| Confirm the recording flow's maximum length (proposed 5 min) | V3a | todo |
| Repeat the head-to-head test against Ezy Parchi on the V3 draft, before the pilot | V3b | todo |
| The phone check of the draft, and approval of the release marker | V5 | todo |
| The "Before the real shop" checklist (`17`) and Review mode for the first 20 bills | P1 | todo |
| Test on his own 58 mm and 80 mm printers | A1 | todo |
| The Play developer account ($25) | A3 | todo |
| List the Profile and Settings content | A4 | todo |
