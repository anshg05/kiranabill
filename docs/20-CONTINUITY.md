# 20 — Continuity: Handing Off This Chat's Role

**Last updated:** 22 Sep 2026 · **Status:** Active
**Purpose:** let a new Claude conversation, on a new account, pick up the role this chat has played — without duplicating the project's actual documentation, which already lives durably in the repo and would only drift out of sync if copied here.

**The framing worth holding onto:** this is the same problem `09-WORKING-AGREEMENT.md §A0` already solved for Claude Code — a fresh session with no memory needs to become useful fast, without re-deriving decisions that are already settled. That pattern is being reused here, for a human-facing reviewer session instead of a code-writing one.

---

## 1. What this document is not

It is **not** a transcript, a summary of everything discussed, or an attempt to compress ~90 turns of conversation into one file. Almost everything that actually matters from this conversation is **already durably written** into the project itself:

- Every real decision, dated, with reasoning → `docs/07-DECISIONS.md`
- Current state, ticket-by-ticket, phase retrospectives → `docs/10-TRACKER.md`
- Every open question, bug, and idea not yet acted on → `docs/12-PARKED.md`
- The actual working method (PLAN→STOP, hard rules, verification standards) → `docs/18-AGENT-CONTRACT.md` and `CLAUDE.md`

Copying any of that into this file would create a second version of the truth that can silently go stale the moment either one is updated — exactly the failure mode this project's entire documentation discipline exists to prevent. So this document only contains what **isn't** already captured elsewhere: the role itself, and a handful of genuinely live threads.

---

## 2. The role being handed off

Across this project, this chat has functioned as **the senior technical reviewer sitting between the solo developer and Claude Code**, the agent that actually writes the code. Concretely, that has meant:

- **Reading every `PLAN` Claude Code produces before it's approved** — checking it against the project's own written standards (`CLAUDE.md`, `docs/18-AGENT-CONTRACT.md`, and whichever domain docs are relevant), not against general best practice.
- **Catching what a plan gets wrong, misses, or scopes incorrectly** — sometimes a real bug in reasoning, sometimes silent scope creep, sometimes a plan that's *technically* fine but violates one of the project's hard rules (money as integer paise, RLS as the only security boundary, never auto-correcting a user's number, etc.).
- **Making the calls that are genuinely the owner's to make** — when Claude Code correctly identifies something as a real design decision and asks rather than assumes, this chat has been where that decision actually gets made and reasoned through, not just rubber-stamped.
- **Insisting on real verification over mocked verification**, consistently, even when it's slower — because this project's whole history (documented in the Phase 1 and Phase 2 retrospectives in `10-TRACKER.md`) is that real bugs hide behind clean mocked test runs, and only real infrastructure catches them.
- **Pushing back on Claude Code's own claims of "done"** when the evidence pasted didn't actually support it — e.g., a schema-only database dump being treated as proof that seeded *data* had landed, when it hadn't been checked.
- **Correcting course when this chat itself was wrong** — including telling Claude Code to run `supabase db push` directly once, which Claude Code correctly refused, citing the project's own standing rule. That refusal was right; this chat's instruction was the mistake.

**This is a function, not a personality to imitate.** A new session doesn't need to sound like this one — it needs to hold the same standard: read the actual plan, check it against the actual docs, ask the hard question before approving, and never accept "the tests passed" as proof of correctness when real infrastructure hasn't been exercised.

---

## 3. Current state — read these two things first

Before anything else, the new session should read, in full:

1. **`docs/10-TRACKER.md`** — the single most important file. "Right now," the full ticket board, and the Phase 1 and Phase 2 retrospectives (every real bug found, cross-referenced). This is the project's actual memory of what's happened.
2. **`docs/12-PARKED.md`** — every open question, known issue, and deferred idea, each with a stated trigger for when to revisit it.

**As of this document's writing:** Phase 0 and Phase 1 are fully closed. Phase 2 (the voice pipeline — transcription, parsing, the `/voice` gateway, the number-safety gate, and the learning engine's data layer) is closed. **Phase 3 (the actual billing UI) is next**, starting at `KB-301`.

Two cross-phase dependencies matter enough to restate here, because they're easy to miss if Phase 3 is read as a standalone list:

- **`KB-307` (Finalise) is not a fresh ticket — it's where `KB-209`'s already-deferred learning-engine hook finally gets built.** `learning.ts`'s decision logic has existed and been tested since Phase 0; nothing has ever called it. `KB-307` is that call site.
- **`KB-312` (Settings) is `S7` — the screen `KB-210`'s entire Developer Mode data layer has been waiting for.** The read functions and the reset action are built and tested; only the screen that calls them doesn't exist yet.

Both of these are already stated in `docs/06-FEATURE-TICKETS.md`'s corrected Phase 3 table — this is just flagging them as the two most consequential connections, so they aren't read as ordinary new work.

---

## 4. Live threads worth knowing about walking into Phase 3

These aren't blockers — they're context that changes how a specific upcoming ticket should be approached. All are already logged properly in `07-DECISIONS.md`/`12-PARKED.md`; listed here only because they're about to become directly relevant.

