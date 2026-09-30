# 05 — Frontend Specification

**Last updated:** 30 Sep 2026 (rev 6) · **Status:** Final for MVP · Validated against mockups

React + TypeScript + Vite. Web and installable PWA first; Android via Capacitor afterwards.
Must work on **both phone and desktop**.

---

## 1. Screens

| # | Screen | Purpose |
|---|---|---|
| S1 | Sign in | Google sign-in only |
| S2 | Onboarding | Shop name, phone, logo, **catalog choice** |
| S3 | **Billing** | The home screen. Everything else is secondary. |
| S4 | Catalog | Search, add, edit, price, learning suggestions |
| S5 | History | Search and view past bills |
| S6 | Bill detail | Read-only view of a finalised bill |
| S7 | Settings | Shop details, bill language, developer mode |

---

## 2. S3 — Billing screen

This screen is the product. Every decision here is subordinate to **turns-to-bill = 1**.

```
┌──────────────────────────────────────────────┐
│  KiranaBill              [offline?] [≡]      │
├──────────────────────────────────────────────┤
│  Customer: [ Cash            ] [ mobile   ]  │  ← never blocks
├──────────────────────────────────────────────┤
│  Item          Qty   Unit   Rate    Amount   │
│  ─────────────────────────────────────────   │
│  Chini          2     kg      45      90   ✕ │
│  Parle-G        3     pcs     10      30   ✕ │
│  Ajwain         —     —        —       0   ✕ │
│    ⚠ Price needed                            │
│  Chawal         5     kg       —      30   ✕ │
│    ⚠ Rate ₹6/kg — usually ₹52. Check?        │
├──────────────────────────────────────────────┤
│  TOTAL                              ₹150     │
├──────────────────────────────────────────────┤
│  [ 🎤  Bolein ]        [ + Add item ]        │
│  [        Bill Banao          ]              │
└──────────────────────────────────────────────┘
```

**Desktop:** table. **Mobile:** cards, one per line. The predecessor already does this switch.

### The one-turn flow

```
tap mic → speak the whole order → tap stop
   ↓
transcript appears immediately (before items resolve)
   ↓
all items land in the table — including unknowns, flagged
   ↓
glance · tap to fix anything wrong
   ↓
"Bill Banao" → receipt
```

**No question is ever asked between the mic and the receipt.**

### Voice states

| State | UI |
|---|---|
| Idle | "बोलने के लिए दबाएं" |
| Requesting mic permission | "Mic permission…" — never a blank pulsing button |
| Listening | Pulsing indigo rings + elapsed timer + `सुन रहे हैं…`. Mic becomes a stop button. **Design this state explicitly — it is the most-seen state in the app and was missing from the first mockups.** |
| Transcribing | Spinner + "सुन रहे हैं…" |
| Transcript ready | **Show the transcript text immediately** |
| Resolving | Items append as they resolve |
| Done | Items in table, focus on the first flagged line |
| Failed | Inline message + "Add manually" — never a dead end |
| Offline | Mic disabled, one-line reason |

### Layout behaviour on long bills

The mockup showed a 4-item bill with a large dead area above TOTAL. Real bills run longer.

- **TOTAL is pinned** to the bottom of the item area, above the action buttons, always visible
- The item list scrolls beneath it; TOTAL and the buttons never scroll away
- On a short bill the empty space sits **between the last item and TOTAL** — acceptable
- The most recently added item scrolls into view automatically

### Add-item sheet proportions

The mockup gave a third of the screen to a "Bill so far" strip showing four words.

- The sheet covers **~75% of viewport height** — search results are the point
- The strip above collapses to **one line**: `Bill so far · ₹150 · 4 items`
- Search field focused on open, keyboard up immediately

### Line flags

| Severity | Appearance | Blocks finalise? |
|---|---|---|
| **HIGH** | 3px `DANGER` left border + red inline sentence + a **"Theek hai"** acknowledge button on the row | **Yes**, until acknowledged |
| MEDIUM | Amber REVIEW badge, tappable for reason | No |
| LOW | Small grey dot | No |

Flags are **inline sentences, not icons**. "Rate ₹6/kg — usually ₹52. Check?" is actionable;
a warning triangle is not.

