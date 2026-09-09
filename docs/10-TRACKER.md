# 10 — Tracker

**Last updated:** 09 Sep 2026 (rev 7) · **Current phase:** Phase 0 in progress

> **This is the project's current state.** Any AI joining the project reads this second, right after
> `00-README.md`. If this file is older than the last commit, the system has drifted — fix it before
> doing anything else.
>
> Update at the end of **every** working session. See `09-WORKING-AGREEMENT.md` Part A.

---

## Right now

**Phase:** 0 — Fix the differentiator (in progress)
**Working on:** `KB-003` just completed. Next up: `KB-002`.
**Next action:** `KB-002` — command matcher (`domain/commands.ts`).
**Build tool: Antigravity**, Local mode, `main` branch until real code starts (then ticket branches).
**Model policy:** Flash for scaffolding and mechanical work; **thinking-tier (Opus/Sonnet) for
`KB-005`, `KB-005b`, RLS and the sync worker** — those are where an invisible mistake costs months.
No MCPs until Phase 1 (Supabase, read-only token).

**⚠️ Still outstanding: rotate the Groq and Gemini keys.** `.gitignore` is fixed and the repo is
clean (verified: the old repo had zero commits, so nothing ever leaked), but the keys have been in a
distributed zip.
**Blocked on:** nothing
**Codebase in play:** `src/domain/money.ts` and `src/domain/catalog.ts` (`KB-003`, done). **Phase 0
builds `src/domain/` in the new stack.** The predecessor is a reference for knowledge only — its
implementation is not carried forward.

**⚠️ Live risk:** Groq and Gemini API keys are exposed in a distributed `.env.local`, and
`.gitignore` does not exclude it. `KB-001` closes this. It is fifteen minutes and should be done
before anything else.

---

## Phase progress

| Phase | Scope | Status |
|---|---|---|
| **0** | Build `domain/` + eval harness, new codebase | ⬜ Not started |
| 1 | Foundation: scaffold, Supabase, schema, RLS, auth, sync | ⬜ Not started |
| 2 | Voice pipeline: catalog index, layers 1–4, learning | ⬜ Not started |
| 3 | Billing UI, receipt, history, catalog screen | ⬜ Not started |
| 4 | Pilot hardening, PWA, 20-bill validation run | ⬜ Not started |
| — | Capacitor Android wrapper | ⬜ After Phase 4 |

---

## Ticket board

Legend: ⬜ todo · 🟦 in progress · ✅ done · ⛔ blocked · ⏸️ parked

### Phase 0 — Fix the differentiator

| ID | Ticket | Status | Notes |
|---|---|---|---|
| KB-001 | Rotate keys, fix `.gitignore` | 🟦 | `.gitignore` done + committed. **Key rotation still outstanding.** |
| KB-000 | Repo + `domain/` scaffold | ✅ | Vite + React + TS + Vitest + Tailwind v4 (`@theme` in CSS) tokens. `legacy/` excluded from tsconfig. This row was stale for two sessions — see note below. |
| KB-003 | `domain/money.ts` + `domain/catalog.ts` | ✅ **Done** | Integer paise, half-up rounding (D11). 482 products seeded from `legacy/products.js` via committed `scripts/build-catalog-seed.ts` (`npm run seed:catalog`). Category is two fields (D12): `sourceCategory` (48 positional headers, provenance only) and `guardCategory` (16 semantic buckets — for `KB-005b`; `other` is 1.9% of the catalog). Aggregate rupee→paise sum check passes. Committed. |
| KB-002 | `domain/commands.ts` | ⬜ | Whole-utterance matching. Test: no catalog alias may finalise a bill. |
| KB-004 | Eval harness (Node) | ⬜ | Prices from catalog at runtime; match on id; separate transcription from parsing errors |
| KB-005 | **`domain/grammar.ts` — pricing grammar** | ⬜ | Five rules, failing tests first. **Resolve the `paune`/`chataak` conflict here.** Use a thinking-tier model. |
| KB-005b | `domain/validator.ts` + `domain/catalogIndex.ts` | ⬜ | Rules ported, not code. Prefix + n-gram index, not O(n). |
| KB-005c | CLI harness | ⬜ | `npm run try "..."`. Mitigates Phase 0 having no visible output. |
| KB-008 | `domain/learning.ts` | ⬜ | Three-tier rules, pure functions |
| KB-006 | Number benchmark (100 utterances) | ⬜ | The metric no ASR vendor publishes |
| KB-007 | Shop vocabulary phrase biasing | ⬜ | Top ~40 names as Whisper `prompt`, capped 600 chars |
| **KB-009** | **Fast-path coverage probe** | ⬜ | **See R1.** Measure before committing to the cost model. |

