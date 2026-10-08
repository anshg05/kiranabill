# 05 — Frontend Specification

**Last updated:** 8 Oct 2026 (rev 14) · **Status:** Final for MVP · Validated against mockups

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
- ~~Adding a new product from here creates a `shop_product` directly~~ **Superseded 2 Oct 2026 (owner, `KB-305`):** "+ Add “x” as a new product" adds a **bill line only** — qty "—", unit "—", price "—" (no qty without a unit, `KB-303`), MEDIUM `incomplete_item` until filled. The product itself comes through L1 at finalise (`08-LEARNING-ENGINE.md` §3, `KB-307`+) — hard rule 8.
- **Implementation notes (`KB-305`, 2 Oct 2026):** a **non-modal panel** over the item list — TOTAL, the mic and Bill Banao stay visible and usable (§8 rule 1); search from 2 characters, at most 8 results, equal scores by the shop's use count; the shop's catalog from Dexie, inactive products never shown; a catalog pick is named by the product, never the typed fragment (no false alias at finalise); Android back closes the panel (a history entry while open), never the app; "Couldn't find an item — add it manually" carries an **Add by hand** button that opens the panel with the heard words.

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

### Implementation notes — Catalog (`KB-311`, 8 Oct 2026; D62)

- **Opens from the ≡ menu**, over the bill in progress; Back / Android back closes "Ready catalog", then Catalog.
- **Rows:** this shop's active products — name, "Used N times" / "Not used yet", price per unit. Most used first,
  then by name. **Search** is the Add item index (aliases, fuzzy); filters All · Custom · Learned · From base
  catalog. A filter with nothing in it says "No products of this kind."
- **Edits are online only** (owner, Q1): offline the screen says **"Needs internet to change the catalog"**, prices
  are plain text and "Add from ready catalog" is disabled. Search and billing are unaffected.
- **Price edit:** tap the price, type rupees (`parseMoneyInput`, up to ₹1,00,000, two decimals). A refused value
  keeps the input open with the reason. A save goes to Postgres, then the re-pull (D62); a failed save says
  "Couldn't save — check the internet and try again" and the price stays as it was.
- **The bill in progress:** after a save, NEW lines use the new price. **A line already on the bill never changes
  its price** — at most a check (e.g. "unusual rate") may appear on it, against the new catalog price.
- **Add from ready catalog:** the base products not yet in the shop (by base id or name), alphabetical, 100 shown,
  search for more; Add copies one in at its suggested price ("Chini added — ₹45 / kg"). A name already in the shop
  says "<name> is already in your catalog" (and its row is re-pulled, so it leaves the list). **Empty states:** the
  shop has every ready product → "Your shop already has every product in the ready catalog."; a search with no
  match → "No ready product matches “x”. Add it from a bill: Add item → + Add “x” as a new product."; a search that
  only matches products the shop already has → "“x” is already in your catalog."
- **Suggestions:** a price paid on 3 bills in 30 days (`listPendingPriceSuggestions`) — "Toor Daal: ₹95 / kg on 3
  bills (now ₹90)" and **Use ₹95**, applied only by that tap, through the same save. Provisional products are shown
  read-only ("“kurkure” — said 2 times, not in the catalog"; `KB-320` saves them). No unit drift (nothing records
  it yet).

---

## 5. S5 — History

Search by customer name, amount, date, or item — all client-side against the local store, so it
works offline. Grouped by date. Tap opens S6.

Each row shows a sync chip when not yet synced. Never alarming; just informational.

### Implementation notes — History (`KB-310`, 7 Oct 2026; D60)

- **Opens from the ≡ menu**, over the bill in progress (which stays as it is); Back / Android back closes S6, then
  S5, back to billing (`ui/useBackEntry.ts`, shared with the Add item panel).
- **This phone's bills** — the bills saved here, plus the shop's bills pulled from the server (`KB-324`, D63): a cleared
  phone, a new phone or a new draft address gets its History back, newest first. Until the first pull has finished
  History says "Loading bills from the server…" (offline: "Connect to the internet to load your earlier bills.") and
  re-reads as bills land (at most every 2 s) — never "No bills on this phone yet." before the pull has run. Empty after
  it: "No bills on this phone yet." / "History shows the bills saved on this phone."
