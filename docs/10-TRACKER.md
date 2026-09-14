# 10 — Tracker

**Last updated:** 14 Sep 2026 (rev 11) · **Current phase:** Phase 0 in progress

> **This is the project's current state.** Any AI joining the project reads this second, right after
> `00-README.md`. If this file is older than the last commit, the system has drifted — fix it before
> doing anything else.
>
> Update at the end of **every** working session. See `09-WORKING-AGREEMENT.md` Part A.

---

## Right now

**Phase:** 0 — Fix the differentiator (in progress)
**Working on:** `KB-005` just completed. Next up: `KB-005b`.
**Next action:** `KB-005b` — `domain/validator.ts` + `domain/catalogIndex.ts`. Replaces `grammar.ts`'s exact-match stopgap with a real indexed/fuzzy matcher; see KI-20 (duplicate catalog alias) and D14 (count-unit compatibility) for known gaps that ticket should look at.
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
| **0** | Build `domain/` + eval harness, new codebase | 🟦 In progress (KB-000 done) |
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
| KB-000 | Repo + `domain/` scaffold | ✅ | Done 20 Aug. React 19, TS 5.8, Vite 6, Vitest 3, **Tailwind v4** (`@theme` in `src/index.css`, no config file, no PostCSS). `npm test` ✓ · `tsc --noEmit` ✓ · `npm run build` ✓. All 12 tokens present. `legacy/` excluded from tsconfig. |
| KB-003 | `domain/money.ts` + `domain/catalog.ts` | ✅ **Done** | Integer paise, half-up rounding (D11). 482 products seeded from `legacy/products.js` via committed `scripts/build-catalog-seed.ts` (`npm run seed:catalog`). Category is two fields (D12): `sourceCategory` (48 positional headers, provenance only) and `guardCategory` (16 semantic buckets — for `KB-005b`; `other` is 1.9% of the catalog). Aggregate rupee→paise sum check passes. Committed. |
| KB-002 | `domain/commands.ts` | ✅ **Done** | Whole-utterance matching: whole token / contiguous token-sequence only (never a substring of a longer token), no digit anywhere, ≤6 tokens after filler-stripping, longest match wins on overlap. Latin vocabulary ported verbatim from `legacy/voice.js` (not in `14-LEGACY-REFERENCE.md` — that only recorded the KI-02 defect, not the word list); Devanagari phrases added new, pending owner review of the Hindi. 37 tests incl. full 482-alias sweep (zero false positives) and the KI-02 regression (`"basmati"`, `"basmati chawal"` → `null`). Closes KI-02. |
| KB-004 | Eval harness (Node) | ✅ **Done** | `eval/run-eval.ts`. Every `expectedItem` carries a `catalogId`; `priceType: "default"` prices derived from the live catalog at run time, never stored; remaining literal prices are integer paise. **No parser exists yet (`KB-005`)** — all 25 cases report `skip` deliberately, not a stub. Confirmed the documented Chini price drift (₹43 fixture vs ₹45 live) is real. Closes KI-17. |
| KB-005 | **`domain/grammar.ts` — pricing grammar** | ✅ **Done** | All five rules; tests written first, 30 cases, all catalog ids verified before implementation. `ka`/`wala` differentiator confirmed different (₹30 vs ₹150 on identical phrasing). `paune`/`sawa` resolved as compositional, `dedh`/`dhai` fixed, `chataak`=50g unit — see `07-DECISIONS.md` D13. Exact-match-only catalog lookup, a deliberate `KB-005b` stopgap. Found in passing: KI-20 (duplicate catalog alias), D14 (count-unit compatibility, not pre-approved — flagged for review). |
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
| 14 Sep 2026 | **`KB-005` finished and committed — the differentiator.** `domain/grammar.ts`. Tests written first as their own reviewed step (`grammar.test.ts`, 30 cases), approved before any implementation existed; every catalog id used in the tests verified against `catalog-seed.json` before writing code. Confirms the actual differentiator: `"5 kg chawal 30 ka"` → ₹30, `"...30 wala"` → ₹150, on identical phrasing. Re-derived the five rules as deterministic logic rather than porting the old Gemini prompt verbatim — that prompt (`14-LEGACY-REFERENCE.md` section 1) turned out to internally contradict itself on "total price, no qty/unit spoken," resolved by falling back to the catalog's own unit when the product resolves. `paune`/`sawa` resolved as compositional (`"paune do"` = 1.75, not the old hardcoded 0.75), `dedh`/`dhai` stay fixed, `chataak` reinterpreted as a 50g unit rather than a fraction — all four calls recorded in `07-DECISIONS.md` D13. Catalog matching is a deliberate exact-string-only stopgap; `KB-005b` replaces it with the real indexed/fuzzy matcher. Two things found in passing and parked rather than fixed here: KI-20 (`12-PARKED.md`) — two catalog products share the alias "bath sabun"; D14 (`07-DECISIONS.md`) — count units (piece/packet/...) treated as interchangeable for default pricing, a call made during implementation, not pre-approved, flagged for review. NI-21 also opened this session: `14-LEGACY-REFERENCE.md`'s verbatim Gemini prompt still has the qty/unit contradiction `grammar.ts` just resolved — `KB-205`'s LLM fallback needs the same fix or Layer 1/Layer 2 can disagree on identical input. | Agent + Owner |
| 14 Sep 2026 | **`KB-004` finished and committed.** `eval/run-eval.ts` — Node eval harness over the 25 fixtures in `eval/voice-cases.json`. Every `expectedItem` now carries a hand-resolved `catalogId`; `priceType: "default"` items no longer store `rate`/`total` at all (derived from the live catalog every run via `lineTotalPaise()`); remaining literal spoken prices converted from rupee decimals to integer paise. `displayName` is now a note only — the harness reports the catalog's current name for each `catalogId`. **`KB-004` runs before `KB-005` exists in the canonical order, so there is no parser to call yet** — decided with the owner to report all 25 cases as `skip` ("no parser wired — KB-005") rather than build a stub parser that would manufacture fake pass/fail numbers. Verified the documented price drift is real, not theoretical: VC001's Chini fixture had a hardcoded rate of ₹43; the live catalog (`id 27`) has moved to ₹45 — worth having on record for when `KB-005` runs against this harness. Closes KI-17. | Agent + Owner |
| 14 Sep 2026 | **`KB-002` finished and committed.** `domain/commands.ts` — whole-utterance voice command matcher (finalize/removeLast/clearAll). Fixes KI-02: the predecessor's `text.includes("bas")` finalised the bill on "basmati" (8 aliases across 5 products collided). The new rule requires a whole token or exact contiguous token sequence (never a substring of a longer token), rejects any utterance containing a digit, and caps utterance length at 6 tokens after filler-stripping — three corrections made together with the owner after the first two proposed rules were each shown, with a real catalog example, to still misfire on "basmati". Command vocabulary itself came from `legacy/voice.js` directly, not `14-LEGACY-REFERENCE.md` — that doc recorded the *defect* but never extracted the actual word list, a gap worth knowing about for future tickets that assume the reference doc is complete. Devanagari command phrases (`बस`, `हो गया`, `हटाओ`, `सब हटाओ`, etc.) are new, not ported from legacy — **owner should review the Hindi in `commands.ts`'s comments.** 37 tests added, including the full 482-alias sweep required by `18-AGENT-CONTRACT.md` §8 (zero false positives). `docs/12-PARKED.md` KI-02 closed. | Agent + Owner |
| 14 Sep 2026 | **`origin/main` restored to match local `main`.** An unauthorised tool run ("Ideavo AI") had pushed 6 unwanted commits to `origin/main` (`.ideavo/` scaffolding, an `.e2b.app` sandbox hook in `vite.config.ts`, a deletion of `.env.example`, a fabricated `KB-000` tracker entry). Nothing on it was worth keeping. Force-pushed (`--force-with-lease`) local `main` (tip `7530204`, later `e255994`) over it; the discarded commits are kept locally on branch `ideavo-backup` (not pushed). Also: untracked `tsconfig.tsbuildinfo` (`.gitignore` already excluded it, just wasn't retroactively applied) and deleted a stale, git-unregistered `.claude/worktrees/onboarding-docs-review-883d5d` directory left over from a prior session that ran outside the main checkout — see `12-PARKED.md` NI-20 for the open question of why that happened and how to prevent it. Verified before pushing: 32/32 tests, both `tsc --noEmit` runs clean, catalog seed sum MATCH. | Agent + Owner |
| 09 Sep 2026 | **`KB-003` finished and committed.** Owner caught that the 8-bucket `guardCategory` design left 58% of the catalog as `other` — the six-plus-hygiene buckets came from `legacy/products.js`'s mishearing-driven `CATEGORY_GUARDS`, not a real taxonomy of the shop's stock. Expanded to 16 buckets (`dairy`, `snack`, `sweet`, `beverage`, `condiment`, `dryfruit`, `household`, `medicine` added), bringing `other` to 1.9% (9 of 482 — `EGGS` and 7 baking-ingredient products that genuinely fit nothing). `07-DECISIONS.md` D12 amended in place (new dated line, original not rewritten); `03-DATA-MODEL.md` and `14-LEGACY-REFERENCE.md` §5 updated to match. | Agent + Owner |
| 08 Sep 2026 | **`KB-003` category redesigned to two fields.** Owner: `guardCategory` needs to be the validator's real semantic bucket, not the 48 raw positional headers, and needs a 7th bucket (`hygiene`, split from `soap`) plus `other` — new decision `07-DECISIONS.md` D12. `CatalogEntry` now carries `sourceCategory` (provenance, all 48) and `guardCategory` (8 buckets), mapped by an explicit, committed, per-category table with per-id overrides for the ~15 headers that mix categories (worst: `GRAINS / SEEDS`). `14-LEGACY-REFERENCE.md` section 5 and `03-DATA-MODEL.md`'s `base_products` schema updated to match. | Agent + Owner |
| 08 Sep 2026 | **`KB-003` corrected post-review.** Category *is* derivable — `legacy/products.js` groups products under 48 comment headers (owner caught that `14-LEGACY-REFERENCE.md` wrongly said "24 categories" and wrongly said category was a per-product field). `scripts/build-catalog-seed.ts` now assigns `CatalogEntry.category` positionally and reports per-category counts. Catalog price test tightened from non-negative to strictly positive (a zero-price product is a silent free line item). Seed script now sums all source rupee prices and all output paise and asserts they match, printed in the report. `14-LEGACY-REFERENCE.md` section 9 corrected; `12-PARKED.md` NI-14 closed. | Agent + Owner |
| 08 Sep 2026 | **`KB-003` done.** `domain/money.ts` (integer-paise arithmetic, half-up rounding) and `domain/catalog.ts` (types + 482-product seed) added, both unit-tested (28 tests). Rounding mode corrected from banker's to half-up mid-ticket — new decision `07-DECISIONS.md` D11, `03-DATA-MODEL.md` section 8 updated. Catalog seed is generated by a committed, reproducible script (`scripts/build-catalog-seed.ts`, `npm run seed:catalog`) rather than a one-off transform, per the owner's correction. Added `tsx` and `@types/node` as dev-only dependencies to run it — `11-STACK-DECISIONS.md` SD-017/SD-018. | Agent + Owner |
| 08 Sep 2026 | **This tracker was stale.** The `KB-000` row still said ⬜ and "Right now" still said "nothing yet" even though `KB-000` (scaffold) and `18-AGENT-CONTRACT.md` had already been committed in the prior two sessions. Corrected now; flagged during an onboarding pass first. | Agent |
| 21 Aug 2026 | **Claude Code onboarding run.** Found 4 more real doc errors, all fixed: `06` Phase 0 ticket order contradicted three other docs (plus a duplicated `KB-004`); `SD-011` and `13-DESIGN` §8 still described a Tailwind **v3** `tailwind.config.ts` that doesn't exist; this tracker had `KB-000` as todo after it shipped; `legacy/README.md` was never created. `15-BUILD-GUIDE` was also missing `KB-007`. | Agent + Owner |
| 21 Aug 2026 | Switched build tool: **Antigravity → Claude Code** (Antigravity quota exhausted mid-`KB-000`). `CLAUDE.md` added as the auto-loaded entry point. Handoff cost: zero — the new tool picked up from the docs. | Owner |
| 20 Aug 2026 | **`KB-000` complete.** Tailwind **v4** pinned. Branch workflow dropped — solo dev works on `main`, committing after each working step. | Owner |
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
| Eval: pass / warn / fail / skip | 0 / 10 / 3 / 12 | 0 / 0 / 0 / 25 (`npm run eval`, no parser wired yet) | 25 / 0 / 0 / 0 |
| `KB-000` toolchain | — | ✅ test, tsc, build all clean | — |
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