### Implementation notes — S3 shell (`KB-301`, 27 Sep 2026)

- **Code:** `src/ui/BillingScreen.tsx` (`BillView` is the presentational part), display rules in
  `src/ui/billFormat.ts`. Mobile first: cards below Tailwind `md` (768px), a table from `md` up; max width 720px.
- **Unknown values:** qty, rate or amount unknown → `—` (`13-DESIGN.md` §6c). The layout diagram above shows an
  unpriced line's amount as `0`; §6c wins — `₹0` would read as free.
- **Rate unit** (owner, 27 Sep 2026): the rate shows its unit only when a real conversion sits between the rate
  and the line — `unitScale(unit, rateUnit)` is ±3: "500 gm chini" → `₹45/kg`. Same unit, or interchangeable
  count units (packet vs piece, `unitScale` 0) → plain `₹60`.
- **Units** are shown as the domain spells them (`gm`, `kg`, `piece`, `packet`) — the diagram's `pcs` is not
  mapped. Item names are the spoken name, capitalised by CSS.
- **Not built yet:** mic, Add item and Bill Banao are disabled (reason in a tooltip only); the customer row is
  static "Cash" (`KB-306`); the ≡ menu holds only Sign out until S7 (`KB-312`).
- **Dev only:** `?try=<utterance>` fills the bill with real `parseUtterance()` output for browser checks;
  removed from production builds (D39).
- **Shop load failure:** online, no cached shop, lookup failed → "Server se connect nahi ho paaya" + Retry, never
  onboarding (`12-PARKED.md` KI-42).

### Implementation notes — voice (`KB-302`, 27 Sep 2026)

