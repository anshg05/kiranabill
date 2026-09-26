# 06 — Feature Tickets

**Last updated:** 26 Sep 2026 (rev 15) · **Status:** Final for MVP

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

**Corrected 20 Sep 2026, before Phase 2 planning started — this list predates Phase 0's restructuring
(`07-DECISIONS.md`, 17 Aug 2026: "build `domain/` fresh instead of patching the old codebase") and was
never updated afterward.** Several of these tickets describe "porting" logic into `domain/` that Phase 0
already built there directly, under different ticket numbers, with its own tests and benchmarks. Status
column added; nothing below is renumbered, so existing references elsewhere still resolve.

| ID | Ticket | Detail | Status |
|---|---|---|---|
| **KB-201** | **`KB-CATALOG-INDEX`** | Prefix map + n-gram inverted index. Score only candidates, never the whole catalog. **Blocker for type-ahead.** Current O(n) scan is unusable past ~2,000 products on a budget phone (benchmarked: 5,000 → ~106 ms/keystroke). | ✅ **Already done** — `src/domain/catalogIndex.ts` (`KB-005b`, Phase 0). Trigram index, benchmarked at 10.6ms worst-case against a synthetic 10,000-product catalog, well under the 16ms budget. Nothing to port; this describes the legacy O(n) scan this already replaced. |
| **KB-202** | Port validator to `domain/` | Preserve **all** guards: category buckets, length-scaled thresholds, phonetic variants, unit conversion with rate-basis inference, 11 review codes | ✅ **Already done** — `src/domain/validator.ts` (`KB-005b`). The 11-code review/confidence-gate system was explicitly scoped *out* of `KB-005b` at the time (deferred to whichever ticket has real bill state) — that gap is now `KB-208`'s actual remaining job, not this one's. |
| **KB-203** | Port pricing grammar | The fixed version from KB-005. Pure functions, fully unit-tested. | ✅ **Already done** — `src/domain/grammar.ts` (`KB-005`, `KB-005d`). This *is* "the fixed version from KB-005" — there is no separate legacy version left to port. |
| **KB-204** | `TranscriptionProvider` interface | Groq Whisper large-v3 primary; Web Speech secondary | ✅ **Groq half done** — `src/voice/transcriptionProvider.ts` + `groqTranscriptionProvider.ts`, verified against the live Groq API. Web Speech deliberately deferred; the two implementations don't share one real interface shape (server-side `Blob` call vs in-browser live-stream call) — see `NI-24`. **A real bug in this ticket's own upload code (bare `"audio"` filename, no extension — Groq rejects it) was missed by this ticket's own real-verification script and only caught by `KB-206`'s end-to-end one; fixed there — see `KI-28`.** |
| **KB-205** | `ParseProvider` interface | Gemini Flash-Lite. ~~Cache the static grammar block.~~ Catalog slice 30, not 80. | ✅ **Gemini half done** — `src/voice/parseProvider.ts` + `geminiParseProvider.ts` + `pricingGrammarPrompt.ts`, verified against the live Gemini API. **Caching is not achievable** — real API rejection, `07-DECISIONS.md` D26; `04-VOICE-PIPELINE.md` §4 corrected. `NI-21` closed: the prompt encodes D13's four resolutions fresh, verified as real agreement against `grammar.ts` on 8 utterances (3/8 → 8/8 after two real prompt-gap fixes found by the check itself). Claude Haiku failover deferred, `NI-25`. |
| **KB-206** | Single `/voice` endpoint | Transcription + optional parse in **one** round trip. **Binary upload, not base64.** JWT-checked, per-shop rate-limited. | ✅ **Done** — `netlify.toml`, `netlify/functions/voice.mts`, `_shared/auth.ts`, `_shared/rateLimit.ts`. Real end-to-end verified: real auth rejection, real Groq→Gemini round trip, real per-shop rate-limit rejection via Netlify Blobs. Found and fixed a real bug in `KB-204`'s shipped code along the way — `KI-28`. Cost-model recalculation is real but incomplete — Groq's real rate is unobtainable this session, explicit close condition logged, `KI-27`. |
| **KB-207** | **Layer 1 — deterministic parser** | All six patterns, Hindi numerals, fractions. **Returns `null` the moment anything is ambiguous.** Log `fastPathHit`/`Miss`. ~~Resolve **O3** before starting.~~ | ✅ **Already done** — `src/domain/grammar.ts` + `commands.ts` (`KB-005`/`KB-005d`), fast-path hit/miss instrumentation already built and measured at 92.8% (`KB-009`). O3 already closed (`07-DECISIONS.md`: "void — no such experiment ever happened") — this line item is fully moot. |
| **KB-208** | **Layer 3 — number safety gate** | HIGH flags gate finalisation; MEDIUM/LOW never do. Inline sentences, not icons. | ✅ **Done** — `src/domain/reviewFlags.ts`, the real 14-code system (11 legacy + 3 new number-safety codes). All severities sourced or explicitly decided, none invented. Real-data check over all 125 `eval/` fixtures: 0 false positives, after fixing two real bugs the check itself caught (`unusual_total` wrongly flagged a spoken `"ka"`/`"ki"` total override — including the flagship `"5 kg chawal 30 ka"` case itself; a unit-basis bug multiplied gram-scale qty straight against a per-kg price). `KI-21`'s two repro cases confirmed to still bail at Layer 1 — `reviewFlags.ts` structurally can't reach them (mistranscription, not a parsing-level number loss), stated honestly rather than glossed over. `number_unconsumed`'s Layer-2 coverage gap logged as `NI-26`. |
| **KB-209** | **Learning engine** | L1–L6 per `08-LEARNING-ENGINE.md`. Per-shop only. Only finalised bills teach. Prices suggested, never auto-applied. | 🟦 **Partially done, deliberately deferred to Phase 3.** `src/domain/learning.ts`'s decision logic is built and tested (`KB-008`, Phase 0); the four learning tables are live in Postgres (`KB-103`/`KB-108`) and sync (`KB-110`); `KB-208` added `getEffectivePrice()`/`getPriceSuggestions()` as real read-side consumers; `KB-210` added the Developer Mode read/reset functions. **Remaining: this is NOT a separate later ticket to bolt onto Phase 3's `KB-307` (Finalise) — it IS `KB-307`'s own "Triggers learning" line.** Build the finalize hook as part of `KB-307`, not after it — wiring into a stub finalize action now would mean rebuilding it once the real one exists. Also flagged, not yet built: the IndexedDB↔`LearningState` marshalling both `KB-208`'s read side and this write side silently assume exists — a real, separable deliverable for whichever ticket builds it, not folded silently into "the finalize hook." |
| **KB-210** | Learning audit UI | Developer Mode: aliases + confidence, provisional products, price suggestions, reset action | 🟦 **Data functions done, UI not started.** `src/data/learningAudit.ts` — `listLearnedAliases`/`listProvisionalProducts`/`listPendingPriceSuggestions` (reuses `learning.ts`'s real `getPriceSuggestions()`, no duplicate logic) and `resetLearning()`. Same scoping precedent as `KB-208`: no Settings (S7) screen exists yet, so this ticket built what Developer Mode would call, not the screen itself. `resetLearning()` is deliberately local-only (owner's call) — signalled structurally via a `remoteDeletionNotPerformed: true` literal field, not a plain boolean; does not clear `learningEvents`, instead appends a real `learning_reset` audit entry. Gap logged as `NI-27` with a dual close trigger. Real-data check against `08-LEARNING-ENGINE.md` §9's literal list, all four items confirmed. **Remaining:** the actual Developer Mode screen, once S7 exists. |

