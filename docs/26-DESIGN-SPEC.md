# 26 — Design specification: the KiranaBill Android app (Phase A redesign)

Status: APPROVED by the owner (Ansh), 11 Nov 2026. Source of truth for every screen, colour, font, component and animation in the Phase A app.
Visual reference: `docs/design/` — the 26 approved screens as HTML files (open in a browser at 390 x 844), the logo SVGs, and `canvas.json` (layout and names). When this document and a screen file disagree, ask the owner; do not guess. **The owner's rulings (§0b) come first.**
Related: D101 (record-review-generate), D102 (names as said), D103 (units as said), D105 (Devanagari names, recordings 7 days), D106 (ear mis-hearings counted apart), D108 (Sarvam later), D109 (Phase A before F), `24-ROADMAP.md` Phase A, `25-V3-VOICE-DESIGN.md`.

---

## 0. What this document is and is not

- It defines **how the app looks and behaves** on screen. It does **not** change any billing, number-safety, sync, RLS, backup or voice rule. Every rule in `25-V3-VOICE-DESIGN.md`, D102-D108 and the hard rules in CLAUDE.md stays exactly as it is. If a screen here seems to need a rule change, stop and ask.
- Some screens show **features the app does not have yet**. They are listed in section 9 and need their own tickets (and a decision record where money is involved) before they are built. Do not build them silently as part of "the redesign".
- Platform: the existing React 19 + Tailwind 4 + lucide-react code, wrapped for Android with Capacitor (D100/SD-008). **The same look is used by the Android app, the PWA and desktop (§0b item 11).** Design width 390 dp; must work from 360 dp to 430 dp and with system font scaling up to 130%.

## 0b. The owner's rulings (12 Nov 2026, D110 item 8) - they override anything below and any screen file

- **General rule:** **The design (`26` + `docs/design/`) decides the LOOK. The app's real data, rules, units, options and wording decide the CONTENT.** Where a screen's sample content differs from the app (units "piece" / "packet", not "pc" / "pkt"; the 5 cancel reasons; the real receipt; the real learning behaviour), the app wins. When unsure, ask the owner - never copy sample content blindly, never drop a real feature to match a picture.
1. **`26` supersedes `13-DESIGN.md` and the look parts of `05-FRONTEND-SPEC.md`.** Both are marked; their non-visual rules stay binding.
2. **Fonts approved:** Inter, Noto Sans Devanagari, and IBM Plex Mono (receipt only), all bundled locally; Mukta goes. The dependency gate applies (exact versions, at least two weeks old).
3. **Learning wording must be true:** "It learns your prices. After a few bills it suggests your price; approve it once, and it fills in from then on." Onboarding 3 and screen 20 use this when built. Hard rule 7 is unchanged.
4. **Cancel keeps today's 5 reasons, one required (D79).** The design's chips are only the look.
5. **Screen 9 says "Saved on this phone when you stop"** (true today).
6. **Printing: 80 mm prints exactly like today's bill** (the Bill 514 table: Item / Qty / Rate / Amt); **58 mm uses the same table fitted to 32 characters**; names wrap, never cut. The two-line layout drawn on screens 18 and 21 is not used.
7. **"Item names on bill: as spoken" = D102 / D105**; `KB-377` decides the script detail.
8. **Price needed entry follows today's app** (rate or amount, clearly labelled).
9. **More shows only "Sync"** with the phone's real sync state - never a per-shop "Backup" status.
10. **Any bill can be reprinted any time; the printed copy carries a "REPRINT" line** (`KB-408`).
11. **The new look is for EVERYONE:** the Android app, the PWA and desktop. For now desktop shows the phone layout centred (max about 480 px); a desktop layout is a later ticket.
12. **Every colour used in `docs/design/` is in the token table** (`26` §2.1); screen files are named `docs/design/screens/NN-Name.html`.

## 1. Principles (apply to every screen)

