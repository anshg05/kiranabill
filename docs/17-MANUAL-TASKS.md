# 17 — Manual Tasks

**Last updated:** 31 Oct 2026 (rev 2) · **Status:** Active

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
| M-30 | ~~**Enable Supabase PITR**~~ - **deferred (D70, 10 Oct 2026): Free for now; backups are `M-34`..`M-38` (`KB-407`)** | ~~$25/month (Pro)~~ | ~~Do this **before** real shop data enters. The one paid thing in the MVP, and it is worth it — the loudest complaint in this market is shopkeepers losing months of data.~~ |
| M-31 | Test on a real budget Android, not just desktop | Free | Performance budgets in `05-FRONTEND-SPEC.md` §10 assume a cheap phone |
| M-32 | **Run the 20-bill pilot** | Free | Only you can do this. See `01-PRD.md` §8. |
| M-33 | Custom domain (optional) | ~₹800/yr | |
| M-34 | **Install Google Drive for desktop**, sign in as the backup account, create `KiranaBill-Backups` in My Drive | Free | **Done 11 Oct 2026** (account anshgupta0404, drive `H:`). |
| M-35 | **Make the backup key**: `bash scripts/backup/setup-key.sh "H:/My Drive/KiranaBill-Backups"` in your own Git Bash window; save the **private key + passphrase in a password manager that is NOT the backup Google account** | Free | **Only you run this.** If it fails, run it again (it cleans up after itself; `--reset` removes an unfinished setup). Losing the key or the passphrase makes every backup unreadable, for good. `22-BACKUP-AND-RESTORE.md` §3. |
| M-36 | **Register the two scheduled tasks**: `powershell -ExecutionPolicy Bypass -File scripts\backup\install-task.ps1` | Free | Run once; `-DryRun` shows what it would do, `-Remove` undoes it. |
| M-37 | **First real backup, then decrypt one with the real key** (`22-BACKUP-AND-RESTORE.md` §7-§8) | Free | Proves the key and passphrase work on a real file. |
| M-38 | **Weekly:** open drive.google.com → `KiranaBill-Backups`, check the newest file's date. **Consider healthchecks.io if the laptop will be off for days.** | Free | A script cannot see whether Drive uploaded the file. |

---

## Release day - the bill-number migration (`KB-351`, D92) - owner - ✅ DONE (the migration applied 27 Oct; released 28 Oct 2026)

1. **Before the two-phone re-test:** `npx supabase db push` (the dry run must list exactly `20261022090000_bill_numbers`), then `npx supabase migration list --linked` - both sides show it. It is additive (two tables, a trigger, a function, a wider CHECK, a nullable column): the deployed app never calls it.
2. **After it is applied:** tell Claude, who moves `shop_bill_counters` and `bill_number_grants` from `PENDING_PUBLIC_TABLES` to `EXPECTED_PUBLIC_TABLES` (backup check).
3. **Before the FIRST bill after the release (both phones):** open **Settings** on every phone and check it shows the NEW version (the build id). A phone still on the old build could issue a block number that the counter then reaches - that bill would sit in permanent conflict. Fully close and reopen the app if the old version shows.
4. A phone that was offline keeps its offline-numbered bills as they are (a code like `7F2A91-3`); they push when it is back online and are never renumbered.

## Release day — self sign-up (`KB-348`, D90, D91) — owner — ✅ DONE (28 Oct 2026: Google app published, sign-ups ON, a never-used Gmail signed up and made Bill 1)

**Done by the owner, 21 Oct 2026:** the duplicate-owner query returned no rows; `db push` applied `20261020090000_sync_probe` and `20261020091000_shops_one_per_owner` (the dry-run listed exactly those two); `migration list --linked` shows both on both sides. Netlify balance: **300 credits**.

The order matters: the **draft** is tested with Google still in **Testing** and Supabase sign-ups **OFF** (except for one short window); only after the **production deploy** is the consent screen published and sign-ups left ON.

