# 06 — Feature Tickets

**Last updated:** 20 Sep 2026 (rev 6) · **Status:** Final for MVP

Each ticket is written to be handed to an AI tool as a self-contained prompt.

**Instruction to any AI picking up a ticket:** read `00-README.md`, `01-PRD.md` and
`07-DECISIONS.md` first. If a decision you need isn't recorded, **stop and ask** — do not invent it.

**Definition of done:** code merged · unit tests pass · eval re-run with no regression · affected
`.md` updated · `07-DECISIONS.md` updated if a decision changed.

---

## Phase 0 — Build `domain/` · ~3 weeks · new codebase

**The old code is a reference, not a base.** Its knowledge migrates; its implementation does not.

Phase 0 builds `src/domain/` as standalone TypeScript with a Node eval harness — no UI, no database,
no auth, no browser. This attacks the highest-risk part of the product first, is fully testable
without infrastructure, and is **not throwaway work**: it is the foundation of the real app.

**Migrate from the old codebase (knowledge):** the 482-product catalog with aliases · the Gemini
pricing-grammar prompt (it is a spec, written as text) · the 16 mishearing normalisation rules ·
`HINDI_NUMBERS` and `HINDI_FRACTIONS` · the validator's *rules* (category guards, length-scaled
thresholds, phonetic variants, unit conversion) · the three-tier learning design.

**Discard (implementation):** all UI and CSS · `billing-ui.js` · the localStorage layer · the
Netlify functions · the O(n) matcher · `validator.js` as written.

| ID | Ticket | Detail | Done when |
|---|---|---|---|
| **KB-001** | Rotate keys, fix `.gitignore` | Add `.env`, `.env.*`, `!.env.example` **first**, then rotate both keys | New keys live, old revoked, nothing secret in the repo |
| **KB-000** | Repo + `domain/` scaffold | Vite + TS. `src/domain/` with zero external imports. Vitest configured. | `npm test` runs |
| **KB-003** | `domain/money.ts` + `domain/catalog.ts` | Integer paise arithmetic; catalog types; import the 482 products as seed JSON | Money math unit-tested; catalog loads |
| **KB-002** | Command matcher (`domain/commands.ts`) | Whole-utterance matching, filler-stripped, digit-rejecting. The old `includes("bas")` matched "basmati" — 8 aliases across 5 products collided. | 0 collisions across all 482 products; "bas", "ab bas", "ho gaya", "बस" still fire |
| **KB-004** | **Eval harness (Node)** | Derive prices from the catalog at runtime; match on catalog id not display string; report transcription errors separately from parsing errors | 25/25 run, baseline recorded |
| **KB-005** | **`domain/grammar.ts` — pricing grammar** | All five rules. The old code returned ₹100 instead of ₹30 for "5 kg chawal 30 ka". **Confirmed differentiator: Pilloo returns the same amount for `ka` and `wala`.** Write failing tests first. | All `ka`/`wala` cases pass |
| **KB-005b** | `domain/validator.ts` + `domain/catalogIndex.ts` | Port the *rules*, not the code. Prefix + n-gram index, not an O(n) scan. | Guards preserved; index benchmarked |
| **KB-005c** | **CLI harness** | `npm run try "chawal 5 kilo tees ka"` prints parsed items, price type and fast-path hit/miss. ~15 lines. **Phase 0 has no visible output for three weeks — this is the mitigation**, and it becomes the fastest debugging tool in the project. It is also the exact demo that proves the differentiator: Pilloo returns the same amount for `ka` and `wala`. | Both phrasings produce different totals |
| **KB-008** | `domain/learning.ts` | Three-tier learning rules, pure functions | Unit-tested against scripted bill sequences |
| **KB-006** | Number benchmark | 100 utterances stressing Hindi numerals, fractions, `X wala` vs `X ka`, two-number utterances, confusable pairs (तीस/पीस, दस/दीस) | Baseline number-accuracy figure recorded |
| **KB-007** | Shop vocabulary biasing | Top ~40 product names by frequency as the Whisper `prompt`, capped at 600 chars | Brand-name errors measurably reduced vs KB-004 baseline |
| **KB-009** | **Fast-path coverage probe** | Run the Layer 1 parser over the 25 eval cases **and** the 100-utterance number benchmark. Report % handled deterministically, with miss reasons grouped. | **A measured coverage number exists.** See risk R1 — the cost model, latency story and moat argument all assume 60–70%, and it has never been measured. |

