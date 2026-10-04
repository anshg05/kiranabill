# 06 — Feature Tickets

**Last updated:** 1 Oct 2026 (rev 27) · **Status:** Final for MVP

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
| **KB-107b** | Shop logo upload | Supabase Storage bucket + `storage.objects` RLS policies (versioned migration, same discipline as every other schema change), upload UI wired into S2/S7. Deferred out of `KB-107` on 20 Sep 2026 rather than left as unscoped "someday" work. **Share (owner, 4 Oct 2026, `KB-309`):** the share image is drawn on a canvas — a logo served from another origin without CORS would taint it and block `toBlob`. Serve the logo from our own origin / Storage with CORS, and cache it locally (offline receipt). |
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
| **KB-110b** | Bill push path + `receipt_number_source` (`KI-29` + `KI-31`) | A finalised bill's first push can never sync its items (the immutability triggers reject them, then the retry marks the bill `conflict`); and `receipt_number_source` is never stored locally or pushed. One ticket — both are the bill push path. **Also persists `rate_unit` (added 26 Sep by `KB-005f`, D36):** a `bill_items.rate_unit` column (migration), a `LocalBillItem.rateUnit` field and the push mapping. Sync — most capable model (D33); real local-stack verification (D21, D32). | ✅ **Done 27 Sep 2026** — `push_bill()` (D37); closes `KI-29`, `KI-31`; migration `20260927090000_push_bill.sql` pushed 27 Sep 2026 (owner), confirmed live via `db dump --linked` |
| **KB-315** | Runtime bootstrap (`KI-32`) | Persisted `deviceId`; first receipt block reserved at onboarding (`16-APP-FLOW.md` §2); local `shops` cache written; sync loop started. Prerequisite for `KB-307` finalising, numbering and syncing a bill. | ✅ **Done 27 Sep 2026** — D38; closes `KI-32`. Per-user local DB, persistent device id, offline session, no sync without a real session. |
| **KB-316** | Type-check + lint every TS file (`KI-36`) | Added 27 Sep 2026 (owner), before `KB-302` — KI-36's trigger. `tsc -b` over a solution tsconfig (five projects) in `npm run typecheck` and `npm run build`; ESLint on every TS file with five core correctness rules. D40. | ✅ **Done 27 Sep 2026** — 0 errors surfaced; real `/voice` re-verified through `netlify dev`; live `/voice` unauthenticated check run after the deploy (result: KB-316 handoff) |

---

## Phase 3 — Billing UI · ~3 weeks

**Checked 23 Sep 2026, before Phase 3 planning starts — same staleness check run before Phase 2, this
time correcting real dependencies rather than "already done" claims.** Nothing below is done; the
difference is that six of these tickets now have a concrete, already-built, real-verified Phase 2
dependency the original ticket text doesn't name. Status column added for the real-dependency notes;
nothing renumbered.