- **Load (D60, D61):** opens on the newest 200 rows from the bills' date index (no items); **Show more** reads the
  next 200 from the same index. Search reads the device-only **`billSearch`** rows (D61 — written with each bill): the
  last 90 days by one range query, in the background ("Searching the last 90 days"); **Search older bills** (under any
  search until everything is loaded, so an older `dd-mm` never ends at "No bills found.") loads all of the shop's rows —
  "Loading older bills…". Items are read only when a bill's detail opens.
- **Search** (`domain/billSearch.ts`): every word must match the customer name, the receipt's sequence number ("142" →
  `KB-000142`, "14" doesn't), the exact total in paise ("112.50", "112.5"), a date `dd-mm` / `dd-mm-yyyy` with `-` `/`
  or `.` and single digits ("4/10"), or an item name; Devanagari digits read as 0–9. **Never the customer's mobile.**
- **Row:** receipt number, time, the name unless Cash, the total, "Not synced" while pending. Grouped Today /
  Yesterday / `dd-mm-yyyy`. No item count (owner: no schema change).
- **S6 bill detail:** the read-only receipt (`Receipt.tsx`) and the four share buttons (`ShareBar.tsx`, D58). Cancel
  and reissue is `KB-325` (parked).

---

## 6. Receipt

**A kirana parchi, not a tax invoice.**

Pilloo prints A4 with HSN/SAC columns, CGST/SGST/IGST tables, "Net 30 days from invoice date", and
Customer Signature / Authorized Signatory blocks — for ₹150 of rice. That is an accounting artifact
wearing a receipt's clothes.

Layout: the legacy parchi's (D57), en shown — the default for new shops; hi / both are options.

```
              SHARMA KIRANA                  ← larger, bold (logo above, if set)
               98765 43210                   ← small, muted
          04-10-2026 | 4:33 PM               ← small, muted
- - - - - - - - - - - - - - - - - - - - - -
Bill No. KB-000142
Customer: Ramesh                             ← only when not "Cash"; never the mobile
- - - - - - - - - - - - - - - - - - - - - -
Item          Qty        Rate        Amt     ← visible header row, bold
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Chini         2 kg        ₹45        ₹90     ← Amt bold, exact paise
───────────────────────────────────────────
Chini         500 gm   ₹45/kg     ₹22.50
───────────────────────────────────────────
Chini         —            —         ₹30     ← total only (D47)
───────────────────────────────────────────
- - - - - - - - - - - - - - - - - - - - - -
TOTAL                             ₹142.50    ← larger, bold
- - - - - - - - - - - - - - - - - - - - - -
               Thank You!
```

- Narrow, thermal-friendly proportions
- **Customer:** "Customer: <name>" prints only when the name isn't "Cash"; the **mobile is never printed** — it
  is only the WhatsApp target (D52).
- **Language follows `bill_language`** (en / hi / both; **new shops default to `en`**, D57) — read on every receipt;
  every label (header row, Bill No., Customer, TOTAL, thanks) and the units come from one table in
  `src/domain/receipt.ts`. "both" prints "Hindi / English" labels and the thanks on one line. **Item names print as in the shop's catalog** in every language (there is no
  Hindi product-name field — `12-PARKED.md` NI-37).
- **Every value is React text, never HTML** (hard rule 9). Shop name, item names and the customer name are
  user-controlled; they are rendered as text nodes, and ESLint bans `dangerouslySetInnerHTML`, assigning
  `innerHTML`/`outerHTML` and `insertAdjacentHTML` everywhere.
- **A total-only line** (D47): qty `—`, rate `—`, the spoken amount. Amounts always carry ₹ in exact paise
  (`formatRupees` — ₹22.50 prints ₹22.50, never rounded).
- Share (`KB-309`, D58 — the legacy behaviour): four buttons under the saved receipt — **Image**, **PDF**,
  **WhatsApp**, **SMS**.

### Implementation notes — share (`KB-309`, 4 Oct 2026)