---

## Pre-Phase-3 fixes — added 26 Sep 2026

Four tickets confirmed by the owner on 26 Sep 2026, from defects found reading the code during the new-machine
bootstrap (`12-PARKED.md`). **They run in this order, before `KB-301`** (`10-TRACKER.md` "Right now").
IDs follow this document's existing convention: a letter suffix after the ticket whose area the work follows
up (`KB-005b`/`c`/`d` after `KB-005`; `KB-107b` split from `KB-107`), and the next free number in the
phase for new work (`KB-315` after `KB-314`). `KB-005d` (`KI-21`, done 15 Sep) was recorded only in
`10-TRACKER.md`, never here — `KB-005e`/`f` continue its sequence.

| ID | Ticket | Detail | Status |
|---|---|---|---|
| **KB-005e** | `catalogIndex` perf test measures steady state (`KI-23`) | The 16 ms budget (`18-AGENT-CONTRACT.md` §8) is a steady-state requirement: 10 untimed warm-up rounds over all five queries, then time as before; cold first lookup not asserted. Scope widened 26 Sep: the test moved to `catalogIndex.perf.test.ts`, a separate Vitest project that `npm test` runs alone after every other file. Budget unchanged; no change to `catalogIndex.ts`. `07-DECISIONS.md` D35. | ✅ **Done 26 Sep 2026** — `npm test` 5/5; closes `KI-23` |
| **KB-005f** | Gram/ml default-price rounding (`KI-30`) | `grammar.ts`'s `convertPriceBetweenUnits()` rounded the per-gram/per-ml rate to whole paise before multiplying — "500 gram chini" billed ₹25, correct ₹22.50; 32 of 123 kg/liter products affected, silent. Fixed per D36: the line keeps its spoken qty/unit, the rate carries its own unit (`ParsedItem.rateUnit`, required), totals computed exactly in `money.ts`; no division in the money path (`no-division.test.ts`). Domain-only — persisting `rate_unit` is `KB-110b`'s. | ✅ **Done 26 Sep 2026** — closes `KI-30`; benchmark 110/0/0 |
| **KB-110b** | Bill push path + `receipt_number_source` (`KI-29` + `KI-31`) | A finalised bill's first push can never sync its items (the immutability triggers reject them, then the retry marks the bill `conflict`); and `receipt_number_source` is never stored locally or pushed. One ticket — both are the bill push path. **Also persists `rate_unit` (added 26 Sep by `KB-005f`, D36):** a `bill_items.rate_unit` column (migration), a `LocalBillItem.rateUnit` field and the push mapping. Sync — most capable model (D33); real local-stack verification (D21, D32). | ⬜ Not started |
| **KB-315** | Runtime bootstrap (`KI-32`) | Persisted `deviceId`; first receipt block reserved at onboarding (`16-APP-FLOW.md` §2); local `shops` cache written; sync loop started. Prerequisite for `KB-307` finalising, numbering and syncing a bill. | ⬜ Not started |

