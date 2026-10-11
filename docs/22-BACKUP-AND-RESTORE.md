# 22 — Backup and Restore

**Last updated:** 11 Oct 2026 (rev 1) · **Status:** built (`KB-407`, `07-DECISIONS.md` D75); the owner's setup steps and the first real run are tracked in `10-TRACKER.md` "Before deployment".

KiranaBill runs on the **Supabase Free plan**, which has **no backups** (D70). This is the backup: every day an **encrypted** copy of the production database goes to the owner's Google Drive, and a restore has been rehearsed. If you are reading this because something is broken: jump to **§8 Emergency restore**.

---

## 1. What it is, in one paragraph

A scheduled task on the owner's laptop runs `scripts/backup/backup.ts`. It asks the Supabase CLI for the production data (the CLI dumps inside a Docker container), checks the dump holds what a restore needs, compresses it and **encrypts it with a public key**, and drops three files into `Google Drive → KiranaBill-Backups`. The laptop holds only the *lock* (the public key); the *key* (private key + passphrase) lives only in the owner's password manager. Nothing readable is ever written to the laptop's disk.

**How much can be lost:** at most one day while the laptop is used daily (a backup is attempted at every logon and at 13:00). **If the laptop stays off for days, nothing runs** — the data keeps growing on the phones and Supabase, but no new backup is made. The popups (§5) tell the owner when that has happened.

## 2. What is in a backup

Three files per run, all encrypted, named `kb-backup-<UTC stamp>-<kind>.gz.gpg`:

| File | Holds |
|---|---|
| `…-data.sql.gz.gpg` | The **data**: every table in `public` (shops, members, bills, bill items, products, learned data, receipt-number blocks, the ready catalog), plus `auth.users` and `auth.identities` (who the users are and which Google account each is — **a restore without them would orphan every shop**), plus `storage.objects` metadata. COPY format; begins with `SET session_replication_role = replica` so finalised bills load. |
| `…-schema.sql.gz.gpg` | The `public` schema as it was — a reference. The migrations in `supabase/migrations/` are the source of truth for rebuilding it. |
| `…-manifest.json.gz.gpg` | Row counts per table, the migration versions, the git commit, the CLI version, the hash of each file. A restore is checked against it. |

**Checked on every run, and the run FAILS (with a popup) if not:** every `public` table is present; `shops`, `shop_members`, `auth.users`, `auth.identities` have rows; no `auth` table other than `users` / `identities` / `instances` and no `storage` table other than `objects` appears (so a table a platform upgrade adds is judged, not silently stored); **`storage.objects` is empty** (Storage files are *not* in the backup — only their metadata; today there are none, and if one ever appears the backup says so instead of passing); the file really is encrypted to the owner's key.

**Deliberately NOT stored:** sessions and refresh tokens (`auth.sessions`, `auth.refresh_tokens`, …) — a refresh token is a live login, so after a restore everyone signs in with Google again. Storage's own bookkeeping tables (platform-versioned; the bucket is recreated by a migration).

**Not in ANY backup** (project settings, not data — write them down, see §8 step 8): the Google OAuth client id and secret, the Auth redirect URLs and Site URL, the sign-up setting, the project's API keys, Netlify's environment variables.

## 3. Keys — who holds what (read this once)

