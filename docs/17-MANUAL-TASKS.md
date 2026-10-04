# 17 — Manual Tasks

**Last updated:** 4 Oct 2026 · **Status:** Active

Everything only **you** can do. The agent cannot create accounts, click consent screens, hold
credit cards, or paste secrets into dashboards.

**How to use this:** when a ticket is blocked on something here, the agent should say so and stop.
If an agent claims it has done any of these, it is wrong — check yourself.

> ⚠️ Provider dashboards change. Where a UI path is given, treat it as a hint and follow the
> provider's current documentation if it doesn't match.

---

## Before anything — Day one

| # | Task | Where | Cost | Notes |
|---|---|---|---|---|
| M-01 | Back up the existing folder | Your machine | — | Zip it. Thirty seconds. |
| M-02 | Install Node.js LTS | nodejs.org | Free | Check with `node -v` |
| M-03 | Install Git | git-scm.com | Free | |
| M-04 | Install **Claude Code** | `npm install -g @anthropic-ai/claude-code` | Claude plan | Build tool since 21 Aug 2026 (`07-DECISIONS.md` D28 — was Antigravity, T1). Setup detail: `19-MACHINE-SETUP.md` §1. |
| M-05 | Create a **private** GitHub repo | github.com | Free | **Private.** Not public. |
| M-06 | **Rotate the Groq key** | console.groq.com → API Keys | Free tier | Delete the old one. Don't just create a new one. |
| M-07 | **Rotate the Gemini key** | aistudio.google.com → Get API key | Free tier | Same — delete the old. |
| M-08 | Put both keys in `.env.local` | Your machine | — | Verify `git status` does **not** show it |

**M-06 and M-07 are overdue.** Those keys have been sitting in a distributed zip.

---

## Phase 1 — Foundation

### M-10 · Create the Supabase project

1. supabase.com → New project
2. Region: **closest to India** (Singapore or Mumbai if offered) — latency is real here
3. Save the database password somewhere safe. It is shown once.
4. Copy **Project URL** and **anon public key** → `.env.local`
5. **Do not copy the service role key anywhere.** Nothing in this project uses it — `/voice` authenticates
   with the caller's own JWT and RLS (`KB-206`: zero service-role usage), and the app uses the anon key.
   It bypasses RLS entirely, so it must not be placed anywhere it isn't needed. If a future ticket ever
   genuinely needs it, that ticket decides where it goes (never `.env.local`, never the repo, never a chat
   with an agent). *(Corrected 26 Sep 2026 — this step used to say "Netlify environment variables only".)*

**Cost:** free tier. 500 MB database, ample for one shop.

### M-11 · Google OAuth for sign-in

The fiddliest manual step in the project. Roughly:

1. Google Cloud Console → new project (or reuse)
2. APIs & Services → OAuth consent screen → **External** → fill app name, support email
3. Credentials → Create Credentials → **OAuth client ID** → Web application
4. Authorised redirect URI: the callback URL from **Supabase → Authentication → Providers → Google**
5. Copy Client ID and Client Secret back into that Supabase page, enable Google

**Expect this to take an hour and fail once.** Everyone's does. The usual cause is a redirect URI
mismatch — the URI must match Supabase's exactly, including trailing slash.

**Cost:** free.