---

## Phase 3 — Billing UI · ~3 weeks

**Checked 23 Sep 2026, before Phase 3 planning starts — same staleness check run before Phase 2, this
time correcting real dependencies rather than "already done" claims.** Nothing below is done; the
difference is that six of these tickets now have a concrete, already-built, real-verified Phase 2
dependency the original ticket text doesn't name. Status column added for the real-dependency notes;
nothing renumbered.

| ID | Ticket | Detail | Status |
|---|---|---|---|
| **KB-301** | Billing screen shell | S3. Table on desktop, cards on mobile. | ⬜ Not started. No new dependency. |
| **KB-302** | Voice control + states | Every state in `05-FRONTEND-SPEC.md` §2. **Transcript shown before items resolve.** | ⬜ Not started. **Real dependency now concrete:** `KB-206`'s `/voice` endpoint is done and real-verified — this ticket calls it directly. Per `02-ARCHITECTURE.md` §5, this ticket also owns running Layer 1 (`grammar.ts`) client-side first and building the catalog slice before ever calling `/voice` for a Layer 2 parse — neither is `/voice`'s job. |
| **KB-303** | Editable bill table | Qty, rate, remove. `inputmode="decimal"`. Line totals recompute on edit. | ⬜ Not started. No new dependency. |
| **KB-304** | Flag rendering | HIGH red inline / MEDIUM amber badge / LOW grey dot | ⬜ Not started. **Real dependency now concrete:** renders `src/domain/reviewFlags.ts`'s real `ReviewFlag[]` output (`KB-208`, done) — severity, `itemIndex`, and real human-readable `message` strings already exist (written to match `05-FRONTEND-SPEC.md`'s own "inline sentences, not icons" rule). This ticket renders that data; it doesn't design it. |
| **KB-305** | **Add item with type-ahead** | S3a. Under 2 s from tap to item on bill. Depends on KB-201. | ⬜ Not started. **Dependency already satisfied:** `KB-201` (catalog index/matcher) was done via Phase 0 (`KB-005b`), confirmed in this file's own Phase 2 corrections above. |
| **KB-306** | Customer fields | Name defaults to "Cash", mobile optional. **Never blocks finalise.** | ⬜ Not started. No new dependency. |
| **KB-307** | Finalise | Atomic local write, receipt number from block, immutable after. Triggers learning. | ⬜ Not started. **The single most important cross-reference in this list, not previously stated anywhere:** "Triggers learning" IS `KB-209`'s deferred finalize hook — not a separate ticket to bolt on afterward. Build `learning.ts`'s wiring (`recordProductSighting`/`recordAliasConfirmation`/`recordPriceObservation` on every finalized line) as part of this ticket. Also needs the IndexedDB↔`LearningState` marshalling neither `KB-208` nor `KB-210` built (both only needed read-side pieces) — a real, separable deliverable, not folded silently into "the finalize hook." |
| **KB-308** | Receipt | Kirana parchi format. `bill_language` **actually read**. **Every value HTML-escaped.** | ⬜ Not started. No new dependency. |
| **KB-309** | Share | Image · PDF · WhatsApp | ⬜ Not started. Depends on `KB-308` (receipt) existing first, not on anything from Phase 2. |
| **KB-310** | History + search | S5. Client-side search so it works offline. | ⬜ Not started. Searches `KB-109`'s local `bills` table, already indexed on `createdAt`/`customerName` for exactly this (`KB-109`'s own handoff flagged this ahead of time). Needs `KB-307` (real bills to search) first. |
| **KB-311** | Catalog screen | S4, including "Add from ready catalog" and the learning suggestions panel | ⬜ Not started. **Real dependency now concrete:** the "learning suggestions panel" (`05-FRONTEND-SPEC.md` S4 — price drift, unit drift, provisional products awaiting promotion) should call `src/data/learningAudit.ts`'s `listProvisionalProducts`/`listPendingPriceSuggestions` (`KB-210`, done, real-verified) — not rebuild suggestion-fetching logic a second time. |
| **KB-314** | **Bulk catalog import** | Excel/CSV upload via SheetJS, parsed client-side, preview-and-confirm, then a normal local write that syncs. Table stakes — a 500-product shop will not type them in. | ⬜ Not started. New dependency to justify against `09-WORKING-AGREEMENT.md` §B6 when planned: SheetJS. |
| **KB-312** | Settings | Shop details, bill language, developer mode | ⬜ Not started. **Real dependency now concrete — this IS S7**, the exact screen both `KB-209` and `KB-210` have been waiting on. `KB-210`'s full Developer Mode data layer (`listLearnedAliases`/`listProvisionalProducts`/`listPendingPriceSuggestions`/`resetLearning`, all done and real-verified, including `resetLearning`'s honest `remoteDeletionNotPerformed` signal) is built and ready to wire in directly. |
| **KB-313** | Offline UI | Chips, disabled mic with reason, **half-built bill survives a network drop** | ⬜ Not started. Reads `KB-110`'s real online/offline sync-loop state, already built. |

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