1. **One job per screen, one main button.** Secondary actions are visibly lighter (outline or text). Never two equal full-width blue buttons stacked.
2. **Very little text.** A title, at most one short helper line. One language at a time (the user's app language). Never English and Hindi side by side as labels.
3. **Item names exactly as spoken, in Devanagari** (D102, D105). Brands written as they sound (रिन, लाइज़ॉल). The catalog never renames a line.
4. **Honest states only.** No fake progress stages, no confidence percentages, no invented data. Waiting screens may animate, but text must be true ("Reading your order… 12 s").
5. **Every number traceable.** Prices our code filled are marked ("your price", "price said earlier"); unresolved lines are amber ("Price needed") and lock Bill Banao.
6. **Every error ends in an action**: Retry (same recording) or Add by hand / Type instead. No dead ends.
7. **Premium and real, not "AI-generated"**: real Hindi item names and rupee amounts in examples, the real receipt style, restrained colour, purposeful motion.
8. **Fast on cheap phones.** Target: smooth on a Redmi 9 Power (Android 12). Animate only `transform` and `opacity`. No blur filters on large areas, no heavy shadows on long lists.
9. **Touch targets at least 48 dp** (44 dp absolute minimum for icon buttons in dense rows). Large readable text.

## 2. Design tokens

Define all tokens once (CSS variables + Tailwind theme). Never hard-code a colour in a component.

### 2.1 Colour

| Token | Hex | Use |
|---|---|---|
| `--kb-primary` | `#2563D9` | Main buttons, active tab, links, selected chips, mic button, focus ring |
| `--kb-primary-deep` | `#1F4FA3` | Pressed state of primary; gradient end on splash |
| `--kb-primary-pale` | `#EAF2FF` | Selected surfaces, icon tiles, info banners, active-tab pill |
| `--kb-bg` | `#FAF8F3` | App background (warm). Never use pure white as a page background |
| `--kb-card` | `#FFFFFF` | Cards, sheets, fields, bill lines, bottom bar |
| `--kb-muted` | `#F4F1EA` | Secondary surfaces, segmented-control track, item initials tile |
| `--kb-ink` | `#263238` | Headings, item names, amounts |
| `--kb-sub` | `#5F6A74` | Secondary text and metadata (darkened from #68737D for contrast) |
| `--kb-border` | `#E7E1D8` | Borders and dividers |
| `--kb-amber` | `#D69A35` | Small accents only: dots, tip icons, sparkles. **Never text** (fails contrast) |
| `--kb-warn-bg` | `#FFF3D8` | Price needed rows, tips, unfinished-bill card |
| `--kb-warn-text` | `#80520B` | Text and icons on `--kb-warn-bg` |
| `--kb-warn-border` | `#EBC877` | Border of a Price needed row |
| `--kb-ok` | `#2E7D52` | Saved / connected / success only (with icon or text) |
| `--kb-ok-pale` | `#E7F3EC` | Success icon backgrounds |
| `--kb-err` | `#C0392B` | Destructive and error only (Cancel bill, Sign out, Recording chip) |
| `--kb-err-pale` | `#FDECEA` | Background of error chips |
| `--kb-disabled-bg` | `#DCE3EE` | Locked Bill Banao |
| `--kb-disabled-text` | `#4E5A66` | Text on locked button |
| `--kb-receipt-rule` | `#C9C2B8` | Dashed lines inside the receipt |
| `--kb-receipt-strong` | `#4B5560` | Receipt: the header rule and the Qty column text |
| `--kb-receipt-sub` | `#6B7580` | Receipt: secondary text (detail lines) |
| `--kb-receipt-row` | `#ECE8E1` | Receipt: the light divider between rows |
| `--kb-shimmer` | `#EFEBE3` | Placeholder lines and their dividers while waiting |
| `--kb-shimmer-hi` | `#F8F6F1` | The moving highlight of the shimmer |
| `--kb-warm-end` | `#F5F0E6` | End of the pale-blue -> warm gradient (illustration panels) |
| `--kb-primary-line` | `#CFDDF7` | Border of pale-blue cards and banners |
| `--kb-chart-bar` | `#C9D8F5` | The 7-day mini chart's bars (Bills) |
| `--kb-spinner-track` | `#BFD0F2` | The track of a small spinner |
| `--kb-wave-played` | `#B9CDF3` | Waveform bars in playback |
| `--kb-toggle-off` | `#CFC8BD` | A toggle that is off |
| `--kb-handle` | `#D5CEC3` | A bottom sheet's grab handle |
| `--kb-slot` | `#DCD5CA` | The paper slot on the waiting screen |
| `--kb-warn-field` | `#E3C47E` | Border of the inline price field on a Price needed line |
| `--kb-splash-1`, `--kb-splash-2` | `#5A93F2`, `#3B78E6` | The splash gradient (with `--kb-primary` as its end) |

Not UI tokens: `#FFC72C` / `#1F3A75` live only in the logo SVGs; `#4285F4` `#34A853` `#FBBC05` `#EA4335` only in Google's sign-in mark; `#E9E6DF` is the design board's background around each screen, not part of the app.

Contrast rules: `--kb-sub` text only on `--kb-card` or `--kb-bg` (not on `--kb-muted` at small sizes). White text on `--kb-primary` is fine (about 5:1). Amber is never used for text. Green and red always come with an icon or a word, never colour alone.

Distinct from the competitor: no blue-filled headers or top bars, no all-white pages. The warm background, white cards and amber accents carry the identity.

### 2.2 Typography

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Hero title (onboarding, sign-in) | Inter | 28-30 / 800, letter-spacing -0.5 | |
| Screen title (tab screens) | Inter | 26 / 800 | Bills, Items, More |
| Top-bar title (inner screens) | Inter | 18 / 700 | |
| Section title | Inter | 16 / 800 | "Recent bills" |
| Body | Inter | 15-16 / 400-600 | |
| Item name on bill lines | Noto Sans Devanagari | 17 / 600 | |
| Amounts | Inter | 16-17 / 800; totals 28-30 / 800 | tabular numbers |
| Metadata | Inter | 13 / 400-600 | `--kb-sub` |
| Group label | Inter | 12 / 700, letter-spacing 0.5, UPPERCASE | "BILLING", "PAPER SIZE" |
| Timer (recording) | Inter | 64 / 800, letter-spacing -2, tabular | |
| **Receipt only** | IBM Plex Mono + Noto Sans Devanagari fallback | 11-13 | Matches today's printed bill (Bill 514) |

Font stack: `'Inter', 'Noto Sans Devanagari', sans-serif`. **Bundle the font files inside the app** (Inter 400/500/600/700/800, IBM Plex Mono 400/700, Noto Sans Devanagari 400/600/700). No Google Fonts CDN at runtime: the app must look right offline.

### 2.3 Spacing, radius, elevation

- Spacing scale (dp): 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28. Page side padding 16-20; gaps between cards 10-14.
- Radius: fields and small buttons 12-14; buttons 16; cards 16-18; hero card 22-26; illustration panels 30; bottom sheet top 28; chips and pills 999.
- Elevation (use sparingly):
  - `shadow-1`: `0 6px 16px rgba(38,50,56,.04-.06)` cards that float (shop card, hero card)
  - `shadow-2`: `0 10px 22px rgba(38,50,56,.10)` receipts
  - `shadow-primary`: `0 8px 18px rgba(37,99,217,.25)` primary buttons; mic `0 12px 26px rgba(37,99,217,.32)`
  - Lists and bill lines: border only, no shadow.

### 2.4 Icons

lucide-react (already in the app), stroke width 1.9, sizes 18 / 20 / 22 / 24. Every list row and action button carries an icon. Mapping used in the design: Mic, Pause, Square (stop), Play, RotateCcw (re-record / redo), Keyboard (type), Printer, MessageCircle or the WhatsApp mark (share on WhatsApp), FileText (PDF), Share2, ReceiptText (bill), Home, Package (items), MoreHorizontal, ChevronRight, ChevronLeft (back), Plus, Minus, Check, X, Pencil (edit), TriangleAlert (warning / price needed), Lightbulb (tips), Sparkles (learned / your price), Bluetooth, RefreshCw, WifiOff, Cloud, ShieldCheck, Languages, CircleHelp, LogOut, Store, Phone (smartphone), Ear (Heard).

## 3. Motion

All motion uses `transform` / `opacity` only. Every animation is switched off when the phone has "Remove animations" / reduced motion on (`prefers-reduced-motion: reduce`): the end state shows instantly.

| Name | What | Timing |
|---|---|---|
| Rise in | Titles and text blocks fade up 16 px on screen enter, staggered 0 / 120 / 240 ms | 600 ms, cubic-bezier(.2,.7,.2,1) |
| Mic pulse | A ring behind the mic scales 1 → 1.6 and fades | 1.9 s ease-out, infinite (Home idle, Recording) |
| Sound bars | Waveform bars scaleY .35 ↔ 1, staggered | 1.1 s ease-in-out, infinite, only while recording |
| Recording dot | Red dot blinks | 1.2 s |
| Float | Illustrations drift 6-7 px up and down | 4.5 s ease-in-out, infinite (onboarding only) |
| Twinkle | Small amber sparkles fade and scale | 2.6 s (onboarding, splash only; max 2-3 per screen) |
| Receipt print | The receipt grows from 0 height out of a paper slot | 2.4 s ease-out (waiting screen); 1.2 s on Bill saved |
| Shimmer | Grey placeholder lines shimmer while waiting | 1.4 s linear, infinite |
| Lines slide in | Bill lines enter one by one from the left (14 px), 100 ms apart | 450 ms each |
| Tick pop | Success circle scales .4 → 1.08 → 1 | 600 ms, cubic-bezier(.2,.8,.2,1.2) |
| Sheet | Bottom sheets slide up 40 px and fade in; backdrop fades | 400 ms |
| Press | Buttons scale to .97 on press | 100 ms |
| Tab change | Active pill fades in behind the icon | 200 ms |

Performance budget: no dropped frames on the Redmi 9 Power for the mic pulse, lines sliding in and sheets. Long lists (Bills, Items) animate nothing per row.

## 4. Logo and app icon

- Source: the owner's existing icon (tilted white bill with lines, mic badge). Only colours change.
- Variants (in `docs/design/`):
  - `logo-blue2.svg` — **main**: tile `#2563D9`, bill outline `#1F4FA3`, bill marks `#263238`, mic badge **bright yellow `#FFC72C`** with the mic drawn in navy `#1F3A75` (white is invisible on yellow), badge ring `#2563D9`.
  - `logo-light.svg` — for the blue splash: white tile, bill outline `#2563D9`, mic badge `#2563D9` with white mic.
- In the UI: rounded square, radius ≈ 22% of size. Sizes: 42 (home / first-day header), 52 (More shop card), 76 (sign-in hero), 92 (splash).
- Android app icon: adaptive icon from `logo-blue2.svg` (foreground = bill + badge, background = `#2563D9`); monochrome layer for themed icons. Splash (Android 12 SplashScreen API): icon on `#2563D9`, then the app's own splash screen (screen 1).

## 5. Components

Build each once as a reusable component; screens only compose them.

- **Button / primary**: `--kb-primary`, white 16 / 700, height 54-56, radius 16, `shadow-primary`, optional left icon 20. Pressed: `--kb-primary-deep`.
- **Button / secondary**: white card, 1 px `--kb-border`, ink text 15 / 700, height 50-54, radius 14.
- **Button / tertiary**: text only, `--kb-sub` or primary colour, height 46-48.
- **Button / destructive**: `--kb-err` fill (inside the cancel sheet) or red text (Sign out, "Cancel & make a corrected bill").
- **Button / locked**: `--kb-disabled-bg`, `--kb-disabled-text`, lock icon, used for Bill Banao while checks are pending. It must say why on the line above ("1 item needs a price").
- **Top bar (inner screens)**: back chevron button 44 x 44, title 18 / 700, optional right badge (Draft / Saved / Almost done). No coloured background.
- **Screen title (tab screens)**: 26 / 800 with optional right action (Items: "+ Add").
- **Bottom navigation**: Home, Bills, Items, More. White bar, top border, 58 dp items, icon 22 + label 12. Active: primary colour, label 700, pale-blue pill behind the icon.
- **Search field**: white, 50 dp, radius 14, search icon, placeholder in `--kb-sub`.
- **Filter chips**: 38 dp pills; selected = primary fill + white text; others white with border. Horizontal, no wrap.
- **Segmented control** (paper size): `--kb-muted` track, selected segment white with `shadow` 0 2 6, 46 dp.
- **Toggle**: 52 x 30, on = primary, off = `#CFC8BD`, white 24 dp knob. Whole row is tappable; label 15 / 600 with optional 13 sub-line.
- **Stepper** (copies): − value +, 40 dp square buttons.
- **Text field**: label above (14 / 600), 52-54 dp box, radius 14, optional leading icon or prefix (₹, +91), helper line below (13, sub). Focus: 1.5 px primary border + 4 px `rgba(37,99,217,.10)` ring.
- **Removable chip** (other names): pale-blue pill with × button; "+ Add name" dashed pill.
- **List row**: icon tile 38-42 (pale blue + primary icon), title 15 / 600-700, sub 13, right value or chevron, min height 60, divider between rows inside one card.
- **Bill card (Bills list)**: icon tile, "Bill 514", "1:02 pm · 38 items", amount 16 / 800, and a separate 42 dp print button. Cancelled: muted tile, red "Cancelled" chip, amount struck through.
- **Bill line (draft)**: white card radius 16; name 17 / 600 Devanagari; detail line "2 kg × ₹45" 14 sub; amount 17 / 800; 40 dp edit button. Optional marker chip (pale blue, Sparkles 11): **"your price"** (shop price filled) or **"price said earlier"** (repeat, D106 item 3).
- **Price needed line**: `--kb-warn-bg`, 1.5 px `--kb-warn-border`, TriangleAlert + "Price needed" in `--kb-warn-text`, an inline ₹ price field and an "Add" button - rate or amount, clearly labelled, as the app does today (§0b item 8). Counts as a pending check.
- **Heard card**: Ear icon, "Heard:" + the transcript (13, sub, 2 lines then expand chevron). Shown for every recording (KB-385 rule).
- **Receipt** (the real bill look, from Bill 514): white paper, mono font, centred shop name 15-17 / 700 letter-spacing .5, date line, dashed rule, "Bill No. **514**", dashed rule, header row Item / Qty / Rate / Amt (bold, 2 px bottom rule), rows with light dividers, Amt bold, rate "—" when unknown, dashed rule, TOTAL bold, dashed rule, "Thank You!" centred. Zig-zag torn bottom edge on screen. **The printed bill keeps exactly this content**; only the width adapts (58 mm ≈ 32 characters, 80 mm ≈ 48 characters; long names wrap, never cut). A reprint adds a "REPRINT" line (§0b items 6, 10).
- **Mic button**: 112-114 dp primary circle, white Mic 46-48, inside a 138 dp tap area with the pulse ring. On Recording: 132 dp inside a 210 dp pale circle.
- **Waveform**: 5 dp bars, radius 3, primary (live) or `#B9CDF3` (playback).
- **Tip card**: Lightbulb amber icon; warm variant (`--kb-warn-bg` + warn text, "DID YOU KNOW") or white card variant.
- **Banners**: info (pale blue + primary icon), warning (warn bg), offline strip (ink background, white text, full width at top: "No internet · billing still works").
- **Status badges**: Saved (ok pale + Check), Draft · not saved (muted), Recording (err pale + blinking dot), Almost done (pale blue), Required / For printing (muted small).
- **Bottom sheet**: `--kb-bg`, radius 28 top, 44 x 5 grab handle, backdrop `rgba(38,50,56,.45)`.
- **Empty and first-use states**: a friendly hero card with one action, never an empty grey page.

## 6. Navigation

- Tabs: Home · Bills · Items · More (bottom bar on these four only).
- Inner screens use the top bar with back. Android back button = top-bar back; on a draft bill it never discards the draft (the draft is kept, as today).
- Record flow (Recording → Check recording → Making your bill → Review bill) is full-screen without the bottom bar.
- Sheets for small tasks: cancel bill, edit a line, add price, choose unit.

## 7. Screens

Numbers match the canvas and the files in `docs/design/screens/` (file name in brackets; `canvas.json` still uses the old `Name.dc.html` names). "Today" = what the app already does; "New" = see section 9.

### First-time flow
1. **Splash** (`screens/01-Main.html`) — Full-screen soft blue gradient (`#5A93F2` → `#3B78E6` → `#2563D9`, 170°), two faint circles, 2 sparkles, light logo 92, "KiranaBill" 36 / 800 white, "Speak the order. Get the bill." 18 / 600, two glass chips (Hindi · Hinglish, 58 / 80 mm), white "Get started" button with blue text, "Made for kirana shops in India". Shown once per install (returning users go straight to Home).
2-4. **Onboarding 1-3** (`screens/02-Onboarding.html`, `03-Onboarding.html`, `04-Onboarding.html`) — "1 of 3" + Skip at top; a large illustration panel (440 dp, radius 30, pale-blue → warm gradient, two soft circles, sparkles); dots; title 30 / 800; one line of text; primary button at the bottom (Next / Get started).
   - 1 "Speak the whole order": speech bubble with a real order in Devanagari, mic with pulse, sound bars both sides.
   - 2 "Get a clear bill": the real receipt (3 lines) with floating Print and WhatsApp chips.
   - 3 "It remembers your prices": "Today you said चीनी 45 रुपये किलो" → "Next time, just say 2 किलो चीनी" → ₹90 with badge "Your price ₹45/kg · remembered". Wording: §0b item 3 (true to the learning engine).
5. **Sign in** (`screens/05-SignIn.html`) — Hero panel (300 dp) with logo, "KiranaBill", Speak / Bill / Print chips; "Sign in to your shop"; "One tap. No password to remember."; three trust rows (Bills saved safely to your shop / Bill from more than one phone / We never post to your Google account); "Continue with Google" (white button, Google mark); privacy link. Today: Google sign-in (phone OTP later, parked).
6. **Shop setup** (`screens/06-ShopSetup.html`) — "Almost done" badge; shop name field (focused, store icon); phone (+91, optional, "printed on bills"); "YOUR BILL WILL LOOK LIKE THIS" with a live receipt preview using the typed name (Bill No. 1); Continue.
7. **Permissions** (`screens/07-Permissions.html`) — Mic ↔ printer illustration; "Two quick permissions"; two cards: Microphone (Required) and Nearby devices (For printing); "Allow" triggers Android's own prompts one after another; "Not now".
8. **Home** (`screens/08-Home.html`) — Logo 42 + "Good morning" + shop name, profile button. Hero record card (gradient white → pale blue, radius 26): "Ready for the next order", mic button with pulse, "Tap to record · pause any time", two buttons: Type items / Reprint last. Two stat cards: Today's bills, Today's sales (New). Recent bills (2 rows, See all). Bottom bar.
26. **Home · first day** (`screens/26-FirstDay.html`) — Same header; hero "Make your first bill — say any order you know" with mic and an example order; "Get set up · 1 of 3" checklist (Shop details ✓, Connect your printer, Check your item prices). Replaces Home until the first bill is saved or the checklist is dismissed (New).

### Record → bill (D101; behaviour unchanged from KB-385)
9. **Recording** (`screens/09-Recording.html`) — Top bar "New voice bill"; red "Recording" chip with blinking dot; timer 64 / 800 "00:42" and "of 5:00"; big mic in a pale circle with pulse; live waveform; tip "Say item · quantity · price. Pause if a customer talks."; Pause (secondary) + Stop (primary, wider); "Saved on this phone when you stop" (ok colour; §0b item 5). Paused: timer holds, chip becomes "Paused", Pause becomes Resume. 4:30 one-line warning; auto-stop at 5:00.
10. **Check recording** (`screens/10-Review.html`) — Card with tick pop, "Recording ready", "0:42 · saved on this phone", play bar with waveform and times; note "Listen once if the shop was noisy… nothing is lost"; Generate bill (primary with Sparkles); Re-record / Type instead.
11. **Making your bill** (`screens/11-Generating.html`) — The waiting screen. Paper slot bar; a receipt printing downward in the real style with the shop name and shimmering placeholder rows; "Reading your order…" + elapsed seconds "· long orders take a little longer" (true); a warm "DID YOU KNOW" tip that rotates every ~6 s among 3-4 true tips (price memory, pause, Retry never re-speaks…); "Recording safe on this phone"; "Add items by hand meanwhile". No fake stages. Fails → screen 23. Offline → screen 24.
12. **Review bill** (`screens/12-BillReview.html`) — Top bar "New bill" + "Draft · not saved"; Heard card; lines slide in one by one; marker chips on filled prices; a Price needed line with inline price entry; dashed "Add item"; sticky bottom panel: "Total so far · N items", amber "1 item needs a price", total 30 / 800; "More" (mic, add by voice) + Bill Banao (locked while any check is pending, primary when clear). All existing checks, warnings (Theek hai) and the BLOCK flag (KB-382) keep their current rules; Theek hai keeps its card style, BLOCK has no Theek hai button.
13. **Bill saved** (`screens/13-BillSaved.html`) — Tick pop (ok), "Bill 515 saved", "4 items · Cash · 1:18 pm"; the receipt prints out (1.2 s); Print bill (primary); WhatsApp / PDF / Share tiles; "Start a new bill". If "Print after Bill Banao" is on, printing starts automatically and the button shows progress.

### Bills, items, more, printer
14. **Bills** (`screens/14-BillsList.html`) — Title; search (bill number, item or amount); chips Today / Yesterday / This week / Pick dates; amber "Unfinished bill · N items · 1 price needed" card when a draft exists (New placement; the draft itself exists today); "Today · 12 bills · ₹8,450" card with a 7-day mini bar chart (New); bill cards with per-row print button; cancelled bills struck through. Bottom bar.
15. **Bill detail** (`screens/15-BillDetail.html`) — "Bill 514" + Saved badge; date · items · payment; the receipt (first ~7 rows + "Show all 38 items" + TOTAL); Reprint (primary); WhatsApp / PDF / Share; red text "Cancel & make a corrected bill" → screen 25. Today: cancel and reissue exist.
16. **Items** (`screens/16-Items.html`) — Title + "+ Add"; search ("items or what customers say"); chips All / Has price / Needs price / Learned; "N prices learned from your bills" banner → screen 20; one card list: initial tile, Devanagari name, English name + other names, "learned" chip, price per unit, or an amber "Add price" button.
17. **More** (`screens/17-More.html`) — Title; shop card (logo 52, name, phone · Edit shop details); BILLING group: Printer (status), Bill design, Items & prices; APP group: App language (value), Sync (the phone's real sync state; §0b item 9), Help & support, Privacy; Sign out (red, bordered). Bottom bar. Not drawn but required, same row/form pattern: Edit shop details, App language picker (English / हिन्दी / Hinglish), Help & support, Privacy page link, account deletion request.
18. **Printer** (`screens/18-Printer.html`) — Connected printer card (name, "Connected · Bluetooth" green dot, Change → screen 22); PAPER SIZE segmented 58 mm · 2 inch / 80 mm · 3 inch; toggles: Print after Bill Banao (New), Show shop phone; Copies stepper (New); live 58/80 mm receipt preview with "Long lines wrap so nothing is cut off"; Test print (primary). States: not connected (card says "No printer" + "Choose printer"), Bluetooth off (banner + "Turn on Bluetooth"), test print failed (warning banner + Retry).
19. **Add item** (`screens/19-AddItem.html`) — Name (focused); "Other names customers say" removable chips + "Add name"; Sold by segmented (kg / gram / litre / piece / packet); price per unit (₹ prefix, "Fills in when you don't say a price"); pack size optional; Save item. Edit item = same screen filled, plus Archive.
20. **Prices from your bills** (`screens/20-LearnedPrices.html`) — Helper line; one card per learned price ("You said ₹45 / kg · in 6 bills") with Use this price / Change; amber conflict card when two prices were heard (choose one; never auto-pick) (New presentation); "Use all N prices". Must follow the learning engine's real data; wording §0b item 3.
21. **Bill design** (`screens/21-BillDesign.html`) — Live receipt preview on a muted panel; shop name; address line (optional, New); thank-you note (New); toggle Show shop phone; "Item names on bill: As spoken"; Save.
22. **Choose printer** (`screens/22-PrinterSearch.html`) — Pulsing Bluetooth "Looking for printers…"; FOUND NEARBY list (paired printers first, with paper size if known) each with Connect; tip "Not listed? Pair it once in Bluetooth settings (PIN 0000 or 1234)"; Bluetooth settings / Search again. Must work with any ESC/POS Bluetooth printer (KB-408), not only the owner's.
23. **Couldn't read the order** (`screens/23-ReadFailed.html`) — Warning tile pops; "Couldn't read the order"; one true reason sentence (connection dropped / service busy / hourly limit / session expired → sign-in prompt); recording card "Saved on this phone"; Try again (same recording); Type instead / Record again.
24. **Offline** (`screens/24-Offline.html`) — Ink strip "No internet · billing still works"; pale-blue card "Order saved · will send when online" + small spinner; typing items still works; bottom panel "Waiting for 1 recording"; Bill Banao locked until the recording is billed or removed (existing rule).
25. **Cancel bill** (`screens/25-CancelBill.html`) — Sheet over Bill detail: "Cancel Bill 514?"; explanation (stays in history as cancelled; a corrected bill opens with the same items); the reason chips = today's 5 reasons, one required (D79; §0b item 4); "Why not just edit?" explanation; red "Cancel & make corrected bill"; "Keep Bill 514".

## 8. Copy and language

- Default UI language English; Hindi and Hinglish come from the existing message catalog (every new string gets all three; the catalog test enforces it).
- Item names are always shown as spoken (Devanagari), in every UI language.
- Tone: short, calm, helpful. Say what happened and what to do next. Never blame the shopkeeper.
- Numbers: ₹ with Indian grouping (₹2,216), quantities with the unit as said (D103).

## 9. New features shown in this design (need tickets before building)

Each item needs a ticket in 06/24; the ones touching money or bill content need a decision record first (D100 rule).

1. Today's bills / today's sales on Home, and the 7-day mini chart on Bills (owner approved the Home cards on 11 Nov 2026).
2. "Reprint last" on Home.
3. Print after Bill Banao (auto-print) and Copies (printing ticket KB-408).
4. Learned-prices review screen with the two-prices conflict choice.
5. ~~Cancel reason chips~~ - not new: today's 5 reasons stay (§0b item 4); only their look changes.
6. First-day Home with the setup checklist.
7. Address line and thank-you note on the bill (changes printed content: decision record first).
8. Unfinished-bill card on Bills.
9. Rotating true tips on the waiting screen.
10. Android-specific: splash, adaptive icon, permission pre-screen, printer search screen, offline strip.

## 10. How to build it (suggested order; each step its own PLAN)

1. Tokens + fonts (bundled) + icons + motion utilities + reduced-motion handling; no screen changes yet.
2. Core components (section 5) with a hidden dev gallery page showing every component and state, checked at 360 / 390 / 430 dp.
3. Record → bill screens (9-13, 23, 24) on top of the existing KB-385 logic (no logic change).
4. Tab screens: Home (8, 26), Bills (14, 15, 25), Items (16, 19, 20), More (17, 21).
5. First-time flow (1-7).
6. Printer screens (18, 22) together with the printing ticket (KB-408) on real printers (58 mm F2C BT-SRT-58, 80 mm KP307) and the Capacitor app.
7. New features from section 9, one ticket each, after their decisions.

## 11. Acceptance for every screen

- Matches the screen file in `docs/design/` (layout, colours, sizes, copy) at 390 dp; also checked at 360 dp and 430 dp and at 130% font size: nothing cut off, nothing overlapping.
- All touch targets at least 48 dp (44 for dense icon buttons).
- Works with reduced motion (end states only).
- Hindi and Hinglish strings present; Devanagari renders with the bundled fonts offline.
- No change to any test of billing, number safety, sync or voice behaviour; the full test suite stays green.
- Checked on the owner's phone (Redmi 9 Power) in the draft before release: smooth mic pulse, line slide-in and sheets.
