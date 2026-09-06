# 13 — Design

**Last updated:** 20 Aug 2026 (rev 2) · **Status:** Final for MVP · Validated against mockups

---

## 1. The brief, stated honestly

> "Clean, good colours, simple, attractive, innovative — not generic SaaS blue. Should feel properly
> Indian. Should not feel like an AI-generated app."

That last sentence is a real design constraint, so let's name what actually makes an interface look
AI-generated, because avoiding it is most of the job:

| Tell | Why it reads as generated |
|---|---|
| Purple→blue gradients | The default of every template since 2021 |
| Glassmorphism, frosted panels | Decoration with no function |
| Everything rounded, heavy drop shadows | Cards floating in space for no reason |
| Inter (or similar) everywhere | The typeface of "I didn't choose a typeface" |
| Emoji used as icons | 🛒💰📊 |
| Huge whitespace, centred hero layouts | Marketing-page instincts applied to a working tool |
| Five accent colours | No hierarchy, so nothing is emphasised |

**None of these appear in this product.**

---

## 2. Direction: a tool, not an app

A shopkeeper with four customers waiting is not browsing. They are operating an instrument, at
arm's length, in daylight, often one-handed.

The reference points are **the parchi and the khata** — printed matter, ink on paper, dense and
legible — not dashboards.

**Three principles:**

1. **Numbers have typographic priority over everything else.** This is the thesis made visual. The
   total is the largest thing on the screen. Rates and amounts are tabular figures so columns align
   and a wrong digit is visible.
2. **Density over air.** The whole bill fits on one screen without scrolling. Whitespace is not a
   virtue when the alternative is scrolling during a rush.
3. **Flat, bordered, printed.** Borders and rules, not shadows. Nothing floats.

---

## 3. Colour

Not saffron-and-green — that's a flag, not a palette. Drawn instead from what is actually in an
Indian grocery: turmeric, indigo dye, jute, terracotta, and the deep blue-black of shop signage ink.

```
INK          #1A1A1F   primary text, borders, the total
INK-SOFT     #5A5A66   secondary text, labels
PAPER        #FBF9F4   app background — warm off-white, never pure #FFF
SURFACE      #FFFFFF   rows, sheets, the receipt
LINE         #E4E0D6   borders and rules

INDIGO       #2C3E7B   primary action, focus, active mic
INDIGO-DEEP  #1E2B57   pressed states
TURMERIC     #E0A020   accent, badges, learned-product marker

DANGER       #B3261E   HIGH number flags — cannot finalise
WARN         #A16207   MEDIUM review badges
OK           #2E6B3E   confirmed, synced, success
MUTED        #9A9689   LOW flags, offline chip
```

**Why warm paper rather than pure white:** on a cheap LCD in daylight, pure white glares and the
whole UI reads as "web page." An off-white reads as paper and is easier on the eye across a long
day. It is one hex value and it does more for the "not generic" brief than any other single choice.

**Indigo, not blue.** SaaS blue is `#3B82F6`. Indigo `#2C3E7B` is darker, less saturated, and closer
to actual dyed cloth and signage ink. It sits next to turmeric without fighting it.

**Turmeric is used sparingly** — badges, the learned-product marker, small accents. Never a
background. It is the spice note, not the meal.

---

## 4. Typography

**A hard constraint the palette doesn't have:** the UI is Hindi/Devanagari and English, often in the
same line. Most fashionable typefaces have no Devanagari at all, and mismatched Latin/Devanagari
pairs are the single most visibly amateur thing an Indian app can do.

| Role | Typeface | Why |
|---|---|---|
| UI, all text | **Mukta** | Designed for Devanagari **and** Latin by the same designer, so they share proportions. Free, Google Fonts. Renders "बोलने के लिए दबाएं" and "Bill Banao" as one voice. |
| Numerals | **Mukta, tabular figures** (`font-variant-numeric: tabular-nums`) | Columns align. A misplaced digit becomes visible instead of hiding in ragged text. |
| Receipt | **IBM Plex Mono** | The parchi should look printed. Monospace does that with no decoration. |

*(Alternative if Mukta reads too light at small sizes: **Hind**, same designer, same Devanagari-first
logic, slightly sturdier.)*

**Scale** — deliberately compressed, because density matters more than expressiveness:

```
total        32px / 700 / tabular      the number read at arm's length
heading      20px / 600
body         15px / 400
label        13px / 500 / +0.02em
micro        11px / 500                flags, chips, timestamps
```

---

## 5. Layout