- **Code:** `src/ui/useVoiceCapture.ts` (MediaRecorder, push-to-talk), `src/ui/useVoiceBilling.ts` (the voice
  states), `src/data/voiceApi.ts` (POST `/voice`), `src/data/voiceBilling.ts` (Layer 1 → Layer 2 → Layer 3),
  `src/data/shopCatalog.ts` (the shop's catalog from Dexie).
- **States, as built:** idle "बोलने के लिए दबाएं"; "Mic permission…" while the browser asks; listening = the mic
  becomes a pulsing stop button "रोकें" + `सुन रहे हैं… m:ss`; transcribing = spinner; the transcript appears in
  quotes above the buttons before items resolve; failures are one inline line (permission denied, no mic,
  unsupported, no internet, session expired, rate limit, nothing heard, no items) and the mic stays usable.
- **Offline / offline session / catalog loading:** mic disabled with a **visible** one-line reason
  ("Offline — voice needs internet", "Loading your catalog…") — unlike Add item / Bill Banao, whose reasons
  are tooltips.
- **"Add manually" on failure** needs Add item (`KB-305`); until then the mic is the only way out of a failure.
- **Not in KB-302:** flag display and "focus the first flagged line" (`KB-304` — flags are stored per bill
  line, re-based per utterance); editing (`KB-303`); the bill surviving a reload (`KB-313`).
- **Dev only:** `?lang=hi|en|auto` (Whisper language hint for the owner's measurement) and `[voice]` console
  logs (transcript, layer, lines, flags, numbers heard, tap→listening and stop→transcript timings); both
  stripped from production builds (grepped).

### Add item (S3a)

Replaces the predecessor's four blank fields, which never matched the catalog.

```
┌──────────────────────────────────┐
│ [ chi|                        ]  │
├──────────────────────────────────┤
│  Chini              ₹45/kg       │  ← tap adds instantly
│  Chana Dal          ₹95/kg       │
│  Chai Patti         ₹520/kg      │
│  ─────────────────────────────   │
│  + Add "chi" as a new product    │
└──────────────────────────────────┘
```

- Search runs against the **client-side catalog index** (see `KB-CATALOG-INDEX`)
- Tap adds with the shop's price pre-filled, qty focused, qty defaulted to 1
- **Target: under 2 seconds from tap to item on bill**
- Adding a new product from here creates a `shop_product` directly

---

## 3. S2 — Onboarding catalog choice

One screen, two options, no wrong answer:

```
  ┌────────────────────────────────┐   ┌────────────────────────────────┐
  │  Use the ready catalog          │   │  Start empty                   │
  │  482 common grocery products    │   │  Add your own products as you  │
  │  with Hindi names. Edit prices  │   │  bill. Products you speak are  │
  │  any time.                      │   │  learned automatically.        │
  │            [ Choose ]           │   │           [ Choose ]           │
  └────────────────────────────────┘   └────────────────────────────────┘
```

Either way, base products can be pulled in later from Catalog → "Add from ready catalog".

---

## 4. S4 — Catalog

- Search (same index as Add item)
- Rows: name, unit, price, `use_count`
- Edit price inline
- Filter: All · Custom · Learned · From base catalog
- **"Add from ready catalog"** — browse and import base products at any time
- **Learning suggestions panel** — price drift, unit drift, provisional products awaiting promotion.
  Suggestions appear **only here**, never during billing.

---

## 5. S5 — History

Search by customer name, amount, date, or item — all client-side against the local store, so it
works offline. Grouped by date. Tap opens S6.

Each row shows a sync chip when not yet synced. Never alarming; just informational.

---

## 6. Receipt

**A kirana parchi, not a tax invoice.**

Pilloo prints A4 with HSN/SAC columns, CGST/SGST/IGST tables, "Net 30 days from invoice date", and
Customer Signature / Authorized Signatory blocks — for ₹150 of rice. That is an accounting artifact
wearing a receipt's clothes.

```
        [logo]
      SHARMA KIRANA
      98765 43210
   ─────────────────────
   Bill: KB-000142
   15-08-2026  6:56 PM
   Cash
   ─────────────────────
   Chini      2kg  ₹45   90
   Parle-G     3   ₹10   30
   Chawal     5kg         30
   ─────────────────────
   TOTAL              ₹150
   ─────────────────────
      Dhanyawaad!
```

- Narrow, thermal-friendly proportions
- Language follows `bill_language` (en / hi / both) — the setting must actually work; it is currently
  saved and never read
- **Every interpolated value is HTML-escaped.** `display_name`, shop name, customer name are all
  user-controlled and end up in `innerHTML`.
- Share: Image · PDF · WhatsApp

---

## 7. Offline UI

| State | Treatment |
|---|---|
| Offline | Small grey chip in the header: "Offline" |
| Offline, billing | Everything works. No dialogs, no nags. |
| Syncing | Chip: "Syncing…" |
| Sync failing | Amber chip, tappable for detail. **Never blocks billing.** |

**Never** a full-screen "no internet" state. The shop keeps running when the wifi doesn't.

---

## 8. Non-negotiable UI rules

1. **No modal ever stands between the mic and the receipt.**
2. **No question is asked mid-bill.** Customer defaults to "Cash".
3. **Unknown products are added and flagged**, never refused.
4. **Voice failure always falls back to search**, never to a dead end.
5. **Numbers are the loudest thing on a flagged line** — inline sentences, not icons.
6. **A half-built bill survives** a network drop, a tab switch, and an app backgrounding.

---

## 9. Accessibility and reality of the counter

- Minimum touch target 44px — this is used one-handed, quickly, sometimes with wet hands
- Large, high-contrast numbers: the shopkeeper reads the total at a glance
- `inputmode="decimal"` on every qty and rate field
- Works in bright daylight — the shop faces the street
- Never rely on colour alone to convey a flag; always include text

---

## 10. Performance budgets

| Action | Budget |
|---|---|
| Keystroke → search results | < 16 ms (60 fps) |
| Tap mic → listening | **Cold (first) tap ≤ 1 s; warm taps (within 60 s of the last) < 100 ms** — never shown before recording has actually started (`07-DECISIONS.md` D49, superseding D45's 300 ms cold budget; measured 30 Sep 2026 with the warm mic: warm 52–61 ms, cold 816 ms = getUserMedia 709 + recorder 106) |
| Stop → transcript shown | < 1.5 s |
| Fast-path item on screen | < 300 ms after transcript |
| LLM-path item on screen | < 4 s after transcript |
| Finalise → receipt shown | < 500 ms (local write, sync is background) |
| App cold start | < 2 s |
