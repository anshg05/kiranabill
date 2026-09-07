# 10 — Tracker

**Last updated:** 21 Aug 2026 (rev 6) · **Current phase:** Phase 0 in progress

> **This is the project's current state.** Any AI joining the project reads this second, right after
> `00-README.md`. If this file is older than the last commit, the system has drifted — fix it before
> doing anything else.
>
> Update at the end of **every** working session. See `09-WORKING-AGREEMENT.md` Part A.

---

## Right now

**Phase:** 0 — Building `domain/` (in progress)
**Working on:** `KB-003` next — `domain/money.ts` + `domain/catalog.ts`
**Next action:** `KB-000` — scaffold. Then `KB-003`.
**Build tool: Antigravity**, Local mode, `main` branch until real code starts (then ticket branches).
**Model policy:** Flash for scaffolding and mechanical work; **thinking-tier (Opus/Sonnet) for
`KB-005`, `KB-005b`, RLS and the sync worker** — those are where an invisible mistake costs months.
No MCPs until Phase 1 (Supabase, read-only token).

**⚠️ Still outstanding: rotate the Groq and Gemini keys.** `.gitignore` is fixed and the repo is
clean (verified: the old repo had zero commits, so nothing ever leaked), but the keys have been in a
distributed zip.
**Blocked on:** nothing
**Codebase in play:** none yet. **Phase 0 builds `src/domain/` in the new stack.** The predecessor
is a reference for knowledge only — its implementation is not carried forward.

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
| KB-000 | Repo + `domain/` scaffold | ✅ | Done 20 Aug. React 19, TS 5.8, Vite 6, Vitest 3, **Tailwind v4** (`@theme` in `src/index.css`, no config file, no PostCSS). `npm test` ✓ · `tsc --noEmit` ✓ · `npm run build` ✓. All 12 tokens present. |
| KB-003 | `domain/money.ts` + `domain/catalog.ts` | ⬜ | Integer paise; seed 482 products from `legacy/products.js` |
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
| Eval: pass / warn / fail / skip | 0 / 10 / 3 / 12 | — | 25 / 0 / 0 / 0 |
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