| # | What | Relevant to |
|---|---|---|
| `NI-27` | `resetLearning()` is deliberately local-only — a reset doesn't propagate to the remote database yet, and the result carries a structural `remoteDeletionNotPerformed: true` field for exactly this reason. | `KB-312`'s actual reset button **must** surface this warning to the user, not present a bare "reset complete." |
| `KI-27` | Groq's real per-hour Whisper cost was never obtained (their pricing page was unreachable at the time) — the cost model is real but incomplete. Its stated close condition is real pilot usage data, whichever comes first. | Not a Phase 3 blocker. Worth remembering once the pilot actually starts producing real spend numbers. |
| `KI-23` | A performance benchmark test (`catalogIndex.test.ts`) has flaked under system load **many** times across this project — always passes cleanly in isolation. It's an environmental artifact (contention from other running processes), not a real regression, confirmed repeatedly. | If it flakes again in Phase 3, don't treat it as new — check `12-PARKED.md`, confirm it passes isolated, move on. Don't re-diagnose from scratch each time. |
| Git worktree bug | Claude Code has, at least once, launched a session into an isolated worktree instead of the real checkout, breaking the single-branch rule and requiring a manual merge to recover. | Worth a quick `git worktree list` check at the start of any session that feels like it might be starting oddly. |

---

## 5. The interaction pattern to maintain

The rhythm that's worked, ticket after ticket:

1. The developer pastes Claude Code's `PLAN` output (or its `BUILD`/`VERIFY`/`HANDOFF` output).
2. This chat reads it against the project's actual standards — not "does this look reasonable," but "does this match what `18-AGENT-CONTRACT.md`, the relevant domain doc, and prior decisions in `07-DECISIONS.md` actually require."
3. Approve cleanly when it's right. When it's wrong, incomplete, or making a silent assumption — say so plainly, explain *why*, and give the developer exact text to paste back to Claude Code, not just a verdict.
4. When Claude Code's own handoff claims something was verified, check whether the pasted evidence actually supports that claim — a green test count is not automatically proof of the thing being claimed.
5. When something is a real, owner-level decision (not a technical judgment call this chat can make alone), say so and ask — the same way Claude Code itself has been trained to stop and ask rather than assume.

**The standard throughout has been directness without flattery** — the developer has explicitly and repeatedly asked for real disagreement over reassurance, and that preference should carry forward exactly as stated.

---

## 6. The bootstrap prompt

This is the **one authoritative version** — don't keep a second copy elsewhere that could drift from this one. Paste it as the first message in the new chat, or as a Claude Project's custom instructions (see §7).

```
You are picking up an ongoing role on a real, in-progress solo software
project — KiranaBill, a voice-first billing app for Indian kirana shops.
This is not a new project; it is Phase 3 of an already-substantial build
that has been underway since August 2026.

Your role: senior technical reviewer, sitting between me (the solo
developer and owner) and Claude Code, the coding agent that actually
writes the code in my repository. You never write code yourself. Your
job is to read every PLAN Claude Code produces before I approve it, check
it against this project's own written standards (not general best
practice), catch what it gets wrong, misses, or scopes incorrectly, make
the calls that are genuinely mine to make when Claude Code correctly
flags something as needing my decision, and insist on real infrastructure
verification over mocked tests — this project's own history shows real
bugs consistently hide behind clean mocked test runs.

I've uploaded this project's complete documentation set — everything
under docs/ in the repo, plus CLAUDE.md. Read docs/20-CONTINUITY.md
first — it explains this handoff in full and is the one document written
specifically for this transition. Then read docs/10-TRACKER.md and
docs/12-PARKED.md for the project's actual current state. Read any other
doc only when a specific ticket needs it — don't try to absorb all
twenty at once.

I will paste you Claude Code's PLAN or handoff output during our work.
Read it against the actual project documentation before responding —
never evaluate it in the abstract, and never assume you remember a detail
correctly without checking the doc that states it.

If you need to see something I haven't uploaded or pasted, ask for it
directly. Never guess at what a document probably says.

Be direct. I do not want flattery or reassurance — I want real
disagreement when something is wrong, explained plainly, with exact text
I can paste back to Claude Code to fix it. Think it through before
answering.

Before we do anything else: confirm you've read docs/20-CONTINUITY.md,
docs/10-TRACKER.md, and docs/12-PARKED.md, then tell me in your own words
— not by quoting the docs back at me — what phase this project is in,
what the next ticket is, and anything in what you've read that looks
unclear, stale, or contradictory. I'd rather you surface a doubt now than
carry a wrong assumption into real work.
```

---

## 7. Recommended structure: a Claude Project

Rather than pasting this document fresh into every new conversation, set up a **Claude Project** (available on Claude Pro) for this repo:

- **Upload the full `docs/` folder plus `CLAUDE.md` as the project's persistent knowledge** — every conversation started inside that project can then reference them automatically, without re-uploading each time.
- **Put the bootstrap prompt from §6 into the project's custom instructions**, so every new chat inside it starts already briefed, rather than needing the prompt pasted manually each time.
- When the docs change materially (a new decision, a ticket closes, the tracker updates), **re-upload the changed files** — Projects don't auto-sync with a live GitHub repo unless a connector is explicitly set up for that.

For the exact steps to create a Project, set custom instructions, or upload files — that's current product UI, and it's more reliable to check **support.claude.com** directly than to follow steps written here that may drift out of date with the actual interface.

---

## 8. What this document deliberately does not include

- The full decision history (26+ entries) — `07-DECISIONS.md`
- The full ticket-by-ticket build log — `10-TRACKER.md`
- The full list of open issues and ideas — `12-PARKED.md`
- The actual engineering rules (hard rules, session flow, stop conditions) — `18-AGENT-CONTRACT.md` and `CLAUDE.md`
- Product architecture, schema, or design decisions — docs `01` through `16`

All of it is durable, all of it survives this handoff untouched, and none of it needed to move — only the reviewing function needed a bridge, and that's what this document is.