**Phase 0 exit gate:** all five pricing rules pass (incl. `ka` vs `wala` on identical phrasing) ·
25/25 eval baseline recorded · number-accuracy baseline recorded · **fast-path coverage measured** ·
catalog index under 16 ms at 10,000 products.

> If coverage comes back under ~40%, **stop before Phase 1.** See R1.

### Phases 1–4

Not started. See `06-FEATURE-TICKETS.md` for the full list (KB-101 … KB-406).

---

## Open risks

| # | Risk | Severity | Status |
|---|---|---|---|
| **R1** | **Fast-path coverage of 60–70% is an assumption, not a measurement.** The entire cost model, the latency story and the compounding-moat argument all rest on it. If real coverage is 30%, cost per bill roughly doubles and the product is not sellable at Indian price points. | **HIGH** | Open — `KB-008` added to measure it in Phase 0 |
| R2 | The pricing grammar — the core differentiator — currently fails its own tests | HIGH | `KB-005` |
| R3 | API keys exposed in a distributed archive | HIGH | `KB-001` |
| R4 | Local-first sync is the most complex thing in the plan for a solo developer | MEDIUM | Mitigated by immutable bills; revisit if Phase 1 overruns |
| R5 | Phrase biasing improving recognition is an assumption | MEDIUM | `KB-007` measures it |
| R6 | 14-week estimate has no historical basis | MEDIUM | Re-estimate after Phase 0 actuals |
| R7 | Number-safety flags may prove annoying enough to be ignored | LOW | Watch during the pilot run |

---

## Decisions pending

| # | Question | Needed by |
|---|---|---|
| — | **All closed as of 17 Aug 2026.** See `07-DECISIONS.md` rev 3. | — |

---

## Recent changes

