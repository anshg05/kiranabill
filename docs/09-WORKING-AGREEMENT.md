# 09 — Working Agreement

**Last updated:** 27 Sep 2026 (rev 7) · **Status:** Active from first commit

How work gets done on this project. Engineering standards, the AI session protocol, and the
definition of done.

**This document exists because the project must not depend on any single AI remembering anything.**

---

## Part A — The AI session protocol

### A0. The onboarding session — run ONCE, per tool

Before any ticket, run one session whose only output is understanding. **No code is written.**

This is the exception to "never dump everything at the agent." It happens once, deliberately, with
nothing at stake — and it is what makes every later session able to work from a single ticket.

```
This is the KiranaBill project. You are joining as the developer's AI pair.
This session is ONBOARDING ONLY. Do not write, create, or modify any code or
any file. Your only output is a written summary.

Read, in this order, completely:
  docs/00-README.md
  docs/01-PRD.md
  docs/07-DECISIONS.md
  docs/02-ARCHITECTURE.md
  docs/03-DATA-MODEL.md
  docs/04-VOICE-PIPELINE.md
  docs/08-LEARNING-ENGINE.md
  docs/16-APP-FLOW.md
  docs/05-FRONTEND-SPEC.md
  docs/13-DESIGN.md
  docs/06-FEATURE-TICKETS.md
  docs/09-WORKING-AGREEMENT.md
  docs/10-TRACKER.md
  docs/11-STACK-DECISIONS.md
  docs/12-PARKED.md
  docs/14-LEGACY-REFERENCE.md
  docs/15-BUILD-GUIDE.md
  docs/17-MANUAL-TASKS.md

Then list the files in legacy/ WITHOUT reading them in depth. legacy/ is
reference material only, never imported, never edited. Its useful content is
already extracted into docs/14-LEGACY-REFERENCE.md.

Now write a summary covering:
 1. What this product is, and the single sentence that is its thesis
 2. Who the user is and what specifically fails for them today
 3. The five layers of the voice pipeline and why layer 1 exists
 4. All EIGHT non-negotiables from 00-README (there are eight - if you list
    only six you stopped early)
 5. Why "never silently wrong about a number" is treated differently
    from product-name errors
 6. What phase we are in and what the very next ticket is
 7. Which parts of the old codebase are being kept, and which discarded
 8. Three things you are NOT allowed to do without asking me
 9. Anything in these documents that is unclear, contradictory, or that you
    think is a mistake - be direct, I want to know

Do not start any work. End your response with the summary.
```

**Read that summary carefully.** If the agent gets the thesis wrong, or thinks udhaar is in scope,
or wants to store money as a float — correct it now, in a session where nothing can break. This is
the cheapest possible place to catch a misunderstanding.

Re-run A0 whenever you switch tools, or after a long gap.

### A1. The bootstrap prompt

**Superseded in practice by `18-AGENT-CONTRACT.md`**, which holds the full operating rules in the
repo. The one-line session opener is:

```
Read docs/18-AGENT-CONTRACT.md in full and follow it. Then read docs/10-TRACKER.md.
Today's ticket is KB-XXX. Give me your PLAN and stop.
```

The longer prompt below remains valid for a tool that cannot read repo files, or as a fallback if
the contract is ever unavailable.

```
This is the KiranaBill project. I am the solo developer. You are joining an
existing project with established decisions.

Before you write or suggest any code:

1. Read docs/00-README.md
2. Read docs/10-TRACKER.md          — current state, what's done, what's next
3. Read docs/07-DECISIONS.md        — every decision and why
4. Read docs/09-WORKING-AGREEMENT.md — standards you must follow
5. Read the docs relevant to the ticket (listed in the ticket itself)
6. Inspect the actual code you're about to change

Then, before implementing:
- Tell me in your own words what this project is and what phase it's in
- Tell me what the ticket requires
- List any assumption you're making that isn't in the docs
- Ask about anything the docs don't answer — DO NOT INVENT IT

Rules that override anything you would otherwise do:
- Never invent an architectural decision. If it isn't in 07-DECISIONS.md, ask.
- Never change the money representation. Integer paise, everywhere.
- Never make a finalised bill mutable.
- Never add a dependency without asking.
- Never restructure directories without asking.
- If you think a documented decision is wrong, SAY SO and explain — but do not
  silently do something different.

Today's ticket is: [TICKET ID]
```

### A2. Session flow

```
BOOTSTRAP → PLAN → CONFIRM → IMPLEMENT → VERIFY → DOCUMENT → HANDOFF
```

