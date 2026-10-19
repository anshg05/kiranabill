# 05 — Frontend Specification

**Last updated:** 19 Oct 2026 (rev 26) · **Status:** Final for MVP · Validated against mockups

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
| Done | Items in table; the newest line scrolls into view. Nothing takes focus - **Bill Banao** focuses the first flagged line |
| Failed | Inline message + **"Add by hand"** on every failure, the heard transcript prefilled when there is one (an empty search when there is none) — never a dead end. **Built (`KB-331`, 11 Oct 2026, D76):** every failure message, and each "Not added" entry, carries the button; it only opens the Add item panel — it adds nothing and fills no quantity or price |
| Offline | Mic disabled, one-line reason |

**Why "Done" does not move focus (owner, 11 Oct 2026, audit Part 2 correction 17):** the shopkeeper may still be speaking the next item, or reading the transcript; a focus jump (and the keyboard it can raise) while they are mid-thought would interrupt them. The list scrolls the newest line into view and the flags are visible where they are; the one deliberate focus move is **Bill Banao**, which the shopkeeper has just tapped, and which takes them to the first thing that still needs a check (`pendingFocus.test.tsx`).

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
  static "Cash" (`KB-306`); the ≡ menu later grew History (`KB-310`), Catalog (`KB-311`) and Settings (`KB-312`) above Sign out.
- **Dev only:** `?try=<utterance>` fills the bill with real `parseUtterance()` output for browser checks;
  removed from production builds (D39).
- **Shop load failure:** online, no cached shop, lookup failed → "Couldn't reach the server" (हिन्दी "सर्वर से जुड़ नहीं पाए", Hinglish "Server se connect nahi ho paaya" - `KB-332`: English mode is English) + Retry, never
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
  line, re-based per utterance); editing (`KB-303`); the bill surviving a reload (`KB-313` — built, D65).
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
- **Implementation notes (`KB-305`, 2 Oct 2026):** a **non-modal panel** over the item list — TOTAL, the mic and Bill Banao stay visible and usable (§8 rule 1); search from 2 characters, at most 8 results, equal scores by the shop's use count; the shop's catalog from Dexie, inactive products never shown; a catalog pick is named by the product, never the typed fragment (no false alias at finalise); Android back closes the panel (a history entry while open), never the app; "Couldn't find an item — add it manually" carries an **Add by hand** button that opens the panel with the heard words - since `KB-331` every voice failure does, and so does each "Not added" entry (empty search when nothing was heard).

---

### Implementation notes — editing a line's numbers (`KB-337`, 18 Oct 2026; D85)

- **The amount is editable on every line** (it was "only where no rate", `KB-303` decision 1). Typing one makes the line a total line: total = what was typed, the rate shows `—`, qty and unit stay. **An empty rate box** shows `—` and keeps the amount. **A typed rate** recalculates (qty x rate, exact, D36); with no qty the line says "Quantity needed". An empty amount box on a line with no rate leaves it "Price needed"; on a rate line it changes nothing.
- **A quantity with no unit** is allowed on a line with no rate (receipt: `1`), and **a rate on a line with no unit** is a plain-number rate (no price is learned from it). A rate per a real unit still needs the unit with the qty.
- **No check on a typed amount** (owner): it is his own number, like a spoken "ka" total - a typing slip raises nothing; the TOTAL and the receipt are the check.

### Implementation notes — "—" on every line, spoken commands, the shop name (`KB-338`/`KB-339`/`KB-340`, 18 Oct 2026; D86)

- **Unit picker:** every line offers **"—"** (no unit) first, for every product. It changes no number; a line with no unit shows its qty as a plain number ("1", "2") and its rate as a plain number. The product's own unit never changes - only the line's.
- **Spoken commands** (before the parser): the whole utterance only - "bas" / "ho gaya" / "bill banao": the line **"Tap Bill Banao to finish"** (never finalises by voice); "hatao" / "undo": the last added line is removed with the usual Undo strip, or **"Nothing to remove"**; "sab hatao": **"To clear the whole bill, use the menu → Clear bill"**. The answer sits under the transcript as a quiet status line, not a failure (no "Add by hand"). A command is not a turn and never a "Not added" entry.
- **Header:** the shop's name (one line, ellipsis, full name as the title) instead of "KiranaBill"; it follows a rename from Settings.

