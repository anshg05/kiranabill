# 19 — Machine Setup

**Last updated:** 26 Sep 2026 · **Status:** Active
**Purpose:** get a new machine to the exact state the old one was in, with nothing skipped and nothing guessed. Written from what this project's actual setup involved, including the real problems hit along the way — not a generic checklist.

**Do these in order.** Each section assumes the previous one is done.

---

## 0. Before you start

This is a **private** GitHub repo (`anshg05/kiranabill`) connected to a **real, live Supabase project** with real schema, real RLS policies, and real data already on it (your own test shop, from `KB-107`'s onboarding test). You are not starting a fresh project — you are reconnecting to one that already exists and is already running in production-shaped form.

**Nothing about switching machines requires touching the remote Supabase project or the GitHub repo's history.** Everything below is local setup only.

---

## 1. Install the base tools

| Tool | Get it from | Why |
|---|---|---|
| **Node.js** (LTS) | nodejs.org | Runs everything — Vite, Vitest, the Supabase CLI, Netlify CLI |
| **Git** | git-scm.com | Version control. On Windows, this also installs **Git Bash** — use it. |
| **Docker Desktop** | docker.com | Runs the local Supabase stack (Postgres, Auth, Studio) for safe local testing before anything touches the real remote database |
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | The build agent for this project |

**On Windows specifically: use Git Bash, not PowerShell, for anything Claude Code runs.** Every command Claude Code has executed in this project so far — `grep`, `sed`, `awk`, `tail`, background process management — assumes a Unix-style shell. PowerShell will fight it. If Claude Code's terminal defaults to PowerShell on the new machine, change it to Git Bash before starting real work, not after hitting the first cryptic error.

**Node version, as actually run (26 Sep 2026):** the current machine runs **Node 26.7.0**, an owner
decision to stay on it — `npm run lint` and `npx tsc --noEmit` are clean, and `npm test` passes apart
from the intermittent `catalogIndex` performance test (`12-PARKED.md` KI-23). Node 26 enters Active
LTS on 28 Oct 2026. **An LTS release is preferred going forward** when setting up any further machine.

Verify each installed correctly:
```bash
node --version
git --version
docker --version
claude --version
```

---

## 2. GitHub access

The repo is **private**. You need authenticated access before `git clone` will work.

**Easiest path — GitHub CLI:**
```bash
# install gh from cli.github.com, then:
gh auth login
```
Follow the browser prompt. This also configures `git` itself to use the same credentials, so `git push`/`git pull` work with no further setup — this is the same flow that already worked for pushes from the old machine (a browser window opens for approval, then it's remembered).

**If you'd rather not install `gh`:** plain `git push`/`git pull` over HTTPS will still trigger a browser-based Git Credential Manager prompt on first use, same as before. Either path works; `gh` is just fewer steps.

---

## 3. Clone and verify the repo

```bash
cd ~                          # or wherever you want the project to live
git clone https://github.com/anshg05/kiranabill.git
cd kiranabill
git log --oneline -5
```

You should see recent commits ending around `KB-210`'s close (`29b2258` or later — check `docs/10-TRACKER.md`'s own "Last updated" line for the true current state, since this setup doc will age).

**Confirm the branch and structure:**
```bash
git branch                    # should show only * main
git worktree list             # should show only this one checkout
```

If `git worktree list` shows anything beyond the single main checkout, **stop and clean it up before doing anything else** — see §7 below. This exact problem cost real time once already on the old machine.

```bash
ls docs/                      # should list 00-README.md through the highest-numbered doc
cat CLAUDE.md                 # should exist at repo root, not inside docs/
```

---

## 4. Install project dependencies

```bash
npm install
```

This installs everything already decided and logged in `docs/11-STACK-DECISIONS.md` — React, TypeScript, Vite, Vitest, Dexie, `@supabase/supabase-js`, `pg`, `fake-indexeddb`, `netlify-cli`, `@netlify/blobs`, and the rest. Nothing to choose here; the choices are already made and recorded.

**Sanity check before touching any environment variables:**
```bash
npx tsc --noEmit
```
This should be clean even with no `.env.local` yet — type-checking doesn't need real credentials.

---

## 5. Environment variables

**`.env.example` in the repo root is the authoritative list of variable names.** Don't reconstruct it from memory — open it and match it exactly:

```bash
cat .env.example
```

```bash
cp .env.example .env.local
```

Then fill in `.env.local` with **real values**, matching each name in `.env.example` exactly. As of this writing, the categories are:

| Variable | Where it comes from |
|---|---|
| `GROQ_API_KEY` | console.groq.com → API Keys (the one already rotated in this project — see `17-MANUAL-TASKS.md` M-06) |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key (M-07) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | For **local Docker** dev, these come from `supabase start`'s own printed output (§6 below), not the hosted project's dashboard — the app talks to the local stack during development. |
| `ALLOWED_ORIGIN`, other legacy-carried vars | Already in `.env.example` from the original project setup — copy as named. |

**The one rule that must never be broken, stated plainly because it governs this entire project:** the **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`) — if and when it's ever needed — goes **only** into Netlify's own environment variable settings at actual deployment time. It has never been in `.env.local` on the old machine and must never be on this one either. It bypasses RLS entirely; treat it like a password, not a config value.

**Verify before going further:**
```bash
git status --short | grep -i env
```
This must print **nothing**. If it shows `.env.local`, stop — the `.gitignore` isn't doing its job, and that needs fixing before you write a single real key into that file.

---

## 6. Supabase CLI — link and start local

```bash
npx supabase login
```
Browser auth, same pattern as GitHub.

```bash
npx supabase link --project-ref urcenodcxtzwjrulwvgf
```
This is the **real, existing, already-live** project — the one with real schema, real RLS, real onboarding data already on it. Linking doesn't create anything; it just points this local checkout at the project that already exists.

**Start the local development stack:**
```bash
npx supabase start
```

First run pulls several Docker images and can take a few minutes. When it finishes, it prints local URLs and keys:
```
API URL: http://localhost:54321
Studio URL: http://localhost:54323
anon key: eyJ...
service_role key: eyJ...
```

**Copy the local `API URL` into `VITE_SUPABASE_URL` and the local `anon key` into `VITE_SUPABASE_ANON_KEY` in `.env.local`.** Never the `service_role key` printed here either — same rule, no exceptions for "it's just local."

### Known issue: Docker Desktop / WSL2 can stall on first start (Windows)

This happened on the old machine and cost real time, so it's documented here rather than left to be rediscovered: `docker info` can hang unresponsive for 10+ minutes even while Docker Desktop's own processes are visibly consuming CPU — not actually frozen, just very slow to bring up its WSL2 backend (`docker-desktop` distro repeatedly reports `Stopped` while this happens).

**If this happens:**
1. Open Docker Desktop's own window and confirm the engine status shown there (not just the CLI).
2. If it's still not coming up after several minutes, check WSL2 directly: `wsl --list --verbose` — look for the `docker-desktop` distro's state.
3. Restarting Docker Desktop from its own tray icon (not just waiting) sometimes resolves it faster than continued polling.
4. There is no code-level fix for this — it's an environment issue, not a project issue. Don't spend more than a few minutes trying to diagnose it programmatically; just wait it out or restart Docker Desktop.

### Verify the local stack is genuinely correct

```bash
npx supabase db reset
```

This applies **every migration in `supabase/migrations/`, in order**, to the local database from scratch. It should complete with no errors — if it does, your local schema now matches the migration files. **It says nothing about the remote.**

**Correction, 26 Sep 2026:** this section originally said every migration had already been pushed to the remote. That was false when written — `20260920170751_bills_receipt_number_source.sql` (`KB-111`) was local-only until the owner pushed it on 26 Sep 2026. Don't trust this document (or any other) for push state; check it directly, read-only:

```bash
npx supabase migration list --linked
```

Every row must show the same id under both `local` and `remote`. An empty `remote` means the migration has not been pushed.

### Expected `supabase status` noise on this Windows setup

`npx supabase status` exiting 0 is what matters. On this machine it also reports some services stopped or restarting — all expected and harmless for this project (observed 26 Sep 2026):

| Service | State seen | Why it's harmless |
|---|---|---|
| `supabase_pooler` | stopped | Disabled in `supabase/config.toml` (`[db.pooler] enabled = false`) |
| `supabase_edge_runtime` | stopped *or* running (both seen the same day) | This project has no Supabase edge functions — `/voice` runs on Netlify |
| `supabase_imgproxy` | stopped | Storage image transforms — unused |
| `supabase_vector` | restart-looping (`docker ps`: `Restarting (0) …`) | Log collection only — nothing in this project depends on it |

```bash
npx supabase db dump --linked --schema public,storage -f /tmp/remote-check.sql
```

This is **read-only** — it pulls the real remote schema for comparison, touches nothing. Use this, not `supabase db diff`, to check the remote's real state — `db diff` has twice given misleadingly clean results in this project (`docs/12-PARKED.md` `KI-25`), for two different reasons. Never trust it alone.

---

## 7. Claude Code — first session on the new machine

```bash
cd kiranabill
claude
```

Sign in on first run.

**A real gotcha from the old machine, worth checking before your first real ticket, not after:** Claude Code sessions have, at least once in this project, launched into an isolated **worktree** (`.claude/worktrees/...`) instead of the actual repo checkout — which broke the single-branch workflow and required a manual merge to recover. Before doing any real work:

```bash
pwd                           # confirm you're actually in the kiranabill checkout
git branch --show-current     # should say main
git worktree list             # should show only D:/... (or wherever) [main], nothing else
```

If a session ever starts in a worktree path again, stop and ask it directly what launched it that way before proceeding — this project's `CLAUDE.md` and `docs/12-PARKED.md` (`NI-20`) both have the prior investigation of this on record.

**Confirm `CLAUDE.md` is being read:** it should auto-load at session start. Its own "Git" section states the single-branch rule explicitly — no branches, no PRs, commit directly to `main` after each verified step. This is a deliberate, permanent project decision, not a shortcut; don't let a new session drift back toward branches out of unfamiliarity with why this was chosen.

---

## 8. Netlify CLI (only needed for `/voice` endpoint work)

Already installed via `npm install` (`netlify-cli` is in `package.json`'s dev dependencies). To actually run the real endpoint locally:

```bash
npx netlify dev
```

This emulates the real Netlify Functions runtime locally — no production Netlify site connection needed for this (that's `17-MANUAL-TASKS.md` M-13, still open, and not required for local development).

**One real gotcha already found:** Netlify's function bundler scans every file directly inside `netlify/functions/` as a candidate function. Test files must live in `netlify/functions/_shared/`, not the top-level `netlify/functions/` directory, or the dev server crashes trying to treat a test file as an endpoint. This is already correctly structured in the repo — just don't add a new top-level test file there without checking this first.

---

## 9. Final verification checklist

Run all of these before considering the machine "ready." Compare the numbers against `docs/10-TRACKER.md`'s current recorded state — they should match (or be higher, if work has continued since this doc was last updated).

```bash
npm run lint            # clean
npx tsc --noEmit         # clean
npm test                 # should match the test count in docs/10-TRACKER.md (see KI-23 for the intermittent perf test)
npx supabase db reset    # all migrations apply cleanly, no errors
```

If every one of these passes and matches the tracker's recorded state, the new machine is a faithful continuation of the old one — not a fresh start.

---

## 10. What this document deliberately does not cover

- **Product/account setup questions** (which Claude plan, billing, UI navigation) — see `support.claude.com`.
- **The actual working discipline** (how to prompt Claude Code, the PLAN→STOP flow, the hard rules) — that lives in `CLAUDE.md` and `docs/18-AGENT-CONTRACT.md`, unchanged by which machine or account is running it.
- **What to actually build next** — that's `docs/10-TRACKER.md` and `docs/06-FEATURE-TICKETS.md`, also unchanged by this move.

This document is infrastructure only — getting a new machine to the same starting line, nothing about what happens after that line.