> **This order is canonical.** It matches `CLAUDE.md`, `10-TRACKER.md` and `15-BUILD-GUIDE.md` §6.
> `KB-003` (money + catalog) comes before `KB-002` (commands) because the command matcher's test
> sweeps the 482-product catalog, which `KB-003` loads.

**Phase 0 exit gate:** the pricing grammar passes every test, and there is a recorded number-accuracy
baseline. **Do not start Phase 1 before this.**

---

## Phase 1 — Foundation · ~3 weeks

| ID | Ticket | Detail |
|---|---|---|
| **KB-101** | Project scaffold | Vite + React + TS. `domain/` `data/` `providers/` `ui/` `app/`. **`domain/` imports nothing from the others.** |
| **KB-102** | Supabase project + migrations | Dev and prod. Supabase CLI, migrations versioned in the repo. |
| **KB-103** | Schema | Every table in `03-DATA-MODEL.md`. **Integer paise. No floats.** |
| **KB-104** | RLS policies | Every `shop_id` table. `base_products` read-only to authenticated. |
| **KB-105** | **RLS negative tests** | Two shops, authenticated as each, asserting zero cross-visibility on every table. **The most important test in the suite.** |
| **KB-106** | Google sign-in | Auth flow, session handling, sign-out |
| **KB-107** | Onboarding | Shop name/phone, **catalog choice screen** (S2). Logo upload split out to `KB-107b` — a distinct Storage/security surface, not bundled in to avoid scope creep. |
| **KB-107b** | Shop logo upload | Supabase Storage bucket + `storage.objects` RLS policies (versioned migration, same discipline as every other schema change), upload UI wired into S2/S7. Deferred out of `KB-107` on 20 Sep 2026 rather than left as unscoped "someday" work. |
| **KB-108** | Seed `base_products` | Import the 482-product catalog with aliases as versioned base data |
| **KB-109** | IndexedDB layer | Local schema mirroring the server tables, with `local_id` / `sync_status` / `updated_at` |
| **KB-110** | Sync worker | Bidirectional, idempotent on `(shop_id, local_id)`, exponential backoff, never blocks the UI |
| **KB-111** | Receipt number blocks | Reserve 50 while online; consume offline; reserve again below 10 remaining |

---

## Phase 2 — Voice pipeline · ~4 weeks · the differentiator

| ID | Ticket | Detail |
|---|---|---|
| **KB-201** | **`KB-CATALOG-INDEX`** | Prefix map + n-gram inverted index. Score only candidates, never the whole catalog. **Blocker for type-ahead.** Current O(n) scan is unusable past ~2,000 products on a budget phone (benchmarked: 5,000 → ~106 ms/keystroke). |
| **KB-202** | Port validator to `domain/` | Preserve **all** guards: category buckets, length-scaled thresholds, phonetic variants, unit conversion with rate-basis inference, 11 review codes |
| **KB-203** | Port pricing grammar | The fixed version from KB-005. Pure functions, fully unit-tested. |
| **KB-204** | `TranscriptionProvider` interface | Groq Whisper large-v3 primary; Web Speech secondary |
| **KB-205** | `ParseProvider` interface | Gemini Flash-Lite. Cache the static grammar block. Catalog slice 30, not 80. |
| **KB-206** | Single `/voice` endpoint | Transcription + optional parse in **one** round trip. **Binary upload, not base64.** JWT-checked, per-shop rate-limited. |
| **KB-207** | **Layer 1 — deterministic parser** | All six patterns, Hindi numerals, fractions. **Returns `null` the moment anything is ambiguous.** Log `fastPathHit`/`Miss`. Resolve **O3** before starting. |
| **KB-208** | **Layer 3 — number safety gate** | HIGH flags gate finalisation; MEDIUM/LOW never do. Inline sentences, not icons. |
| **KB-209** | **Learning engine** | L1–L6 per `08-LEARNING-ENGINE.md`. Per-shop only. Only finalised bills teach. Prices suggested, never auto-applied. |
| **KB-210** | Learning audit UI | Developer Mode: aliases + confidence, provisional products, price suggestions, reset action |

