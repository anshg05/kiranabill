# 10 — Tracker

**Last updated:** 18 Aug 2026 (rev 3) · **Current phase:** Phase 0 not started

> **This is the project's current state.** Any AI joining the project reads this second, right after
> `00-README.md`. If this file is older than the last commit, the system has drifted — fix it before
> doing anything else.
>
> Update at the end of **every** working session. See `09-WORKING-AGREEMENT.md` Part A.

---

## Right now

**Phase:** 0 — Fix the differentiator (not started)
**Working on:** nothing yet
**Next action:** **Session one — folder restructure, no AI.** See `15-BUILD-GUIDE.md` §3.
Then `KB-001` (rotate keys), then `KB-000` (scaffold) in Antigravity.
**Build tool: Antigravity.** Codex as backup only. No MCPs until Phase 1.
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
| KB-001 | Rotate keys, fix `.gitignore` | ⬜ | **Do first.** Ignore file before rotation. |
| KB-002 | Fix `bas`/basmati command collision | ⬜ | Fix written and tested — 0 collisions across 482 products. Needs wiring in. |
| KB-003 | Instrument everything | ⬜ | Capture Gemini `usageMetadata`, currently discarded |
| KB-004 | Rebuild the eval | ⬜ | Derive prices from catalog; match on id; run all 25 live |
| KB-005 | **Fix the pricing grammar** | ⬜ | VC013 returns ₹100 instead of ₹30. Write failing tests first. |
| KB-006 | Number benchmark (100 utterances) | ⬜ | The metric nobody publishes |
| KB-007 | Shop vocabulary phrase biasing | ⬜ | Code written, needs wiring + measurement |
| **KB-008** | **Fast-path coverage probe** | ⬜ | **New — see Open Risks.** Measure achievable coverage before committing to the cost model. |

**Phase 0 exit gate:** pricing grammar passes every test · number-accuracy baseline recorded ·
fast-path coverage measured.

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