- **One source:** `domain/receipt.ts` → `domain/receiptLayout.ts` (the D57 layout as drawing steps, pure, the text
  measurer injected) → `ui/receiptImage.ts` draws them on a canvas with `fillText` (no HTML): a **PNG at 2x, 768 px
  wide**, and the same pixels as a JPEG inside our own **one-page PDF** (`ui/onePagePdf.ts`, no dependency) **58 mm
  wide** (164.41 pt). A typical bill: PNG ≈ 80–105 kB, PDF ≈ 75–100 kB. Rendered **when the receipt is shown**, every
  Plex / Mukta face loaded first with the receipt's actual strings.
- **Image** and **PDF** always **download** (`KB-000142.png` / `.pdf`) — desktop and phone, no share sheet.
- **WhatsApp** sends the **image**: the share sheet when `navigator.canShare({ files })` (called inside the tap — the
  file is already rendered; Android needs the tap's activation); the shopkeeper picks WhatsApp and the chat. Cancelled
  (AbortError) → nothing. No file sharing → `wa.me/91<mobile>?text=…` with the text receipt (`domain/receiptText.ts`),
  the stored bill's mobile; none → `wa.me/?text=…`.
- **SMS** opens a sheet: a mobile field pre-filled from the **stored** bill's mobile (read when the sheet opens), else
  empty; D52 rules (`parseIndianMobile` — +91 / 0 / spaces / Devanagari digits accepted), the D52 message under the
  field, **Send disabled until valid**; a preview of the exact text. Send opens `sms:<10 digits>?body=…`. The number is
  never stored. **Text only** — a web page can't attach an image to an SMS. The SMS text uses the bill_language labels
  as plain text with `Rs.` (not ₹) and `-` / `x`: ₹, `·`, `—` and `×` force a Unicode SMS (70 characters a part
  instead of 160). **A hi / both SMS is Unicode anyway** (Devanagari labels), so it takes more parts.
- **The mobile** is never shown on the receipt or the saved screen; read from the stored bill at tap / sheet-open time;
  with the SMS sheet open it appears only as the field's value.

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
| Keystroke → search results | **Lookup ≤ 16 ms; keystroke → visible results ≤ 50 ms median** on a realistic catalog (`07-DECISIONS.md` D51, superseding the single < 16 ms; real phone 3 Oct 2026: lookup p95 0.50 ms at 481 products, 11.2 ms at 10,101) |
| Tap mic → listening | **Cold (first) tap ≤ 1 s; warm taps (within 60 s of the last) < 100 ms** — never shown before recording has actually started (`07-DECISIONS.md` D49, superseding D45's 300 ms cold budget; measured 30 Sep 2026 with the warm mic: warm 52–61 ms, cold 816 ms = getUserMedia 709 + recorder 106) |
| Stop → transcript shown | < 1.5 s |
| Fast-path item on screen | < 300 ms after transcript |
| LLM-path item on screen | < 4 s after transcript |
| Finalise → receipt shown | < 500 ms (local write, sync is background) |
| App cold start | < 2 s |
| History (S5) at 40,000 bills — **open** (newest 200) | **≤ 300 ms** on the phone (D61; owner, 7 Oct 2026). Measured 7 Oct 2026, `/__dev/history`: phone (Android 10, Chrome 152) 234 / 72 / 62 ms; laptop over the LAN 35 / 11 / 10 ms |
| History — **90-day search load** (≈ 9,000 bills; background) | **≤ 2 s** on the phone. Phone 1,624 / 1,187 / 1,145 ms; laptop 278 / 230 / 229 ms |
| History — **"Search older bills"** (all 40,000) | **≤ 6 s** on the phone, with "Loading older bills…" shown meanwhile. Phone 4,540 / 3,825 ms; laptop 1,072 / 1,031 ms |
| History — **keystroke → results** | **≤ 50 ms** (D51). Over 9,000: phone median 4.8 · p95 6.9 · max 14.7 ms (laptop 0.8 / 1.3 / 2.8). Over 40,000: phone median 14.1 · p95 16.4 · max 17.3 ms (laptop 5.0 / 6.2 / 7.0) |