### M-12 · Supabase CLI

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
```

**You apply migrations, not the agent.** The agent writes the SQL file; you run:

```bash
supabase db push
```

This is deliberate. An agent with write access to your database can drop a table by accident.

### M-13 · Netlify — ✅ done 27 Sep 2026 (owner)

**Done:** site https://kiranabilling.netlify.app, connected to the GitHub repo; the four env vars below set with
the **remote** Supabase project URL and its publishable key (in `VITE_SUPABASE_ANON_KEY`); Supabase Auth Site URL
and redirect URL set to the site. **Every push to `main` now auto-deploys** — a broken `npm run build` fails the
deploy, and anything pushed is live.


1. netlify.com → connect the GitHub repo
2. Build command `npm run build`, publish directory `dist`
3. Site settings → Environment variables → add exactly what `netlify/functions/voice.mts` reads (lines
   26–29): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`. Missing any one →
   `/voice` answers every request `500 Server misconfigured`. The two `VITE_` values are also what
   `npm run build` bakes into the client bundle — they're the public URL and anon key, safe to expose.
   **No `SUPABASE_SERVICE_ROLE_KEY`** — `/voice` never uses it (`KB-206`). *(Corrected 26 Sep 2026 — this
   step used to list the service role key and omit both `VITE_` values.)*

**Cost:** free tier.

### M-14 · Supabase MCP in Claude Code (optional)

Only at Phase 1. Use a **read-only** token if the option exists.

---

## Phase 3 — UI

| # | Task | Cost |
|---|---|---|
| M-20 | Add **Chrome DevTools MCP** in Claude Code (optional) | Free |
| M-21 | ~~Download **Mukta** and **IBM Plex Mono** from Google Fonts, self-host~~ — **Mukta done 27 Sep 2026 (`KB-301`) via `@fontsource/mukta`, no manual step** (`11-STACK-DECISIONS.md` SD-027). **IBM Plex Mono done 3 Oct 2026 (`KB-308`)** via `@fontsource/ibm-plex-mono`, no manual step (SD-029). | Free |
| M-22 | Create the app icon and PWA splash images | Free |

---

## Phase 4 — Pilot

| # | Task | Cost | Notes |
|---|---|---|---|
| M-30 | **Enable Supabase PITR** | **$25/month (Pro)** | Do this **before** real shop data enters. The one paid thing in the MVP, and it is worth it — the loudest complaint in this market is shopkeepers losing months of data. |
| M-31 | Test on a real budget Android, not just desktop | Free | Performance budgets in `05-FRONTEND-SPEC.md` §10 assume a cheap phone |
| M-32 | **Run the 20-bill pilot** | Free | Only you can do this. See `01-PRD.md` §8. |
| M-33 | Custom domain (optional) | ~₹800/yr | |

---

## Post-MVP — Android

| # | Task | Cost |
|---|---|---|
| M-40 | Google Play developer account | **$25 one-time** |
| M-41 | Play Store listing: screenshots, description, privacy policy | Free |
| M-42 | Generate a signing key, **back it up** | Free — losing it means you can never update the app |

---

## Ongoing, every session

| Task | Why it can't be delegated |
|---|---|
| **Approve the agent's plan before it builds** | The single highest-value thing you do. It stops the agent rewriting files you didn't ask about. |
| Read the diff before merging | Your only code review |
| Update `10-TRACKER.md` | The handoff to tomorrow's session |
| Decide when a decision changes | Agents propose; you decide |
| Run `npm test` and the eval | Trust the output, not the agent's summary of it |

---

## Total cost to MVP

| | |
|---|---|
| Phase 0–3 | **₹0** |
| Phase 4 (Supabase Pro, for PITR) | **$25/month** |
| Groq + Gemini during development | **~₹200–500/month** |
| Android, later | **$25 one-time** |

Nothing here needs real money until Phase 4.

---

## Security rules — no exceptions

1. **Never paste a secret into a chat with any AI.** Not to "help it debug." Not once.
2. **The service role key is not placed anywhere** — nothing in this project uses it, and it bypasses RLS
   entirely. If a future ticket ever needs it, that ticket decides where, never `.env.local` or the repo.
3. **You apply migrations.** The agent writes SQL; you run `supabase db push`.
4. Before every commit: `git status --short | grep -i env | grep -v '\.env\.example'` should return nothing.
   (`.env.example` is tracked on purpose, dummy values only; it appears legitimately whenever it's edited.)
5. If a key is ever exposed again: **rotate first, investigate second.**