| Step | What happens | Who |
|---|---|---|
| **BOOTSTRAP** | AI reads the docs, states its understanding | AI |
| **PLAN** | AI proposes an approach, lists files it will touch | AI |
| **CONFIRM** | You approve, correct, or redirect. **Do not skip this.** | You |
| **IMPLEMENT** | AI writes code within the agreed plan | AI |
| **VERIFY** | Tests pass, eval re-run if voice/parsing touched | Both |
| **DOCUMENT** | Affected `.md` updated. Decision log updated if a decision changed. | AI drafts, you check |
| **HANDOFF** | TRACKER updated with what changed and what's next | You |

**The step that fails in practice is DOCUMENT.** An AI will write good code and leave the docs
stale, and the next AI then reads a lie. That is exactly how a project becomes vibe-coded even when
it started disciplined.

**Enforcement, since there's no CI and no team:** a ticket is not closed in the TRACKER until its
doc updates are written. The TRACKER's `Last updated` date is the canary — if it's older than your
last commit, the system has already drifted.

### A2b. Creating new documents

The agent may **propose** a new document. It must never create one unsilently.

Documents that already exist and are simply updated: `10-TRACKER.md` (every session),
`12-PARKED.md` (bugs, ideas, unknowns), `07-DECISIONS.md` (when a decision changes).

Documents created **only when their trigger fires**, and only with your explicit approval:

| Document | Trigger |
|---|---|
| `API-CONTRACTS.md` | The `/voice` endpoint contract stabilises (Phase 2) |
| `TESTING.md` | The test suite outgrows a section of `09` (Phase 2) |
| `DEPLOYMENT.md` | First real deploy (Phase 4) |
| `BACKUP-RECOVERY.md` | Real shop data exists (Phase 4) |
| `SECURITY.md` | Before a second shop |
| `SCALABILITY.md` | Before a second shop |
| `GST.md` | A shop asks for GST |
| Splitting `12-PARKED.md` | It passes ~500 lines |

**Rule for the agent:** *"If you believe a new document is needed, say what it is and why, and wait
for approval. Do not create it."*

### A3. Session end checklist

Run this yourself, every session, before you close the laptop:

```
□ Does 10-TRACKER.md reflect what I actually did today?
□ Did any decision change? → new entry in 07-DECISIONS.md (never edit the old one)
□ Did schema change? → 03-DATA-MODEL.md updated + migration committed
□ Did the voice pipeline change? → 04-VOICE-PIPELINE.md updated + eval re-run
□ New bug found but not fixed? → 12-PARKED.md, Known Issues
□ New idea I'm not doing now? → 12-PARKED.md, Suggestions
□ Something I don't understand yet? → 12-PARKED.md, Not Yet Investigated
□ Committed and pushed?
```

Five minutes. It is the difference between a project a new AI can pick up in ten minutes and one
that needs a two-hour archaeology session.

---

## Part B — Engineering standards

### B1. Code structure

```
src/
  domain/      pure TypeScript. NO imports from data/, providers/, or ui/.
  data/        IndexedDB, sync worker, Supabase client
  providers/   transcription/, parse/ — swappable behind interfaces
  ui/          React components, grouped by feature
  app/         routing, auth, top-level providers
```

**The `domain/` rule is load-bearing.** Pricing grammar, money math, validator and learning engine
live there and import nothing. That is what makes them testable without a network, a database or a
browser — and they are exactly the parts that must never silently break.

If an AI proposes putting a `fetch()` or a Supabase call inside `domain/`, that is a stop.

### B2. Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `catalog-index.ts` |
| React components | PascalCase | `BillTable.tsx` |
| Functions, variables | camelCase | `buildShopVocabulary` |
| Types, interfaces | PascalCase | `ParsedItem` |
| DB tables, columns | snake_case | `shop_products.price_paise` |
| Money fields | **always** `_paise` suffix | `rate_paise`, `total_paise` |
| Booleans | `is` / `has` / `was` prefix | `isActive`, `wasEdited` |

The `_paise` suffix is not cosmetic. It makes a float bug visible in code review.

### B3. Error handling

| Rule | |
|---|---|
| Never swallow an error silently | Log it with the `correlationId` |
| Never show a raw error to the shopkeeper | Plain-language message + a way forward |
| Network failure is expected, not exceptional | Queue and retry. Never a blocking dialog. |
| Voice failure always offers manual entry | Never a dead end |
| An error must never lose a half-built bill | Non-negotiable |

### B4. Git

**Single branch. All work happens on `main`.** Owner decision, 20 Aug 2026 — `07-DECISIONS.md` D29,
restated as the binding rule in `CLAUDE.md` "Git". This section previously prescribed feature branches
and "never commit to `main` directly"; that rule is superseded, not merely relaxed.

- Never create or check out another branch.
- Commit directly to `main` after each verified step — a commit per coherent, verified change, not one
  per ticket.
- The ticket ID in the commit message does the job a branch name used to do — it tells a future AI
  what a change was for.

Commit format: `KB-207: add Hindi fraction parsing to deterministic grammar`