**A. For the DRAFT (before the two-phone session)**
1. **Google Cloud console > OAuth consent screen (Google Auth Platform) > Audience:** the status stays **Testing**. Under **Test users** click **Add users** and add your **second Gmail**. (Only listed test users - up to 100 - can sign in while it is in Testing, so nobody else can get in during the draft.)
2. **Supabase > Authentication > Sign In / Providers > "Allow new users to sign up": leave it OFF** until the session reaches the step "the second Gmail signs up".
3. **At that step only:** switch it **ON**, let the second Gmail do sign-up -> set-up -> first bill, and **switch it OFF again straight away**. (A pre-created user is not needed for this test; the point is that a brand-new Google account gets in and is not shown "This account isn't set up for the pilot".)

**B. After you approve the commit and the PRODUCTION deploy is done**
1. Open the live site and the policy page: `https://kiranabilling.netlify.app/` and `https://kiranabilling.netlify.app/privacy` (English, with हिन्दी below) - both must load in a normal browser tab, signed out.
2. **Google Cloud console > Branding:** *Application home page* `https://kiranabilling.netlify.app/`; *Application privacy policy link* `https://kiranabilling.netlify.app/privacy`; *Authorised domain* `kiranabilling.netlify.app`; the app name, user-support e-mail and developer contact. (Google: the privacy-policy link must be on the same domain as the home page and the same on the consent screen and the home page; the home page must not be only a login page. **Not confirmed:** whether Google accepts a `netlify.app` address as an authorised domain - the console will say. If it refuses, an own domain is the fix.)
3. **Audience > Publish app** -> the status becomes **In production** ("available to any user with a Google Account"). Only `openid`, `email` and `profile` are asked (non-sensitive: full verification is not mandatory; Google may still ask for "brand verification" to show the app's name and logo - 2-3 business days).
4. **Supabase > Authentication > "Allow new users to sign up" -> ON.** From now on any Google account can sign up.
5. **The real check:** on a phone, sign in with a Gmail that has **never** used the app (and is not a test user): Google sign-in returns signed in -> "Set up your shop" -> **Use ready catalog** -> billing -> a bill. "This account isn't set up for the pilot" must **not** appear.
6. **Rollback of sign-ups only:** switch "Allow new users to sign up" OFF - immediate; every existing user keeps working.

**C. What watches the spend:** nothing automatic (owner's choice, D90): Netlify credits, the Groq usage page, Supabase database size (500 MB on Free). The per-shop 300-an-hour `/voice` limit stays.

**D. The policy page is a minimal page for Google (D91), not the parked privacy notice (`KB-347`):** no consent flow, no acceptance records, **no lawyer has reviewed it**, and the deletion it promises (by e-mail) is done by hand by the owner - there is no runbook yet (`SG-19`).

---

## Before the real shop - one-time checklist (owner, written 30 Oct 2026)

Do these once, in this order, before the first real customer. Each says what to do and what you should see. Nothing here needs the agent except where it says so.

1. **Put the real shop on the full Ready catalog.** On the production app (https://kiranabilling.netlify.app) sign in with the shop's own Gmail -> "Set up your shop" -> the shop name and phone -> **Use ready catalog** (the whole list, not a test shop's). Then spend 20 minutes in **Catalog**: look at the prices of the 30 things this shop sells most and fix any that are wrong; if two products look like the same thing with two prices, tell the agent (it is the `KI-20` / `KI-53` review). *You should see:* the catalog list, search finding "chini", your prices. **"फली दाने" (groundnut):** the base catalog is not changed for it. Add it yourself as another name of **Moongfali** in your shop's Catalog (Edit -> other names), or just correct the line once with the pencil - the correction teaches it, and it stops asking.
2. **Install the app on every shop phone, and check "Storage: protected".** In Chrome: menu -> Install app (or Add to Home screen) -> open it from the new icon, not from Chrome. Open **Settings** (the ≡ menu): it must show the newest version, and **"Storage: protected"**. If it says anything else, close and reopen from the icon; if it still does, tell the agent (a phone that is not protected can lose bills it has not yet sent to the server).
3. **One live voice order, and the log line.** Say an order that has no commas, for example "2 kilo chini teen Parle-G 10 wala" - the app must read it (a few seconds) and show the lines. Then open Netlify -> `kiranabilling` -> **Logs** -> **Functions** -> `voice` and find the line **`[voice] parse ok model=gemini-3.5-flash-lite ms=...`**. That one line proves the live phone reached the live AI with the right model. (If the screen says the AI has no credit, or is busy, see step 5; **Add by hand** always works.)
4. **Backups are running.** Open drive.google.com -> `KiranaBill-Backups`: the **newest file must be today's or yesterday's**. Do the same look **every week** (`M-38`); the script cannot see whether Drive really uploaded the file, and the laptop must have been on.
5. **Restore one real backup, once (owner decision, 31 Oct 2026 - `24` P0b).** The last restore of a real backup with the real key was on 11 Oct 2026 (15 tables); `bill_cancellations`, `bill_metrics` and the bill-number tables were added since. With the agent: take the **real** key and passphrase from Bitwarden into a temporary keyring, then `npm run backup:rehearse -- --backup-dir "H:\My Drive\KiranaBill-Backups" --gnupg-home <that keyring> --interactive` (`22` section 7). **You should see:** every table of the newest backup, the three new ones included, with **every count equal** to the manifest. Delete the temporary keyring afterwards. The agent records the result in `22`'s rehearsal record.
6. **The AI's money and the site's credits.** (a) Google AI / Cloud billing: the **prepaid balance** is not near zero (you added Rs 500 on 29 Oct) and the **budget alert** e-mail is set. (b) Netlify: **credits** are at least 30 (a production deploy costs 15; at 0 the free plan pauses the site). (c) Groq: open the usage page once and note the day's cost - this closes `KI-27` after a week.
7. **Review mode on for the first 20 bills, and how to read Pilot numbers.** On the shop phone: **Settings -> Developer mode -> Pilot numbers -> Review mode ON.** While it is on, the app keeps **what the phone heard next to what it billed** for each voice bill. After each of the first 20 bills, open Pilot numbers and read the **Heard -> Billed** pairs: any line where the billed words or numbers differ from what you said is a mistake the app did not catch - write it down and tell the agent. Then read the top lines: **Median turns to bill** (target 1), **Fast-path coverage** (target 60%), **Zero-edit bills** (bills made without touching a line - target 80%), **Escaped errors** (bills you cancelled for a wrong item, price or quantity - target 0). "Silent number errors" is not counted by the app; the Heard -> Billed pairs are how you count them. Switch Review mode off after 20 bills ("Clear now" removes the pairs).

**The one limit to know before you start:** the app checks the numbers and products it is given, but it can only check **what the phone heard**. In the owner's own recordings the speech-to-text mis-heard a number or an item in about **1 order in 7** (7 of 48), and a mis-heard number that still looks like a number is not always caught. That is what Review mode and the first 20 bills are for. If anything looks wrong on a bill, do not finalise it - fix the line (pencil) or use **Add by hand**.

**Drafts continue.** New code is tried on the `release-draft` address (a draft: not live, no credits, the real shop database); the Supabase redirect entry for drafts (`https://*--kiranabilling.netlify.app/**`) stays until the last draft - then remove it and `https://kiranabilling.netlify.app/**`, leaving only `https://kiranabilling.netlify.app/` (`D82`).

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
| Supabase | **Free** - backups are the scheduled Drive dump (D70, `KB-407`); Pro/PITR ($25/month) stays deferred |
| Groq + Gemini during development | **~₹200–500/month** |
| Gemini, paid tier (since 29 Oct 2026) | **prepaid balance**, about **₹0.1 per Layer-2 call** (owner's figure) |
| Netlify | **~15 credits per production deploy** (28 Oct release; drafts and pushes without `[deploy]` cost none) |
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