### Implementation notes — layers, dialogs and the ≡ menu (`KB-342`, 19 Oct 2026; `21` Part 5)

- **The ≡ menu** (`ui/HeaderMenu.tsx`, was a native `<details>`): closes on a tap outside it, on choosing an item, on **Escape** and **Android Back**, and whenever a panel, sheet, dialog or the mic opens (`closeWhen`); it never opens above an open panel; `aria-expanded` is true only while the list shows; focus returns to ≡ on Escape, Back and a choice - not after an outside tap (that tap's own target keeps the focus).
- **Escape closes the top layer only**, for every full-screen layer and sheet (`useBackEntry`, the same stack as Back). An inline editor's Escape cancels just that edit.
- **Dialogs** ("Sign out?", "Clear this bill?", the sync detail) are modal in fact: Back, Escape and a tap on the dim area cancel; focus starts on Cancel and Tab stays inside; `aria-modal`.
- **Behind a full-screen layer** (History, Catalog, Settings) the bill is `inert` and `aria-hidden`.
- **Share:** the same button's repeats within 1.5 s are ignored; the SMS sheet scrolls into view and takes the focus. **Sign in:** one tap starts one Google sign-in ("Opening Google…"). Every 44 px control keeps its size (`shrink-0`).

### Implementation notes — amounts, discard, reasons, Understanding (`KB-343`, 19 Oct 2026; D88)

- **Amounts** print with Indian grouping (₹1,520, ₹1,25,000) through the one formatter; an editor opens with the plain number (`1520`) and reads a typed `1,25,000` (a real grouping only).
- **After Enter** in an inline editor the focus stays on that value. **Edit product / Add product:** Back with something typed asks **"Discard changes?"** (Cancel / Discard); nothing typed closes at once.
- **Disabled buttons say why** in one line (Save "No changes to save yet", Share "Preparing the receipt…", SMS Send, Cancel bill "Choose a reason first", Bill Banao "Add an item first" / "Saving the bill…").
- **After the recording stops** the line and the mic say **"Understanding…"** until the result or error. **Undo strip:** 10 s or the next action. **Set-up:** a visible label over each field.

## 3. S2 — Onboarding catalog choice

One screen, two options, no wrong answer:

```
  ┌────────────────────────────────┐   ┌────────────────────────────────┐
  │  Use the ready catalog          │   │  Start empty                   │
  │  Common grocery products        │   │  Add your own products as you  │
  │  with Hindi names. Edit prices  │   │  bill. Products you speak are  │
  │  any time.                      │   │  learned automatically.        │
  │            [ Choose ]           │   │           [ Choose ]           │
  └────────────────────────────────┘   └────────────────────────────────┘
```

Either way, base products can be pulled in later from Catalog → "Add from ready catalog".

---

## 4. S4 — Catalog

- Search (same index as Add item)
- **Screen language** (`KB-332`, D84): Settings has a per-device choice - English / हिन्दी / Hinglish - above the Receipt language; it repaints the open screen at once. "Bill Banao", "Theek hai" and "Cash" never change.
- **Screen language, Checkpoint B** (`KB-332`): History (list, search, bill detail, the cancellation card), Cancel bill, the Catalog and the ready catalog, Add product, Edit product, the first-time shop set-up and the shop-load error say the chosen language; the catalog **import** sheet, Developer mode, Pilot numbers and the receipt do not.
- Rows: name, unit, price, and how often it was billed in the last 30 days (`KB-321`; most used first). **Learned names** (`KB-323`): each phrase the app has learned, its product, "In use" / "Still learning", and Remove.
- On the billing screen, **the item name on a draft line is a button (a pencil marks it): tap -> "Change item" -> search -> pick another product** (`KB-336`, D83: quantity kept when the unit fits, else "Quantity needed"; a price the shopkeeper said stays; catalog products only).
- On the billing screen, a line the parser read through a learned alias carries "Learned: 'x' -> Product" and **Not this** (`KB-323`; visible, never blocking).
- Edit price inline
- Filter: All · Custom · Learned · From base catalog · **Archived** (`KB-330`)
- **Edit** on every row (`KB-330`): rename, other names, Archive. **"Add product"** (`KB-330`): name, unit, price.
- **"Add from ready catalog"** — browse and import base products at any time
- **Learning suggestions panel** — price drift (built: **Use ₹X** and **Ignore**, `KB-329`), unit drift (`KB-322`), provisional products awaiting promotion (`KB-320`).
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

### Implementation notes — Edit, Archive, Add product (`KB-330`, 11 Oct 2026; D71, D77)

- **All three are online only**, like the price edit (D62): offline, Edit, Add product and Restore are disabled with the same "Needs internet to change the catalog"; nothing opens.
- **Edit** opens an overlay (Android back closes it; an update never reloads under it): **Name**, **Other names** (aliases, one per line or comma-separated), the **unit as plain text** ("Unit: kg. A unit can't be changed here - it decides what the price means. To change it, archive this product and add it again with the right unit."), **Save** and **Archive**.
  - **Rename:** the name is normalised as in the import (NFC, controls dropped, whitespace collapsed, trimmed), 1-100 characters, and refused - before any write - when another product has it (case-insensitive; **an archived product's name counts**: the database index covers every row): "Another product is already called “x”" (+ " (archived)"). When the old name is no longer a name or an alias, a note says "“Old” will stop matching when spoken." with **Keep as another name**, which only puts it in the field (nothing is saved until Save).
  - **Other names:** the import's rules - at least 3 and at most 60 characters, not another product's name or alias (archived ones included), no repeats; the product's own name is skipped as redundant. **A dropped one is listed before Save** ("These will not be saved: “ab” - shorter than 3 characters"), only once the field has been edited.
  - **Save sends only the changed columns**, and the aliases only if their text was edited - so a pure rename never rewrites a list the shopkeeper did not open, and a rename on one phone and an alias edit on another both survive (last write wins per column, D74). A unit or a price cannot be in the write (type-limited, tested).
  - A name the server refuses (another phone took it): "Another product is already called “x”" and the sheet stays; any other failure: "Couldn't save - check the internet and try again", the typing kept.
- **Archive** (`is_active = false`; **never a delete** - no delete policy exists, and a test proves a hard delete affects zero rows): one tap, **no confirm dialog** (hard rule 6 spirit; it is reversible); a status line "“x” archived - Undo". The product leaves Add item, the Catalog list, search, the Layer 1 parser, the Layer 2 slice and the Whisper vocabulary (all read the active products), but **stays on every old bill, receipt and History row** (they keep their own `display_name`); a bill in progress keeps its line. Its learned aliases go dormant and return on Restore; Settings > Developer mode shows "(archived)" beside it.
- **Archived** filter: archived products (alphabetical; search works), price as text, **Restore** and **Edit** (so an archived name can be renamed to free it). Empty: "No archived products."
- **Add product** (D77): **Name, Unit, Price per unit - all empty, none defaulted** (unit chips kg / gm / liter / ml / piece are taps by the shopkeeper; an unusual unit is allowed with "it is saved as typed"). The import's rules and insert path: price as integer paise (never a float), more than 0, "45,50" is never guessed; unit in the app's spelling; the catalog's 10,000 cap. Errors are shown together ("Name needed", "Unit needed", "Price needed"). Written as one import row (`source = 'custom'`), then the status line "x added - ₹62.50 / kg". This is also the "archive + add again" remedy for a wrong unit - after renaming the archived one if the name is the same.

### Implementation notes — price-suggestion Ignore (`KB-329`, 14 Oct 2026; D78)

- Each suggestion row: **Use ₹X** (online, writes the price - unchanged) and **Ignore** (44 px, "Ignore the suggestion for Sugar"). Ignore is a **local learning write**, so it works offline; the row disappears at once and a status line says "Suggestion for Sugar hidden for 90 days". It never touches the price. If the write fails: "Couldn't hide that suggestion - try again" and the row stays.
- No Undo: the ignore is append-only; Developer mode lists it with its end date ("Sugar: ₹55 / kg on 3 bills (now ₹48) - ignored until 12 Jan 2027") and Reset learning clears it.
- A gram / ml product's suggestion is shown in the product's own unit ("₹0.52 / gm"), like the Catalog row beneath it.

### Implementation notes — Import from file (`KB-314`, 10 Oct 2026; D68)

- **Button "Import from file"** beside "Add from ready catalog"; online only (same note when offline). The sheet is an overlay (Android back closes it;
  an app update never reloads under it - D67).
- **Pick** a `.xlsx` or `.csv` (first row = column names; Name, Price, Unit needed; Category, Aliases, SKU, Barcode optional) or **Download sample CSV**.
  A file that cannot be read says why - not UTF-8 ("save as CSV UTF-8 or .xlsx"), an old `.xls`, over 5 MB or 5,000 rows, no rows below the header.
- **Preview:** the column for each field in a dropdown (found by header name; changeable; a missing required column says which, nothing is guessed),
  then **"N to add · M already in your shop · K problems"**, the units found (an unknown one flagged), then lists - Problems (line + reason), Already in
  your shop (shop price beside the file's, "Not changed"), To add, Aliases left out - each the first 20 and "…and N more". **Add N products** is
  absent when nothing is new and disabled offline.
- **While it runs:** "Adding 200 of 445…" and nothing else can be pressed. **Result:** "Added N · already there M · failed K"; a run that stopped says
  so and that running it again skips what is already in.

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
  `142` or an old `KB-000142`, "14" doesn't; the words bill / बिल / no / no. / नं. / number are ignored, so "bill 142" works; a fallback number like `7F2A91-1` has no sequence), the exact total in paise ("112.50", "112.5"), a date `dd-mm` / `dd-mm-yyyy` with `-` `/`
  or `.` and single digits ("4/10"), or an item name; Devanagari digits read as 0–9. **Never the customer's mobile.**
- **Row:** the number with its label (**"Bill 59"** / "बिल 59"; an old one "Bill KB-000059" - `KB-341`, D87), time, the name unless Cash, the total, "Not synced" while pending, and a text tag **"Cancelled"** (`KB-325`; never colour alone). Grouped Today /
  Yesterday / `dd-mm-yyyy`. No item count (owner: no schema change).
- **S6 bill detail:** the read-only receipt (`Receipt.tsx`) and the four share buttons (`ShareBar.tsx`, D58); **Cancel bill** below them (`KB-325`, next section).

### Implementation notes - cancel and reissue (`KB-325`, 14 Oct 2026; D79)

- **Cancel bill** (a saved bill, 44 px) opens a sheet: **"Cancel Bill 142?"**, "The bill stays in History, marked Cancelled. Its number is not used again. This cannot be undone.", **five reason chips** (Wrong item - Wrong price - Wrong quantity - Customer cancelled - Other; nothing to type), and **Cancel and make a new bill** / **Cancel only** (both wait for a reason) / **Keep the bill**. It is irreversible and not mid-bill, so a confirm step is right (hard rule 6 is about questions *during* a bill). Works offline - it only writes this phone's database - and reaches the other phones on the next sync cycle.
- **Cancel and make a new bill:** the stored bill's lines (qty, unit, rate with its own unit, total, price type - exactly as stored, nothing re-priced or filled in) and its customer become a **new draft** under the id the cancellation points to; History closes and the billing screen opens on it. It goes through the ordinary Bill Banao (flags re-derived; a line with no price still says "Price needed"). It takes the **next receipt number**; a cancelled number is never reused. Every reissued line is a manual line, so it teaches no alias a second time. **Off while a bill is in progress** ("A bill is in progress - finish it or clear it first to make the new bill.") - it would have to replace it; Cancel only still works. If the draft is abandoned the cancelled bill reads "No replacement bill made".
- **A cancelled bill:** the receipt carries a **CANCELLED** line on the screen, the image / PDF and the WhatsApp / SMS text (hi: "रद्द", both: "रद्द / CANCELLED"), with the same lines and total - it is never shown or shared as if valid; the four share buttons stay. Below it a card: "Cancelled - Wrong price", the date, and **"Replaced by Bill KB-000143"** (tap to open) or "No replacement bill made". The new bill says **"Replaces Bill KB-000142"** (tap to open) - **and prints it on its receipt too** (SG-13, D57 amended: one small muted line under the bill number, in the screen, image / PDF, WhatsApp and SMS renderings) - found by looking the cancellations up by its own id; no bills column. The reason is internal: not printed on the receipt, shown only as the preset label.
- **Sync honesty:** while the cancellation has not reached the server the card says "Will reach your other phones when this one is online". For a bill whose own push is in permanent conflict (the server refused it, so it is not there to cancel) it says **"This bill couldn't be saved to the server, so its cancellation is on this phone only."** - the bill stays in conflict, still counted by the sync chip.

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
Bill No. 142
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
- **Bill numbers with several devices (D73, D74):** each device draws its own block of 50, so numbers can interleave in time (`12` may be issued after `61` by another device). **Plain numbers (`KB-341`, D87):** `59`, no prefix, no padding; old bills keep `KB-000059`; the rare offline fallback is `7F2A91-1` (a 6-character device code + a counter). They **never repeat** and a number never changes after it is issued.
- Share (`KB-309`, D58 — the legacy behaviour): four buttons under the saved receipt — **Image**, **PDF**,
  **WhatsApp**, **SMS**.

### Implementation notes — share (`KB-309`, 4 Oct 2026)

- **One source:** `domain/receipt.ts` → `domain/receiptLayout.ts` (the D57 layout as drawing steps, pure, the text
  measurer injected) → `ui/receiptImage.ts` draws them on a canvas with `fillText` (no HTML): a **PNG at 2x, 768 px
  wide**, and the same pixels as a JPEG inside our own **one-page PDF** (`ui/onePagePdf.ts`, no dependency) **58 mm
  wide** (164.41 pt). A typical bill: PNG ≈ 80–105 kB, PDF ≈ 75–100 kB. Rendered **when the receipt is shown**, every
  Plex / Mukta face loaded first with the receipt's actual strings.
- **Image** and **PDF** always **download** (`Bill-142.png` / `.pdf`) — desktop and phone, no share sheet.
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

## 6b. S7 — Settings

Shop details, receipt language, developer mode.

### Implementation notes — Settings (`KB-312`, 8 Oct 2026; D64)

- **Opens from the ≡ menu**, over the bill in progress; Back / Android back closes it.
- **Shop details: name and phone only** (owner, Q1). They print on every receipt. Name: required, 60 characters. Phone:
  optional, **an Indian mobile — 10 digits starting 6-9** (the customer-mobile rule); a **leading 0 is refused** ("Enter
  the 10-digit mobile number without a leading 0 …") because the shared parser would read the landline `0712-2345678`
  as the mobile 7122345678 — landlines with an STD code: NI-39. Address (printed nowhere — NI-36), the logo (`KB-327`)
  and the receipt prefix (changing it mid-run would mix prefixes in one shop's numbering) are not editable here.
- **Local first, works offline:** Save writes this phone's shop row as pending and the ordinary sync pushes it (D64).
  "Saved" online; "Saved on this phone — it will sync when you're online" offline. Save does nothing until something
  changed. An edit that arrives from the server while Settings is open appears — except in a field being typed in.
- **Receipt language:** English / हिन्दी / Both — what the CUSTOMER's receipt is printed in (not the screen's language,
  `KI-59`). Saves at once. **A receipt opened from History is built from today's shop name, phone and language** (owner,
  Q4): changing them changes how a past bill looks when reopened; the bill itself (numbers, items, total) never changes.
- **Developer mode** (08 §9): a visible, collapsed section. This shop's **learned aliases** (alias → product, times seen,
  confidence), **provisional products** (said N times) and **price suggestions**, read-only — nothing here applies
  anything. **Reset learning** asks first: "Clear what the app has learned on this phone? Your bills and catalog are not
  touched. The server keeps its copy." The reset is **local-only** (NI-27) and the result says so: "Cleared on this
  phone: N learned aliases, N provisional products, N price records. The server's copy was not deleted." It writes a
  `learning_reset` event that now reaches the server (KI-37, `bill_id` null) — `KB-326` must honour it.

---

## 7. Offline UI

| State | Treatment |
|---|---|
| Offline | Small grey chip in the header: "Offline" |
| Offline, billing | Everything works. No dialogs, no nags. |
| Syncing | Chip: "Syncing…" — only while a cycle runs and something is waiting |
| Sync failing | Amber chip "Sync failing", tappable for detail. **Never blocks billing.** |
| No live session (offline-session mode, D38) | Chip: "Not syncing — sign in again" |

**Never** a full-screen "no internet" state. The shop keeps running when the wifi doesn't.

### Implementation notes — offline UI (`KB-313`, 9 Oct 2026; D65)

- **The chip** sits in the header beside the title (it wraps to two lines at 320 px, never overflows). Grey "Offline" and "Syncing…" and the
  amber-outlined "Not syncing — sign in again" are plain text; **"Sync failing" is a button** (3 failures in a row, or a bill in a permanent
  conflict) opening a small detail: bills waiting, bills that couldn't be saved ("They stay on this phone."), last attempt, "Billing continues."
- **The half-built bill survives** a reload, the tab being killed, or a crash — kept in the user's own database, restored exactly as left,
  never re-priced, never twice (a bill already finalised is dropped). **≡ → Clear bill** (only with lines, behind a confirmation) throws it away
  and teaches nothing.
- **Sign out** with unsynced bills asks first (16 §2): the count, a separate line for bills that won't sync on their own, "Sign out anyway".
- **The loop is quiet offline** (NI-38): no requests, no timer; the `online` event resumes it. Voice already says "Offline — voice needs internet".

---

## 8. Non-negotiable UI rules

1. **No modal ever stands between the mic and the receipt.**
2. **No question is asked mid-bill.** Customer defaults to "Cash".
3. **Unknown products are added and flagged**, never refused.
4. **Voice failure always falls back to search**, never to a dead end. **Built (`KB-331`, D76):** every failure message (mic denied, no mic, unsupported, interrupted, silent recording, network, timeout, rate limit, busy, session, server, "Couldn't read the items", "Couldn't find an item") and every "Not added" entry has an **Add by hand** button; the mic stays usable and Add item stays on screen. Offline shows its plain reason line (Add item sits right under it).
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

> **Baseline note (`KB-404`, D80):** `?try=` dev bills have no voice turn, so Pilot numbers counts them as hand-only "typing" bills. Harmless for a fresh pilot shop; the owner's own dev shop's typing median is polluted by them.

| Action | Budget |
|---|---|
| Keystroke → search results | **Lookup ≤ 16 ms; keystroke → visible results ≤ 50 ms median** on a realistic catalog (`07-DECISIONS.md` D51, superseding the single < 16 ms; real phone 3 Oct 2026: lookup p95 0.50 ms at 481 products, 11.2 ms at 10,101) |
| Tap mic → listening | **Cold (first) tap ≤ 1 s; warm taps (within 60 s of the last) < 100 ms** — never shown before recording has actually started (`07-DECISIONS.md` D49, superseding D45's 300 ms cold budget; measured 30 Sep 2026 with the warm mic: warm 52–61 ms, cold 816 ms = getUserMedia 709 + recorder 106) |
| Stop → transcript shown | < 1.5 s. **Watch (owner, 18 Oct 2026, `KB-404` check):** localhost median 4.2 s / p95 5.2 s, inflated by `netlify dev` (~1 s per `/voice` call) - measure on the phone in the release-draft session; a ticket only if still over. |
| Fast-path item on screen | < 300 ms after transcript |
| LLM-path item on screen | < 4 s after transcript |
| Finalise → receipt shown | < 500 ms (local write, sync is background) |
| App cold start | < 2 s. **Watch (18 Oct 2026):** the localhost p95 of 27 s is dev-server first loads - the phone session gives the real figure. |
| History (S5) at 40,000 bills — **open** (newest 200) | **≤ 300 ms** on the phone (D61; owner, 7 Oct 2026). Measured 7 Oct 2026, `/__dev/history`: phone (Android 10, Chrome 152) 234 / 72 / 62 ms; laptop over the LAN 35 / 11 / 10 ms |
| History — **90-day search load** (≈ 9,000 bills; background) | **≤ 2 s** on the phone. Phone 1,624 / 1,187 / 1,145 ms; laptop 278 / 230 / 229 ms |
| History — **"Search older bills"** (all 40,000) | **≤ 6 s** on the phone, with "Loading older bills…" shown meanwhile. Phone 4,540 / 3,825 ms; laptop 1,072 / 1,031 ms |
| History — **keystroke → results** | **≤ 50 ms** (D51). Over 9,000: phone median 4.8 · p95 6.9 · max 14.7 ms (laptop 0.8 / 1.3 / 2.8). Over 40,000: phone median 14.1 · p95 16.4 · max 17.3 ms (laptop 5.0 / 6.2 / 7.0) |
