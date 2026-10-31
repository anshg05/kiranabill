# 24 — Roadmap

**Last updated:** 31 Oct 2026 (rev 1) · **Status:** Living plan - every item's status is updated when its work lands
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
| V1 | `KB-370` | **Bake-off (a report only; no app change)** - see below. Folds in `KB-369`. | yes | todo |
| V2 | `KB-371` | **Owner picks** from the report. | Owner | todo |
| V3 | `KB-372` | **Build the winner behind a setting, Whisper kept as the fallback.** Long orders (30-90 s) must work: no restart, no duplicated lines. | yes | todo |
| V4 | `KB-373` | **Re-run the acceptance set** (`23`) on the new voice; decide the >= 90% exact unlock (the set is not locked today: 28 of 41, 68%). | yes | todo |
| V5 | `KB-374` | **Draft -> the owner's phone check -> release** (marker only on his approval, D55; rollback target recorded first). | yes | todo |

**V1 - the four candidates and the optional fifth**

| | Ear | Then |
|---|---|---|
| **A** | The current pipeline: Groq Whisper (`whisper-large-v3`) | Layer 1 + Layer 2 + the checks (baseline) |
| **B** | `gemini-3.5-transcribe`, with the shop's catalog names as custom vocabulary | the SAME Layer 1 + Layer 2 + checks |
| **C** | Audio straight to a Gemini model, returning the items AND the transcript in one call | the same checks |
| **D** | Hybrid: B and C in parallel; **C's numbers must appear in B's transcript** (a number only C heard is not trusted) | the same checks |
| **E** | *Optional:* Sarvam `saaras:v4`. Note its **30 s real-time limit** (owner-reported; check the vendor's page when planning). | the same checks |

**Test data:** the owner's 50 acceptance recordings (`eval/acceptance/audio`, never in git) + **at least 10 NEW long orders (30-90 s) that the owner records** + the dal order of 31 Oct.
**Metrics, per candidate:** exact-bill rate; **wrong numbers reaching a final line** (the release rule is 0); dropped or duplicated items; lines flagged; seconds from stop to bill (compare `KB-355`, budget 1.5 s to transcript); rupees per bill.
**Rules:** pin exact model names; declare the call count first (`D99` item 11, shared quota); one table, one report, no change to the app. Related: `KB-007` (the Whisper vocabulary prompt, built OFF) is measured in the same run.

**V3 constraints that do not change:** a rate or total must be a number that was spoken (`KB-359`); a product from a name nothing explains is never silent (`KB-368`); a line with no price is priced before Bill Banao; one warning per line.

---

## c. Phase P — The pilot

| # | Ticket | What | D33 | Status |
|---|---|---|---|---|
| P1 | `KB-405` | The owner's shop pilot **on the new voice**: the "Before the real shop" checklist in `17` unchanged, Review mode on for the first 20 bills, the weekly Drive look (`M-38`). Waits for Phase V. | Owner | todo (waits for V) |
| P2 | - | After the first 20 bills: read the Heard -> Billed pairs, decide whether to unlock the acceptance set, then the next big thing (`10`). | - | todo |

---

## d. Phase F — Bill features

| # | Ticket | What | D33 | Status |
|---|---|---|---|---|
| F1 | `KB-375` | **Hold bills:** several open bills on one phone at once (park one, serve the next, come back). | if it touches sync or the draft store | todo |
| F2 | `KB-376` | **Discount, charges, old due.** Money rules: **a decision record (the next D-number) BEFORE any code**; it replaces `SG-11` (round-off / discount), which keeps its text in `12`. | yes | todo |
| F3 | `KB-377` | **One-script item names** on the bill and the receipt (the owner's wording: "one-script item names"). What exactly is shown, and where, is fixed in its own PLAN. | no | todo |

---

## e. Phase A — The Android app (Capacitor, Android only; `KB-406` is the umbrella)

Capacitor around the existing code (D100, `11` SD-008). No iOS app: iOS stays the PWA.

| # | Ticket | What | D33 | Status |
|---|---|---|---|---|
| A1 | `KB-408` | **Thermal printing** - the list below. | no | todo |
| A2 | `KB-409` | **Native Google sign-in.** Google blocks sign-in inside embedded web views, so the app needs a native sign-in; the design is fixed in its own PLAN. | no | todo |
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

The strongest available model runs every item that touches **numbers, money, sync, RLS or migrations**: V1, V3, V4, V5 (the number path and the release gate), F2 (money), and F1 if it touches sync or the draft store. Mechanical work (docs, scaffolding, the Android shell) may use a lighter model.

---

## Owner items (only the owner can do these)

| What | For | Status |
|---|---|---|
| Record **at least 10 long orders (30-90 s)** in his own voice, with the bill each must give (the dal order of 31 Oct too) | V1 | todo |
| Pick the winner from the V1 report | V2 | todo |
| The phone check of the draft, and approval of the release marker | V5 | todo |
| The "Before the real shop" checklist (`17`) and Review mode for the first 20 bills | P1 | todo |
| Test on his own 58 mm and 80 mm printers | A1 | todo |
| The Play developer account ($25) | A3 | todo |
| List the Profile and Settings content | A4 | todo |