- **The lock (public key)** lives on the laptop in `%APPDATA%\KiranaBillBackup\gnupg`. It can lock files and cannot open them (a test proves the laptop's own keyring cannot decrypt a backup).
- **The key (private key)** was made once by `scripts/backup/setup-key.sh`, protected by a **passphrase the owner chose**, saved by the owner to his **password manager**, then deleted from the laptop. **Use a password manager that is not the Google account holding the backups.**
- **The backup key (public fingerprint, 11 Oct 2026):** `CE71F8645A1149022C706E60A2D671EDF5A46AE7`. Made by the owner with `setup-key.sh` (stage 4 passed: a test note opened with the real passphrase); the private key and passphrase are in the owner's Bitwarden, not in the backup Google account. Checked afterwards (metadata only): `config.json` has `keyConfirmed: true` for this fingerprint; the laptop's keyring holds **0 secret keys**; the key-export folder, the temporary keyring and any key file are gone.
- **The setup cannot leave a trap.** `setup-key.sh` checks everything it needs *before* making a key, writes the settings file with `keyConfirmed: true` **only after** you opened a test note with the real key and passphrase (stage 4), and removes everything it made if any stage fails. **The backup refuses to run without `keyConfirmed: true`** (tested). The key file for your password manager is written to `%LOCALAPPDATA%\KiranaBillBackup\key-export` and opened in Notepad - not the Desktop, which can be redirected into OneDrive. `setup-key.sh --reset` removes an unfinished setup (never a finished one).
- **If the private key or its passphrase is lost, every backup is unreadable forever. Nobody can recover it** — not the assistant, not Supabase, not Google.
- Nothing secret is in the repo, the script, the settings file, the log or the Drive folder. The settings file holds the Drive folder and the *public* fingerprint.
- The remote database needs **no password**: the Supabase CLI makes a short-lived login role from the access token that `supabase login` keeps in Windows Credential Manager. **Never run the CLI with `--dry-run` or `--debug`** — they print that temporary password (the scripts refuse both).

## 4. Schedule, Docker, disk

- **Task "KiranaBill Backup"** (Windows Task Scheduler, only while the owner is signed in): at every logon and daily at 13:00, with the program itself skipping the run if a backup is under 20 hours old. Asleep at 13:00 → it runs when the laptop wakes. Off → at the next logon. On failure it retries every 30 minutes, up to 6 times, with a 30-minute limit per run.
- **Docker Desktop must be running** (the CLI dumps inside a container). If it is not, the script starts it (`docker desktop start`) and waits up to 3 minutes; if it still is not up, the run fails with a popup and retries. Docker adds roughly 1–2 GB of memory while up.
- **Disk:** at the start of every run the script requires **2 GiB free on C:** and fails with a popup below that. The backup is only tens of MB, but Google Drive for desktop keeps a cache on C: before it uploads, and a full C: has already cost the app its stored data once (KI-68: Chrome evicts a best-effort origin under disk pressure). It is a warning about the machine, not only about the backup.
- A failed run leaves **no half-written file**: files are written under a `.tmp` name, verified, and renamed; the Drive folder never holds half a backup.

## 5. How a failure shows

1. **A message box** ("KiranaBill backup FAILED") that stays until dismissed, with the reason in plain words.
2. **A second task** ("KiranaBill Backup Check", 30 minutes after logon and at 18:00) shows "KiranaBill backup is out of date" if the last good backup is more than 36 hours old — this covers a disabled task, a Docker that never starts, or an update that broke the task.
3. **The log:** `%LOCALAPPDATA%\KiranaBillBackup\backup.log` (secrets redacted; child output is never logged).
4. **What no script can see: whether Google Drive actually uploaded the file.** Weekly, open drive.google.com → `KiranaBill-Backups` and look at the date of the newest file (checklist item).
5. **Deferred (owner, 11 Oct 2026):** a dead-man's-switch ping (healthchecks.io) that emails when the laptop is off for days. **Consider it if the laptop will be off for days during the pilot.**

## 6. Retention and DPDP

- **14 daily copies** (the newest of each of the last 14 days that have one) **+ 3 monthly copies** (the oldest of each of the 3 most recent months), whole sets only; older ones are deleted from the Drive folder. The last 3 days' encrypted sets are also kept in `%LOCALAPPDATA%\KiranaBillBackup\spool` in case Drive is down. Files that are not ours are never touched.
- A deleted file stays in **Google Drive's trash for 30 days** (empty it by hand to purge sooner). **So a copy exists for at most about 4 months + 30 days.**
- **What the backups contain that is personal data:** customers' names and mobile numbers (on bills), the shop's phone, and the owner's/staff Google account name and email (`auth.users`). They are encrypted at rest; only the holder of the private key can read them.
- **A customer erased from the live database stays in older backups until they age out** (up to the period above). This must be stated in the owner's DPDP notice; the DPDP review itself is the owner's item (readiness #15, qualified advice).

## 7. Commands

```
npm run backup                 # a backup now (to the Drive folder in the settings file)
npm run backup:probe           # counts only, stores nothing: "does the production dump hold what a restore needs?"
npm run backup:rehearse -- --backup-dir "H:\My Drive\KiranaBill-Backups" --gnupg-home <a keyring holding the PRIVATE key> --interactive
```

`backup:rehearse` restores the newest complete backup into a scratch database on the **local** Supabase stack (never the real one), compares every table's row count with the manifest, and drops the scratch database.

## 8. Emergency restore — exact steps

When: the production project is gone, wiped or corrupted. You need: the repo on a machine with Docker, the Drive folder (or a spool copy), the private key + passphrase from the password manager, and a **new, EMPTY** Supabase project.

1. **Create a new Supabase project** (same region). Note its project ref, database password and API keys. Do **not** restore into a project that has data: the load stops on the first primary-key collision, by design.
2. **Rebuild the schema:** `npx supabase link --project-ref <new ref>` then `npx supabase db push`. This creates `public` (tables, RLS, functions, the receipt-number no-overlap constraint), the `shop-logos` bucket and its policies, and re-seeds the ready catalog (`base_products`).
3. **Get the key onto a temporary keyring** (Git Bash): `H=$(mktemp -d /tmp/kbrestore.XXXXXX)`, save the private key from the password manager to a file `key.asc`, then `gpg --homedir "$H" --import key.asc` (it will ask for the passphrase when used).
4. **Decrypt the manifest and the data:**
   `gpg --homedir "$H" --decrypt kb-backup-<stamp>-manifest.json.gz.gpg | gunzip > manifest.json`
   `gpg --homedir "$H" --decrypt kb-backup-<stamp>-data.sql.gz.gpg | gunzip > data.sql`
   (The decrypted files are **readable personal data** — delete `data.sql`, `manifest.json` and `key.asc` when done, and `rm -rf "$H"`.)
5. **Clear what step 2 seeded** (so the load meets an empty project): `delete from public.base_products;` (in the SQL editor or psql).
6. **Load:** `psql "<the new project's connection string>" -v ON_ERROR_STOP=1 -f data.sql`. `data.sql` starts with `SET session_replication_role = replica`, which turns triggers and foreign keys off for the load — the same preamble Supabase's own migration guides use. *(Verified on the local stack; not yet on a hosted project — see "Not yet proven" below.)*
7. **Check:** the row count of every table in `manifest.json` → `counts` must equal `select count(*)` in the new project (the rehearsal prints exactly this table).
8. **Re-create the settings no backup holds:** in the new project → Authentication → Providers → Google (the OAuth client id and secret from Google Cloud Console); Site URL and Redirect URLs; the sign-up setting. Put the new `VITE_SUPABASE_URL` and anon key in Netlify's environment (and in `.env.local`), and **release** (an owner-approved `[deploy]` commit — it costs credits, D55).
9. **People sign in again** with Google; the same Google accounts map to the same users (`auth.identities` was restored), so every shop is theirs again. **The phones' own data survives**: bills not yet synced push to the new project, and a wiped phone pulls its bills and learning back (`KB-324`, `KB-326`).

### Rehearsal record

| Date | What | Result |
|---|---|---|
| 11 Oct 2026 | The pipeline against the **local stack** with a throwaway key: backup → decrypt → scratch database → counts | 23 tables, 97,137 rows, **every count equal** to the manifest **and** to the live local database |
| 11 Oct 2026 | One **real production** backup (`--source linked`), encrypted with a throwaway key, restored into the scratch database | 15 tables, 553 rows, **every count equal** to the manifest |
| 11 Oct 2026 | The same pipeline as `scripts/backup/backupPipeline.e2e.test.ts` (8 tests; in `npm run test:e2e`) | green, twice |
| *(owner, pending)* | The first real backup, decrypted with the **real** key | see the tracker |

### Not yet proven

- **A restore into a hosted Supabase project** (step 6's `session_replication_role` on the hosted `postgres` role) — the rehearsal restores into the local stack. If a spare hosted project is ever available (e.g. on the upgrade to Pro), rehearse once there.
- **Version drift:** the hosted platform schemas can be newer than the local CLI stack (the hosted `storage.buckets` has a column the local one lacks — that is why Storage's bookkeeping tables are excluded). A restore into a *fresh hosted project* has the same platform version as production; a restore into an older local stack may fail on an `auth` column — update the Supabase CLI first.
- **The upload to Drive** is invisible to the scripts (§5.4).

## 9. New machine

The tasks, the Docker/Git/Node tools and the Google Drive for desktop sign-in must be set up again (`19-MACHINE-SETUP.md`). Do **not** run `setup-key.sh` again — it would make a **new** key and the old backups could not be opened with it. Instead: import the existing private key into a temporary keyring (§8 step 3), `gpg --homedir "$H" --export <fingerprint> | gpg --homedir "%APPDATA%/KiranaBillBackup/gnupg" --import`, write `config.json` (copy it from the old machine, adjusting the Drive path), delete the temporary keyring and `key.asc`, then run `scripts/backup/install-task.ps1`.

## 10. Troubleshooting

| Popup / log says | Meaning | Do |
|---|---|---|
| "the backup folder … is not there" | Google Drive for desktop is not running or not signed in as the backup account | start it, open the folder in File Explorer once |
| "C: has only … GiB free" | the system drive is nearly full (§4) | free space — it also protects the app's data on the laptop |
| "Docker Desktop did not start within 3 minutes" | Docker will not start (memory? WSL?) | start Docker Desktop by hand; the task retries |
| "supabase db dump failed … login" | the Supabase CLI is not logged in | `npx supabase login` (a browser opens) |
| "the data dump is not good enough to keep: …" | the dump is missing something a restore needs (§2) | read the reason; do not ignore it — a table or a platform change needs judging |
| "Storage holds N file(s) … NOT backed up" | someone uploaded a file (a logo); the backup does not cover Storage files | tell the assistant: the backup needs a Storage step before the pilot |
| "KiranaBill backup is out of date" | no good backup for over 36 hours | open the log; run `npm run backup` |