| Date | What | By |
|---|---|---|
| 09 Sep 2026 | **`KB-003` finished and committed.** Owner caught that the 8-bucket `guardCategory` design left 58% of the catalog as `other` — the six-plus-hygiene buckets came from `legacy/products.js`'s mishearing-driven `CATEGORY_GUARDS`, not a real taxonomy of the shop's stock. Expanded to 16 buckets (`dairy`, `snack`, `sweet`, `beverage`, `condiment`, `dryfruit`, `household`, `medicine` added), bringing `other` to 1.9% (9 of 482 — `EGGS` and 7 baking-ingredient products that genuinely fit nothing). `07-DECISIONS.md` D12 amended in place (new dated line, original not rewritten); `03-DATA-MODEL.md` and `14-LEGACY-REFERENCE.md` §5 updated to match. | Agent + Owner |
| 08 Sep 2026 | **`KB-003` category redesigned to two fields.** Owner: `guardCategory` needs to be the validator's real semantic bucket, not the 48 raw positional headers, and needs a 7th bucket (`hygiene`, split from `soap`) plus `other` — new decision `07-DECISIONS.md` D12. `CatalogEntry` now carries `sourceCategory` (provenance, all 48) and `guardCategory` (8 buckets), mapped by an explicit, committed, per-category table with per-id overrides for the ~15 headers that mix categories (worst: `GRAINS / SEEDS`). `14-LEGACY-REFERENCE.md` section 5 and `03-DATA-MODEL.md`'s `base_products` schema updated to match. | Agent + Owner |
| 08 Sep 2026 | **`KB-003` corrected post-review.** Category *is* derivable — `legacy/products.js` groups products under 48 comment headers (owner caught that `14-LEGACY-REFERENCE.md` wrongly said "24 categories" and wrongly said category was a per-product field). `scripts/build-catalog-seed.ts` now assigns `CatalogEntry.category` positionally and reports per-category counts. Catalog price test tightened from non-negative to strictly positive (a zero-price product is a silent free line item). Seed script now sums all source rupee prices and all output paise and asserts they match, printed in the report. `14-LEGACY-REFERENCE.md` section 9 corrected; `12-PARKED.md` NI-14 closed. | Agent + Owner |
| 08 Sep 2026 | **`KB-003` done.** `domain/money.ts` (integer-paise arithmetic, half-up rounding) and `domain/catalog.ts` (types + 482-product seed) added, both unit-tested (28 tests). Rounding mode corrected from banker's to half-up mid-ticket — new decision `07-DECISIONS.md` D11, `03-DATA-MODEL.md` section 8 updated. Catalog seed is generated by a committed, reproducible script (`scripts/build-catalog-seed.ts`, `npm run seed:catalog`) rather than a one-off transform, per the owner's correction. Added `tsx` and `@types/node` as dev-only dependencies to run it — `11-STACK-DECISIONS.md` SD-017/SD-018. | Agent + Owner |
| 08 Sep 2026 | **This tracker was stale.** The `KB-000` row still said ⬜ and "Right now" still said "nothing yet" even though `KB-000` (scaffold) and `18-AGENT-CONTRACT.md` had already been committed in the prior two sessions. Corrected now; flagged during an onboarding pass first. | Agent |
| 20 Aug 2026 | **`18-AGENT-CONTRACT.md` added** — binding operating contract for every agent session: flow, 10 STOP conditions, 12 hard rules, manual-step protocol, per-ticket proof standards. Session opener reduced to one line. | Owner |
| 20 Aug 2026 | **A0 onboarding run.** Agent found 4 real doc inconsistencies — all fixed: A0 prompt said "six" non-negotiables (there are eight); `04-VOICE-PIPELINE` §10 still listed O2/O3/O4 as open; `KB-009` missing from the ticket list; this tracker's Phase 0 list was stale rev-1 content. PRD timeline reconciled to 15 weeks. | Agent + Owner |
| 20 Aug 2026 | Design mockups validated `13-DESIGN.md`. Rev 2 adds button hierarchy, number-display rules, bilingual search labels. Two improvements adopted from the mockup: "Theek hai" acknowledge button, Devanagari sublabels. | Owner |
| 19 Aug 2026 | Repo created (`anshg05/kiranabill`, private), restructured, docs committed, pushed. `.gitattributes` added. | Owner |
| 18 Aug 2026 | **Build tool decided: Antigravity, single tool through MVP.** Lovable dropped. MCPs deferred to Phase 1. Mermaid adopted for diagrams; `16-APP-FLOW.md` added. Graphify parked as NI-13. | Owner |
| 17 Aug 2026 | O2 dropped (Sarvam). O3 void — no such experiment ever happened. **O4 closed: Pilloo does NOT distinguish `ka`/`wala` — pricing grammar confirmed as a real differentiator.** | Owner |
| 17 Aug 2026 | Phase 0 restructured: build `domain/` fresh instead of patching the old codebase. Old code is reference-only. | Owner |
| 17 Aug 2026 | Stack closed: Tailwind, Dexie, SheetJS. `13-DESIGN.md` added. Catalog source-of-truth clarified (Postgres, client caches). | Planning |
| 16 Aug 2026 | Documentation set completed. Working agreement, tracker, stack decisions and parked list added. | Planning |
| 16 Aug 2026 | Offline decision reversed: offline levels 1–2 now in MVP. Local-first architecture adopted. | Owner |
| 16 Aug 2026 | Catalog matching threshold corrected from 5,000 to ~1,000 (current code) after benchmarking | Benchmark |
| 16 Aug 2026 | Learning engine promoted to its own document and named as the primary moat | Owner |
| 15 Aug 2026 | Competitive field testing completed: Pilloo, VocoBill, Biller, VoiceKhata | Owner |

---

## Metrics

Recorded once measurement begins. **Empty is honest; do not fill with estimates.**

| Metric | Baseline | Current | Target |
|---|---|---|---|
| Eval: pass / warn / fail / skip | 0 / 10 / 3 / 12 | — | 25 / 0 / 0 / 0 |
| Number-accuracy benchmark | not measured | — | ≥ 95% |
| Fast-path coverage | not measured | — | ≥ 60% |
| Median turns-to-bill | not measured | — | 1 |
| Median seconds-to-bill | ~4 s (estimated) | — | < 2 s fast path |
| Silent number errors / 20 bills | not measured | — | **0** |
| Cost per bill | ₹0.161 (calculated) | — | < ₹0.05 |

---

## How to update this file

At the end of every session:

1. Move ticket statuses
2. Update **Right now**
3. Add a row to **Recent changes**
4. Add any new risk to **Open risks**
5. Fill in any metric that got measured
6. Change **Last updated** at the top

Keep it factual. A tracker that says work is done when it isn't is worse than no tracker, because
the next AI will build on the lie.