| ID | Ticket | Detail | Status |
|---|---|---|---|
| **KB-301** | Billing screen shell | S3. Table on desktop, cards on mobile. | ✅ **Done 27 Sep 2026** — owner's real-browser check passed (D39). Also: `ShopProvider` tests, Retry instead of onboarding on a failed first load, KI-19 font fix, dev-only email sign-in for the local stack. New dependencies: `lucide-react` (SD-026), `@fontsource/mukta` (SD-027). |
| **KB-302** | Voice control + states | Every state in `05-FRONTEND-SPEC.md` §2. **Transcript shown before items resolve.** | ✅ **Done 28 Sep 2026** — owner's real-mic browser check passed (D39); language `hi` (D44). Three local commits: (a) capture + states + transcript; the compound-number grammar fix (D43); (b) Layer 1 on the shop's catalog, text-only Layer 2 parse with guardrails, settling, number alignment, lines on the bill (D41, D42). Original note: ⬜ Not started. **Real dependency now concrete:** `KB-206`'s `/voice` endpoint is done and real-verified — this ticket calls it directly. Per `02-ARCHITECTURE.md` §5, this ticket also owns running Layer 1 (`grammar.ts`) client-side first and building the catalog slice before ever calling `/voice` for a Layer 2 parse — neither is `/voice`'s job. |
| **KB-317** | Voice accuracy + speed — Layer 1 on real input | Added 28 Sep 2026 (owner; instead of `KB-304`). Four commits: (1) measure — real-transcript fixtures (`eval/real-transcripts.json`, owner-confirmed) + `npm run eval:real`, per-stage dev timings, dev-only `?save=1` recordings (gitignored) + `npm run eval:audio` (whisper-large-v3 vs turbo, report only), no retry on a Gemini 429; (2) Layer 1 on Devanagari — KI-44 glue split, segmenting on और / commas, Hindi unit/marker spellings, transliteration + targeted aliases (tests first, owner review); (3) `duplicate_line` HIGH (KI-46); (4) the 60 s warm mic (D45). Gemini prompt fixes → `KB-318`, after billing (KI-50). | 🟦 **In progress** — commit 1 done 28 Sep 2026 (baseline: 1/9 real transcripts hit Layer 1); decimal fix (KI-51) pushed 29 Sep; commit 2 built 29 Sep, reworked after the owner's first browser check (spelling folds, measured; 33 real transcripts: 24 hits, 21 correct + 3 awaiting commit 3's flag) — then commits 3, 4, 5 and three fixes (decimal, guard KI-55, `number_unconsumed` segmentation). ✅ **Done 1 Oct 2026** — all pushed and live (`45e34bc`…`e89c065`); owner browser checks passed; real transcripts RT01–RT25: 4 Layer 1 hits (1 wrong) → 20, all 39 cases 25 hits, 25 correct, 0 wrong. Remainder → `KB-318` / `KB-304` (KI-45, KI-47, KI-50, KI-52, KI-57, KI-58, NI-32, NI-33). |
| **KB-303** | Editable bill table | Qty, rate, remove. `inputmode="decimal"`. Line totals recompute on edit. | ✅ **Done 1 Oct 2026** (owner browser checks passed; live) — qty / rate / amount (only where no rate) / unit (only compatible), exact input (Devanagari digits, limits, never rounded), SG-09 per-kg rates, ✕ with one-level undo, flags re-derived (duplicate cleared on removal; MEDIUM `already_on_bill` across utterances). No new dependency. |
| **KB-304** | Flag rendering | HIGH red inline / MEDIUM amber badge / LOW grey dot | ✅ **Done 2 Oct 2026** — owner browser check passed (desktop + 375 px; every severity via `?try=`, acknowledge / edit-lapse / Undo-keeps-acknowledgement); the LOW dot's tap target is the 44×44 button around it. (Owner decisions: LOW sentence on tap; acknowledgement lapses on any edit, restored by Undo; bill-level block under the utterance's last line). Was: ⬜ Not started. **Real dependency now concrete:** renders `src/domain/reviewFlags.ts`'s real `ReviewFlag[]` output (`KB-208`, done) — severity, `itemIndex`, and real human-readable `message` strings already exist (written to match `05-FRONTEND-SPEC.md`'s own "inline sentences, not icons" rule). This ticket renders that data; it doesn't design it. |
| **KB-319** | Voice parse: client timeout + Retry text only | Added 1 Oct 2026 (owner), right after `KB-304`. KI-57 + KI-58: when the Gemini parse fails or exceeds a client timeout (~8 s), keep the transcript on screen, say "Couldn't read the items — Retry", and Retry re-sends the TEXT only — no re-record, no second Groq call. Plus Groq: fail fast on a 429 and a client timeout. Doesn't need Gemini billing. | ✅ **Done 2 Oct 2026** — owner browser check (`?failparse=502`, `=timeout`) + Retry success verified against the real local `/voice`. D50: server deadlines Groq 8 s / Gemini 6 s, client 12 s / 8 s, Gemini one attempt; a failed parse stays as "Not added — Retry / ✕" (owner: never cleared by a new recording), counted in "N checks pending"; Retry = one text-only call. |
| **KB-318** | Gemini prompt + Layer 2 guards | After billing for Gemini (KI-50). KI-45 (gram/kg quantity read as 0.5 gm), KI-47, KI-52 (a different product from the one named — code guard in `domain/layer2.ts` + prompt rule), thinking config. **Verification adds (owner, 2 Oct 2026):** see one live bill-level "Heard: …" block (`KB-304`) from a real Gemini-path order — until billing is on, bill-level flags are covered only by tests. | ⬜ Not started — blocked on KI-50. |
| **KB-305** | **Add item with type-ahead** | S3a. Under 2 s from tap to item on bill. Depends on KB-201. | ✅ **Done 3 Oct 2026** — owner browser check passed (desktop + 375 px, Android back gesture); NI-28 measured on a real phone → D51. (Owner decisions: non-modal panel; a custom item is a bill line only, qty "—" + unit "—"; catalog pick qty 1 with the qty editor open; spoken_name = the product's name; Android back closes the panel). Was: ⬜ Not started. **Dependency already satisfied:** `KB-201` (catalog index/matcher) was done via Phase 0 (`KB-005b`), confirmed in this file's own Phase 2 corrections above. |
| **KB-306** | Customer fields | Name defaults to "Cash", mobile optional. **Never blocks finalise.** | ✅ **Done 3 Oct 2026** — owner browser check passed (375 px + desktop); migration `20261003090000` on both sides (D52: name ≤ 60 code points, mobile 10 digits; CHECK migration `20261003090000`, client ⇔ server parity e2e; sync logs no customer data). Was: ⬜ Not started. |
| **KB-307** | Finalise | Atomic local write, receipt number from block, immutable after. Triggers learning. | ✅ **Done 3 Oct 2026** — owner browser check passed (focus fix at 375 px / desktop / after resize; learning). Commit 3 = learning (D56); commit 2 = finalise + sync (D54, focus fix verified by the agent in the preview); commit 1 = integrity, live (D53: KI-38 composite FKs, KI-41 totals trigger, SG-10 lint; migration `20261003100000` awaiting the owner's `db push`). **Plan approved 3 Oct 2026:** learning in a second idempotent transaction with recovery, deterministic learning-row ids (re-run = no-op, KI-39); unpriced line = pending "Price needed"; mic / Add item on the saved screen starts the next bill; alias events tagged with their source layer (fastpath / gemini / manual); `bill_items.review_flags` stores `{code, severity, acknowledged}`. Was: ⬜ Not started. **The single most important cross-reference in this list, not previously stated anywhere:** "Triggers learning" IS `KB-209`'s deferred finalize hook — not a separate ticket to bolt on afterward. Build `learning.ts`'s wiring (`recordProductSighting`/`recordAliasConfirmation`/`recordPriceObservation` on every finalized line) as part of this ticket. Also needs the IndexedDB↔`LearningState` marshalling neither `KB-208` nor `KB-210` built (both only needed read-side pieces) — a real, separable deliverable, not folded silently into "the finalize hook." **Owner, 1 Oct 2026 (`KB-304` plan):** on a Bill Banao tap with unacknowledged HIGH flags, **focus the first flagged line** (not in 16 §3 as written). **KB-319 (2 Oct 2026):** Bill Banao waits for `pending` = 0 — unacknowledged HIGH flags **plus not-added utterances** (D50). **KB-305 (2 Oct 2026):** decide how learning treats `source: "manual"` lines (suggested: price/unit observations only, never alias evidence) and how a hand-added custom item feeds L1 provisional products. |
| **KB-320** | L1 promotion → `shop_product` | Added 3 Oct 2026 (owner, `KB-307` plan). A provisional product reaching 3 sightings (or "Save to catalog") becomes a `shop_products` row (`source = 'learned'`, modal price and unit — 08 §3). `KB-307` only records "promotion due" + an event: `shop_products` is a pull-only cache locally (03 §0), so this needs a server write path (online insert, or a pushed local-first table) and the catalog re-pull. | ⬜ Not started. After `KB-307`. |
| **KB-321** | L5 use_count / vocabulary rank | Added 3 Oct 2026 (owner, `KB-307` plan). 08 §7: products billed recently, by frequency, rank the Whisper vocabulary. `use_count` lives on `shop_products` (server); recent frequency could be derived locally from final bills. | ⬜ Not started. After `KB-307`. |
| **KB-322** | L4 unit preferences | Added 3 Oct 2026 (owner, `KB-307` plan). 08 §6: a unit overridden 3+ times to the same alternative → suggest a new default unit, never auto-apply (safety rule 3). Needs a place to record unit observations (no table exists). | ⬜ Not started. After `KB-307`. |
| **KB-323** | Learned aliases feed the parser | Added 3 Oct 2026 (owner, `KB-307` plan). An alias promoted at confidence ≥ 0.8 (08 §4) joins `shop_products.aliases` / Layer 1. **Owner rule: Gemini-sourced confirmations need a higher threshold than fastpath ones** — a Gemini guess (KI-47 brand guesses, KI-52 alias overrides) must not become a trusted alias just because it was finalised unedited. `KB-307` records each alias event's source layer for this. | ⬜ Not started. After `KB-307`. |
| **KB-308** | Receipt | Kirana parchi format. `bill_language` **actually read**. **Every value HTML-escaped.** | ✅ **Done 4 Oct 2026** — owner browser check passed (375 px + desktop, en and hi); four commits (commit 4 = the legacy layout, D57) + migration `20261004090000` (`bill_language` default `'en'`), pushed by the owner after `--dry-run`. New: KI-65 (server-side shop edits need `updated_at = now()`). Built 3 Oct 2026 — `domain/receipt.ts` (`buildReceipt`, en/hi/both strings in one table, units translated for hi, D47 qty "—", SG-09 rate via the shared `shownRate`), `data/receipt.ts` (`loadReceipt`, local tables only — draws offline), `ui/Receipt.tsx` (semantic table, sr-only column headers; ≤ 384 px, 100% narrower; type 12–14 px with the viewport; number columns never wrap, the item column wraps), shown on the saved screen in place of the bill (the customer row is hidden there — the mobile is nowhere in the page). Fallback number: own line, breaks only after a hyphen, `select-all`. Logo only if set and it loads (caching = `KB-107b`). Lint bans raw HTML (no existing uses). Font: `@fontsource/ibm-plex-mono` 5.3.0, SD-029. New: NI-35 (GST tax invoice?), NI-36 (no address), KI-64 (flaky receipt-number test). Plan approved 3 Oct 2026 (Q1–Q5). Was: ⬜ Not started. No new dependency (superseded: SD-029, owner). **KB-306 (owner, 3 Oct 2026; D52):** print the customer name only when it isn't "Cash" (escaped, hard rule 9); **never print the mobile** — it's only the WhatsApp target. |
| **KB-309** | Share | Image · PDF · WhatsApp | 🟦 **Built 4 Oct 2026 — two commits, local; awaiting the owner's browser check** (D58: PNG 2x / own one-page 58 mm PDF / wa.me with the stored mobile; rendered when the receipt is shown; canShare → share or download; AbortError does nothing). Android check at the draft-deploy step. Was: ⬜ Not started. Depends on `KB-308` (receipt) existing first, not on anything from Phase 2. |
| **KB-310** | History + search | S5. Client-side search so it works offline. | ⬜ Not started. Searches `KB-109`'s local `bills` table, already indexed on `createdAt`/`customerName` for exactly this (`KB-109`'s own handoff flagged this ahead of time). Needs `KB-307` (real bills to search) first. |
| **KB-311** | Catalog screen | S4, including "Add from ready catalog" and the learning suggestions panel | ⬜ Not started. **Real dependency now concrete:** the "learning suggestions panel" (`05-FRONTEND-SPEC.md` S4 — price drift, unit drift, provisional products awaiting promotion) should call `src/data/learningAudit.ts`'s `listProvisionalProducts`/`listPendingPriceSuggestions` (`KB-210`, done, real-verified) — not rebuild suggestion-fetching logic a second time. |
| **KB-314** | **Bulk catalog import** | Excel/CSV upload via SheetJS, parsed client-side, preview-and-confirm, then a normal local write that syncs. Table stakes — a 500-product shop will not type them in. | ⬜ Not started. New dependency to justify against `09-WORKING-AGREEMENT.md` §B6 when planned: SheetJS. |
| **KB-312** | Settings | Shop details, bill language, developer mode | ⬜ Not started. **Real dependency now concrete — this IS S7**, the exact screen both `KB-209` and `KB-210` have been waiting on. `KB-210`'s full Developer Mode data layer (`listLearnedAliases`/`listProvisionalProducts`/`listPendingPriceSuggestions`/`resetLearning`, all done and real-verified, including `resetLearning`'s honest `remoteDeletionNotPerformed` signal) is built and ready to wire in directly. |
| **KB-313** | Offline UI | Chips, disabled mic with reason, **half-built bill survives a network drop** | ⬜ Not started. Reads `KB-110`'s real online/offline sync-loop state, already built. **Also (added 27 Sep 2026, `KB-315` / D38):** the sign-out warning — before signing out with unsynced bills, show the count (`16-APP-FLOW.md` "Sign-out"); and an offline-session indicator (the app is running on the last sign-in; nothing syncs until a real session). |

---

## Phase 4 — Pilot hardening · ~2 weeks

| ID | Ticket | Detail |
|---|---|---|
| **KB-401** | PWA manifest + install **+ offline app load** | Installable. Icons, splash, standalone display. **Also a service worker that precaches the app shell (HTML, JS, CSS, self-hosted fonts), so the app opens with no network** — the manifest alone doesn't do that. Amended 27 Sep 2026 (owner), `12-PARKED.md` `KI-40`. **Fonts (owner, 4 Oct 2026, `KB-308`):** precache only the IBM Plex Mono subsets a receipt actually fetches — latin and latin-ext, 400 and 600 woff2 (4 files) — not all 20 Plex files in `dist/` (Cyrillic / Vietnamese subsets and woff fallbacks are never fetched; SD-029). |
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