| Rule | |
|---|---|
| Touch targets | 44px minimum. One-handed, fast, sometimes wet hands. |
| Row height | 48px on mobile — tight vertical rhythm, generous tap area |
| Radius | 6px. Enough to not look brutal, not enough to look like a template. |
| Shadow | **None**, except sheets sliding over content (a single 1px line + 8% shadow) |
| Borders | 1px `LINE`. This is how separation is expressed. |
| Grid | 4px base unit |
| Max width | 720px on desktop — a bill is not a spreadsheet |

---

## 6. Where the design carries the product thesis

Design decisions that exist because of `01-PRD.md`, not because they look nice:

**The total is the largest element on screen.** 32px, tabular, ink. The shopkeeper checks it at a
glance before handing over the parchi.

**HIGH flags are sentences, not icons.** `⚠ Rate ₹6/kg — usually ₹52. Check?` in `DANGER`,
inline beneath the line. A warning triangle communicates "something" — a sentence communicates
*what*. This is the number-safety claim rendered.

**Flagged rows get a 3px left border**, not a background tint. Tinted rows become wallpaper; a hard
left edge scans down the list.

**The mic is the largest control and is always reachable one-handed.** During recording, indigo with
a slow pulse — not a rainbow, not an animated waveform.

**The offline chip is grey and small.** Offline is normal. Alarming the shopkeeper about a state the
app handles fine is a design failure.

---

## 6b. Button hierarchy

Validated against mockups — the first version had two equally-weighted primary buttons and the
hierarchy collapsed.

| Level | Style | Used for |
|---|---|---|
| **Primary** | Solid `INDIGO`, white text | **Exactly one per screen.** On Billing, that is the mic. |
| **Secondary** | `SURFACE` fill, 1px `LINE` border, `INK` text | Add item, Image, PDF |
| **Terminal** | Solid `INK`, white text | Bill Banao. Ends the flow — must read as *different*, not as a second primary. |
| **Acknowledge** | 1px `DANGER` border, `DANGER` text, transparent fill | "Theek hai" on a HIGH flag |
| **Text** | `INDIGO` text only | "Add X as a new product" |

Two solid indigo buttons on one screen is a bug.

## 6c. Number display rules

The thesis is number trust, so how numbers are shown is a design rule, not a formatting detail.

| Case | Show | Never show |
|---|---|---|
| No price yet (Rule 5) | `—` | `₹0` — reads as free |
| No rate, total only (`ka`) | rate cell `—`, amount filled | `₹0` |
| Qty unknown | `—` | `0` |
| Genuinely zero | `₹0` | — |
| All amounts | tabular figures, right-aligned | proportional figures |

`₹0` means "this costs nothing." An unpriced line means "we don't know yet." They must look different.

## 6d. Bilingual labelling

Adopted from the mockups. In any **search or picker** list, show the Devanagari name as a sublabel
under the Latin name:

```
Chini                    ₹45/kg
चीनी
```

The shopkeeper types Latin and gets Hindi confirmation. Costs one line, removes a whole class of
wrong-item errors. **Search lists only** — not the bill table, which follows `bill_language`.

## 7. Explicitly forbidden

```
✗ Gradients of any kind
✗ Glassmorphism, blur, translucency
✗ Emoji as UI icons
✗ Drop shadows on rows or cards
✗ More than one accent colour on screen at once
✗ Animation beyond 150ms functional transitions
✗ Illustrations, mascots, empty-state cartoons
✗ Generic SaaS blue (#3B82F6 and neighbours)
✗ Pure white (#FFFFFF) as the app background
✗ Devanagari and Latin from mismatched typefaces
✗ Two solid primary buttons on one screen
✗ `₹0` for a line that simply has no price yet
✗ Labels that wrap or clip inside a button — size the button to the text
```

---

## 8. Implementation

Tokens are defined once in `tailwind.config.ts`, from the values above. **Raw hex values never
appear in components.** If a colour is needed that isn't a token, that's a design decision and it
goes in this document first.

```ts
colors: {
  ink:     { DEFAULT: '#1A1A1F', soft: '#5A5A66' },
  paper:   '#FBF9F4',
  surface: '#FFFFFF',
  line:    '#E4E0D6',
  indigo:  { DEFAULT: '#2C3E7B', deep: '#1E2B57' },
  turmeric:'#E0A020',
  danger:  '#B3261E',
  warn:    '#A16207',
  ok:      '#2E6B3E',
  muted:   '#9A9689',
}
```

Dark mode is **deferred**. A shop counter is a daylight environment, and shipping one well-made
theme beats shipping two mediocre ones.

---

## 9. Icons

**Lucide**, at 20px, 1.5px stroke, `ink-soft`. One consistent set, no emoji, no mixing. Icons always
accompany a label except for universally understood controls (close, back, mic).
