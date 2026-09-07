# KiranaBill — Documentation Set

**Last updated:** 20 Aug 2026 (rev 6) · **Phase:** Pre-build complete · **Status:** Ready to build

---

## What this is

KiranaBill is a **voice-first billing app for Indian grocery (kirana) shops.** The shopkeeper speaks
an order the way they'd say it out loud — *"2 kilo chini, teen Parle-G 10 wala"* — and gets a
correct, itemised, editable bill in one turn.

**Product thesis:** *One-turn billing that never silently gets a number wrong.*

---

## How to use this documentation set

These documents are the **single source of truth**. They exist primarily so that any AI tool
(Cursor, Lovable, Claude Code) or future developer can build a piece of this system correctly
without re-deriving decisions that have already been made.

**Rule for anyone — human or AI — working on this project:** read `01-PRD.md` and
`07-DECISIONS.md` before writing any code. If a decision you need isn't recorded, stop and ask.
Do not invent it.

### If you are the developer starting work

Read `15-BUILD-GUIDE.md`. Folder restructure, tool setup, phase sequence, daily loop.
**Build tool: Antigravity, all phases. Codex as backup only.**

### If you are an AI joining this project

**Read `18-AGENT-CONTRACT.md` first, in full.** It is your operating contract and it overrides your
defaults: the session flow, the ten STOP conditions, the twelve hard rules, how to hand a manual
step back to the developer, and what counts as proof that a ticket is done.

**First time on this project?** Also run the onboarding session in `09-WORKING-AGREEMENT.md` §A0 —
read everything, write a summary, touch no code.

**Every session after that:** `18-AGENT-CONTRACT.md` plus exactly one ticket. Nothing more.
Read `10-TRACKER.md` immediately after this file — it is the current state of the world.

### Reading order

| # | Document | Read it when |
|---|---|---|
| 00 | `00-README.md` | Start here (this file) |
| 01 | `01-PRD.md` | Always. Defines what we're building and what we're deliberately not. |
| 02 | `02-ARCHITECTURE.md` | Before touching system structure, hosting, or data flow |
| 03 | `03-DATA-MODEL.md` | Before touching the database, schema, or any money field |
| 04 | `04-VOICE-PIPELINE.md` | Before touching voice, parsing, matching, or the validator |
| 05 | `05-FRONTEND-SPEC.md` | Before building any screen |
| 06 | `06-FEATURE-TICKETS.md` | To pick up work. Each ticket is a self-contained prompt. |
| 07 | `07-DECISIONS.md` | Whenever you're about to make an architectural choice |
| 08 | `08-LEARNING-ENGINE.md` | Before touching learning, aliases, provisional products or prices |
| 09 | `09-WORKING-AGREEMENT.md` | **Every session.** Standards, AI protocol, definition of done. |
| 10 | `10-TRACKER.md` | **Every session.** Current state — read second, right after this file. |
| 11 | `11-STACK-DECISIONS.md` | Before adding any dependency, service or platform |
| 12 | `12-PARKED.md` | When you find a bug, have an idea, or decide not to build something |
| 13 | `13-DESIGN.md` | Before building any screen or choosing any colour, font or spacing |
| 14 | `14-LEGACY-REFERENCE.md` | Before rebuilding grammar, validator, catalog or learning — the old code's knowledge, extracted |
| 15 | `15-BUILD-GUIDE.md` | **Start here for "how do I actually begin."** Folder restructure, tool choice, phase sequence. |
| 16 | `16-APP-FLOW.md` | Before building a journey, a sequence, or anything stateful. Mermaid diagrams. |
| 17 | `17-MANUAL-TASKS.md` | Everything only the human can do — accounts, keys, OAuth, migrations, costs |
| 18 | `18-AGENT-CONTRACT.md` | **If you are an AI agent: read this first, in full. It is binding.** |

### Documents that don't exist yet, on purpose

`SECURITY.md`, `API-CONTRACTS.md`, `TESTING.md`, `DEPLOYMENT.md`, `BACKUP-RECOVERY.md`,
`SCALABILITY.md`, `GST.md`, `PERFORMANCE.md`.

`12-PARKED.md` splits into `KNOWN_ISSUES.md`, `SUGGESTIONS.md` and `NOT_YET_INVESTIGATED.md`
when it passes ~500 lines.

Each is written **when its trigger fires**, not before. `BACKUP-RECOVERY.md` when real shop data
exists. `GST.md` when a shop asks for GST. Writing them now would mean writing guesses, and guesses
in a source-of-truth document are worse than gaps.

---

## Living documents, not stone tablets

Every document carries a `Last updated` date. When a decision changes:

1. Add a **new entry** to `07-DECISIONS.md` with a date and what it supersedes. Never edit the old
   entry — the history is the point.
2. Update the affected document and bump its date.
3. Note the change in the ticket that caused it.

A ticket is **not done** until the documents it affected are updated.

---

## Project context in one paragraph

Built and maintained by one person, alongside a full-time job, using AI tools to write the code.
The pilot shop is the author's own family grocery shop, which removes the hardest problem in this
market — access to a real user. There is a working predecessor (`KiranaBill-Phase1-Fixed`, vanilla
JS, ~9,000 lines) whose voice pipeline, pricing grammar, product catalog and learning system are
being carried forward, not rewritten. The re-platform exists to make that work durable,
multi-shop and fast — not to replace it.

---

## Current state of the predecessor

| Asset | Status | Carried forward? |
|---|---|---|
| Pricing grammar (`wala`/`ka` semantics) | Built, **partially broken** — needs fixing first | Yes — this is the core IP |
| 482-product catalog with Hindi/Latin aliases | Working | Yes — becomes the shared base catalog |
| Validator (category guards, unit conversion, review flags) | Working, genuinely good | Yes — hand-tuned domain logic |
| Three-tier learning system | Working | Yes — becomes per-shop |
| Voice capture + Groq Whisper + Gemini parse | Working but slow (~4s) and expensive | Yes, restructured into 5 layers |
| Bill history | localStorage only, capped at 200 | No — replaced by Postgres |
| Manual add | No search over 482 products | No — replaced by type-ahead |
| Receipt rendering | Working | Yes, with escaping fixed |

---

## Non-negotiables

These are product law. Any code that violates them is wrong regardless of how well it works.

1. **Never block on an unknown product.** Flag it, keep parsing, keep going.
2. **Never ask a question mid-bill.** Customer name is optional and post-hoc.
3. **Numbers are held to a higher standard than names.** A wrong name is visible. A wrong number
   looks normal and goes out the door.
4. **Money is integer paise.** Never a float, anywhere, ever.
5. **A parser response is a proposal, not financial truth.** The validator decides what's on the bill.
6. **Every table carries `shop_id`, and RLS is the security boundary** — not client-side filtering.
7. **The app writes to IndexedDB, never to the network directly.** Sync is a background worker.
8. **Only finalised bills teach the learning engine.** Prices are suggested, never auto-applied.