---

## Phase 3 — Billing UI · ~3 weeks

| ID | Ticket | Detail |
|---|---|---|
| **KB-301** | Billing screen shell | S3. Table on desktop, cards on mobile. |
| **KB-302** | Voice control + states | Every state in `05-FRONTEND-SPEC.md` §2. **Transcript shown before items resolve.** |
| **KB-303** | Editable bill table | Qty, rate, remove. `inputmode="decimal"`. Line totals recompute on edit. |
| **KB-304** | Flag rendering | HIGH red inline / MEDIUM amber badge / LOW grey dot |
| **KB-305** | **Add item with type-ahead** | S3a. Under 2 s from tap to item on bill. Depends on KB-201. |
| **KB-306** | Customer fields | Name defaults to "Cash", mobile optional. **Never blocks finalise.** |
| **KB-307** | Finalise | Atomic local write, receipt number from block, immutable after. Triggers learning. |
| **KB-308** | Receipt | Kirana parchi format. `bill_language` **actually read**. **Every value HTML-escaped.** |
| **KB-309** | Share | Image · PDF · WhatsApp |
| **KB-310** | History + search | S5. Client-side search so it works offline. |
| **KB-311** | Catalog screen | S4, including "Add from ready catalog" and the learning suggestions panel |
| **KB-314** | **Bulk catalog import** | Excel/CSV upload via SheetJS, parsed client-side, preview-and-confirm, then a normal local write that syncs. Table stakes — a 500-product shop will not type them in. |
| **KB-312** | Settings | Shop details, bill language, developer mode |
| **KB-313** | Offline UI | Chips, disabled mic with reason, **half-built bill survives a network drop** |

---

## Phase 4 — Pilot hardening · ~2 weeks

| ID | Ticket | Detail |
|---|---|---|
| **KB-401** | PWA manifest + install | Installable. Icons, splash, standalone display. |
| **KB-402** | Performance pass | Every budget in `05-FRONTEND-SPEC.md` §10 met on a budget Android |
| **KB-403** | Supabase PITR | Enabled before real shop data enters |
| **KB-404** | Product metrics | Turns-to-bill and seconds-to-bill recorded per bill |
| **KB-405** | **Pilot run** | 20 consecutive real bills in the shop, measured against §8 of the PRD |
| **KB-406** | Capacitor Android | **Only after web MVP is complete and validated.** Play Store listing, $25 one-time. |

---

## Release gate

The MVP ships when, over **20 consecutive real bills in the pilot shop**:

```
□ Median turns-to-bill = 1
□ Silent number errors = ZERO                    ← hard gate
□ Fast-path coverage ≥ 60%
□ Zero-edit accuracy ≥ 80%
□ Voice measurably faster than typing
□ No bill lost or corrupted
□ RLS negative tests pass
□ Eval baseline with no regression
```

**Zero silent number errors is not negotiable.** A billing app that is silently wrong about money is
not shippable, however good every other number looks.

---

## Parked

Kept here so they are not forgotten and not re-argued.

| Item | Revisit when |
|---|---|
| Udhaar / credit ledger | Immediately post-MVP. Highest-value next feature. |
| Customer database | With udhaar |
| Offline voice (Level 3) | After Web Speech evaluation |
| Multi-device (Level 4) | When a shop has two counters |
| Staff roles | When a shop has employees |
| Thermal printing | On request from a real shop |
| GST | When a shop needs it |
| Inventory, reports, UPI on receipt, discounts | Post-MVP |
| iOS | When Android proves the wrapper works |
| Server-side catalog search | Only above 10,000 products |
| Self-hosted STT | ~50 busy shops (break-even vs Groq) |
| Sarvam evaluation (**O2**) | Phase 2, or if Whisper accuracy is insufficient |