**No pull requests to yourself.** A PR you approve alone is ceremony, not review. Instead: read your
own full diff (`git show`, or GitHub's commit view) after each commit.

### B5. Testing

| Layer | Tool | Coverage expectation |
|---|---|---|
| `domain/` | Vitest | **High.** Money math, grammar, validator, learning. These are the correctness core. |
| Sync + schema, real stack | Vitest, `*.e2e.test.ts`, project `e2e` — `npm run test:e2e` | **Required for any sync or schema ticket** (`07-DECISIONS.md` D37). Runs against the local Docker stack, calling the shipped code (D21, D32); refuses non-local URLs. Not part of `npm test`, which never needs Docker. |
| Performance budgets | Vitest, `*.perf.test.ts`, project `perf` | Run by `npm test` **alone, after** every other file — never in the parallel pool. Steady state only (warm-up, cold call not asserted). `07-DECISIONS.md` D35. |
| RLS policies | SQL negative tests | **Mandatory.** Two shops, zero cross-visibility, every table. |
| Voice pipeline | Eval suite + number benchmark | Re-run on every change to parsing or prompts |
| UI | Vitest + `@testing-library/react` (jsdom), then the owner in a real browser | Component tests render **real `parseUtterance()` output** from the eval fixtures, never hand-built bills; **no UI ticket closes before the owner's real-browser check** at 375px and desktop, screenshots reviewed (`07-DECISIONS.md` D39). No E2E in MVP — solo projects abandon Playwright by month three. |

**Write the failing test first** for every bug. KB-005 (the pricing grammar) is the first application
of this rule.

### B6. Dependencies

Before adding any package:

1. Can this be 30 lines of our own code? → write the 30 lines
2. Is it maintained? Last release under a year old?
3. Bundle size on a budget Android?
4. What happens if it's abandoned?

Every dependency added gets one line in `11-STACK-DECISIONS.md` saying why.

### B7. Secrets

- Never in the repo. `.gitignore` must contain `.env`, `.env.*`, `!.env.example` **before** any key
  is created.
- Only in edge-function environment variables.
- `.env.example` lists every variable name with a dummy value, so a new environment is reproducible.

---

## Part C — Definition of Done

A ticket is done when **all** of these are true:

```
□ Code works, manually verified on both phone and desktop
□ domain/ changes have unit tests
□ Voice/parsing changes: eval re-run, no regression against the recorded baseline
□ Schema changes: migration committed and applied to dev
□ No secret in the repo
□ Affected docs updated
□ 07-DECISIONS.md updated if a decision was made or changed
□ 10-TRACKER.md updated
□ Committed to main (single-branch workflow, §B4)
```

For the release gate, see `06-FEATURE-TICKETS.md`.

---

## Part D — How this project departs from the Solo Developer Playbook

The playbook is sound and its central rule — *do only the process the current stage justifies* — is
correct. But it assumes a project starting at Stage 0. **This project is not at Stage 0.**

| Playbook phase | Our status |
|---|---|
| 0 Idea | ✅ Done long ago |
| 1 Research & Discovery | ✅ **Exceeded.** Four AI research passes plus personal field testing of every competitor. |
| 2 Validation | ✅ Partially — competitor weaknesses validated by hands-on use. Product-with-users not validated. |
| 3 Prototype / POC | ✅ **Done.** `KiranaBill-Phase1-Fixed` is a working prototype with real bills. |
| 4 MVP Planning | ✅ `01-PRD.md` |
| 5 MVP Architecture & Design | ✅ Docs 02–08 |
| **6 MVP Development** | ⬅️ **We are here** |
| 7–12 | Apply progressively |

**Do not run Phases 0–4 again.** Writing `idea.md` now would be process theatre.

### Taken from the playbook

- Progressive maturity as the governing rule
- **Vertical slices** (Phase 6 Step 5) — build auth end-to-end, then billing end-to-end, never all
  frontend then all backend. This is the single best piece of advice in it for a solo developer.
- ADR discipline → implemented as `07-DECISIONS.md` and `11-STACK-DECISIONS.md`
- Definition of Done → Part C above
- Test both success and failure paths
- Scope management: record new ideas, don't interrupt current work → `12-PARKED.md`

### Deliberately not taken, yet

| Playbook item | Why not now | Adopt when |
|---|---|---|
| Pull-request workflow | A PR you approve alone is ceremony. Self-review the diff instead. | A second contributor |
| Staging environment | Doubles maintenance for one pilot user | Second shop goes live |
| Full CI/CD pipeline | GitHub Actions running tests is enough | Real users depend on releases |
| Incident response, runbooks, disaster recovery | Phase 10 discipline. Premature with one user and PITR enabled. | Paying shops |
| Release records per deploy | The TRACKER covers it at this size | Multiple shops on different versions |
| Separate `idea.md`, `research.md`, `validation.md` | Already superseded by better documents | Never |
