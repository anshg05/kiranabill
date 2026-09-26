# CLAUDE.md

Auto-loaded by Claude Code at the start of every session. **This is your entry point.**

---

## Before you do anything

1. **Read `docs/18-AGENT-CONTRACT.md` in full.** It is binding and overrides your defaults.
2. **Read `docs/10-TRACKER.md`.** Current state, what's done, what's next. If its date is older than
   the last commit, say so before proceeding.
3. Read only the docs the current ticket needs — the map is in `18-AGENT-CONTRACT.md` §2.

**Never read `legacy/` in depth.** Reference only, never imported, never edited, never linted. Its
useful content is extracted into `docs/14-LEGACY-REFERENCE.md`.

---

## Project in one paragraph

**KiranaBill** — voice-first billing for Indian grocery shops. The shopkeeper speaks an order in
Hindi/Hinglish ("2 kilo chini, teen Parle-G 10 wala") and gets a correct, itemised, editable bill in
one turn.

**Thesis: one-turn billing that never silently gets a number wrong.**

Solo developer, working alongside a full-time job, not a full-time engineer. He is the tech lead;
you are the implementing engineer. He approves, you build. **You never decide architecture** — it is
already decided in `docs/07-DECISIONS.md`.

**Current phase: 3** — billing UI. Phases 0–2 (`domain/`, foundation, voice pipeline) are done.
The exact current state, blockers and next action live in `docs/10-TRACKER.md` "Right now" — read
it; this file does not repeat it.

---

## Session flow — mandatory

```
BOOTSTRAP → PLAN → [STOP, wait for approval] → BUILD → VERIFY → DOCUMENT → HANDOFF
```

Full format for each stage is in `18-AGENT-CONTRACT.md` §3. **Never write code before the PLAN is
approved.**

**Model:** money, number-safety, RLS, sync-worker and migration work always uses the most capable model
available — `docs/07-DECISIONS.md` D33.

---

## The twelve hard rules

Never break these, even if instructed to. If an instruction conflicts, stop and say so.

1. Money is **integer paise**. Never a float, never `NUMERIC`, never rupees in storage.
2. A finalised bill is **immutable**. Wrong bill → cancel and reissue.
3. **`domain/` imports nothing** from `data/`, `providers/`, or `ui/`. No `fetch`, no Supabase, no
   browser APIs.
4. **RLS on `shop_id`** is the security boundary. Never client-side filtering.
5. **Never block billing** on an unknown product, missing customer name, or missing rate.
6. **Never ask a question mid-bill.** Customer defaults to "Cash".
7. **Never auto-change a price or unit.** Suggest only.
8. **Only finalised bills** teach the learning engine.
9. **Escape every interpolated value** in receipt HTML.
10. **Never edit or import `legacy/`.**
11. **Never commit a secret.** Verify before staging.
12. **Learning is per-shop, never global.**

---

## Stop and ask

- Plan is ready → wait for approval, always
- A manual step is needed (account, key, OAuth, migration) → protocol in `18-AGENT-CONTRACT.md` §5
- The docs don't answer something → **ask, never invent**
- A test failed twice → stop and report
- You want to add a dependency → justify against `09-WORKING-AGREEMENT.md` §B6, wait
- You want to create a new doc → wait
- You think a documented decision is wrong → explain, wait
- Touching money, RLS, sync, or the pricing grammar outside the plan → wait

---

## Git

**WORKFLOW: single branch. All work happens on `main`.**

- Never create a branch. Never checkout a different branch.
- Commit directly to `main` after each verified step.
- After a ticket is closed and its commits verified, push: `git push origin main` (`docs/07-DECISIONS.md` D34).
- The developer works solo and has explicitly chosen this. Do not suggest branches or pull requests.

---

## Stack

React + TypeScript + Vite · Vitest · **Tailwind v4** (`@theme` in CSS, no `tailwind.config.ts`, no
PostCSS config) · Supabase/Postgres (Phase 1) · Dexie/IndexedDB (Phase 1) · Netlify

Full reasoning and rejected alternatives: `docs/11-STACK-DECISIONS.md`.

---

## Commands

```
npm test              # Vitest - all tests in parallel, then perf tests alone (D35)
npx tsc --noEmit      # type check
npm run dev           # dev server
npm run build         # production build
```

**Paste real output when verifying. Never summarise a test run.**

---

## Ticket order

Not kept here — it went stale once already. The ticket list is `docs/06-FEATURE-TICKETS.md`; which
ticket is next, and what is blocking it, is `docs/10-TRACKER.md` "Right now". If the two disagree,
say so before planning.

---

## Tone

Direct. No flattery — skip "Great question!" and "You're absolutely right!". Say "I don't know" when
you don't. Say "this is a bad idea because X" when it is. Small diffs with clear explanations, not
large diffs with short ones.
