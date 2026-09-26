# 11 — Stack Decisions

**Last updated:** 26 Sep 2026 (rev 9)

Every technology choice, with the alternatives that were considered and why they were rejected.

**The governing question is not "what is best?" but "what is the simplest thing that solves our
actual problem and leaves a sensible path out?"**

Three tests every choice must pass:

1. **Do we need it now?** Not "will we need it" — *now*.
2. **What is the exit cost?** If this turns out wrong in a year, how painful is leaving?
3. **Can one person maintain it?** There is no team. There is no on-call rotation.

---

## SD-001 — Frontend framework: **React + TypeScript + Vite**

**Alternatives:** Svelte/SvelteKit · Vue · vanilla TS (status quo) · Next.js

| Rejected | Why |
|---|---|
| Vanilla TS | It's what the predecessor uses and it works, but there is no component model, no type safety across a growing UI, and no ecosystem for the offline/sync work ahead |
| Svelte | Genuinely smaller and faster, and I'd probably pick it for a team. **Rejected because AI tooling generates markedly better React than Svelte** — and AI is writing most of this code. That is a real constraint, not a preference. |
| Vue | Same reasoning as Svelte, less AI training data than React |
| Next.js | SSR, routing and server components solve problems this app doesn't have. It's a local-first offline app; server rendering is close to useless here. Added complexity for nothing. |

**Exit cost:** high, as with any framework. Mitigated by keeping `domain/` framework-free — the
pricing grammar, validator and learning engine are plain TypeScript and would survive a rewrite of
everything above them.

---

## SD-002 — Database and backend: **Supabase (Postgres)**

**Alternatives:** Firebase · PocketBase · raw Postgres on a VPS · Appwrite · staying on localStorage

| Rejected | Why |
|---|---|
| Firebase | Document store. **Money and relational integrity do not belong in a NoSQL document store.** Also the deepest vendor lock-in of the options. |
| PocketBase | Genuinely attractive — single binary, SQLite, very cheap. Rejected because it needs a server you operate, and a solo developer with a day job should not be on the hook for uptime. Also a much smaller ecosystem. |
| Raw Postgres on a VPS | Cheapest at scale, most control. Rejected for the same reason — you become the DBA, the sysadmin and the backup operator. |
| Appwrite | Comparable to Supabase, smaller community, less AI tooling familiarity |
| localStorage (status quo) | Capped at 200 bills, lost when browser storage clears. **The single most cited disaster in market research** was shopkeepers losing months of data on a phone change. |

**Why Supabase specifically:** real Postgres (not a proprietary layer), RLS as a genuine security
boundary, auth and storage bundled, free tier ample for the pilot, and — critically — **it's just
Postgres.** If Supabase becomes wrong, `pg_dump` moves you anywhere. That is the lowest exit cost of
any managed option.

**Cost:** ₹0 on the free tier at pilot scale. $25/month for Pro when a shop's data justifies PITR.

---

## SD-003 — Local storage and sync: **IndexedDB via Dexie + hand-rolled sync**

**Alternatives:** raw IndexedDB · RxDB · WatermelonDB · PowerSync · ElectricSQL · localStorage

| Rejected | Why |
|---|---|
| Raw IndexedDB | The API is genuinely unpleasant. Dexie is a thin, well-maintained wrapper with almost no lock-in. |
| RxDB / WatermelonDB | Full offline-first frameworks. They'd solve sync for us — but they impose their own data model on `domain/`, and they're heavy for what we need. |
| PowerSync / ElectricSQL | Purpose-built Postgres↔client sync. Technically the "right" answer for hard sync problems. **Rejected because our sync problem is not hard** (see below), and both add a paid service and real lock-in. |
| localStorage | No indexes, no transactions, small quota |

**Why hand-rolled sync is defensible here, and only here:** finalised bills are **immutable and
append-only**. The only mutable data is the shop catalog and shop settings — low-frequency,
resolvable by last-write-wins on `updated_at`. There is almost no conflict surface. A general sync
engine solves a problem we deliberately designed away.

**Warning to future self:** if bills ever become editable, or two devices bill simultaneously, this
decision must be revisited immediately. Reopen this ADR before adding either.

---

## SD-004 — Hosting and functions: **Netlify**

**Alternatives:** Vercel · Cloudflare Workers · Supabase Edge Functions · Render

| Rejected | Why |
|---|---|
| Vercel | Equivalent. No reason to migrate from a working setup. |
| Cloudflare Workers | Cheaper at scale, faster cold starts, genuinely better for a `/voice` endpoint. **Rejected for now** — different runtime, and migrating costs a day. Revisit at real volume. |
| Supabase Edge Functions | Fewer moving parts (one vendor). Deno runtime, smaller ecosystem. Reasonable alternative; not worth a migration today. |
| Render / Railway | Persistent servers we don't need |

**Why Netlify:** already working, free tier covers ~15k function calls/month against a 125k limit.
**Exit cost is low** — the functions are small and stateless.

---

## SD-005 — Speech to text: **Groq Whisper large-v3** (primary)

Full analysis in `07-DECISIONS.md` B1 and O1.

| Rejected | Why |
|---|---|
| Whisper large-v3-**turbo** | Cheaper *and worse*: 22.3% vs 15.7% WER on FLEURS-hi. The wrong trade in an app where a misheard number is a wrong bill. |
| Web Speech API as primary | Free and fast, but **accepts no vocabulary hints** — which kills shop-scoped phrase biasing, one of the two real differentiators. Kept as a secondary provider. |
| Sarvam Saarika | Best reported code-switch numbers, India data residency. **No public pricing** — parked as O2. |
| Self-hosted IndicWhisper | Free per-minute, better WER than Whisper. Break-even against Groq is ~5,400 bills/day across all shops (≈54 busy shops). Right eventually, wrong now. |

**Exit cost: near zero.** Everything sits behind `TranscriptionProvider`. Swapping is a config
change, and that interface is the decision that actually matters.

---

## SD-006 — LLM parsing: **Gemini Flash-Lite** (fallback layer only)

**Alternatives:** Claude Haiku · GPT-4o-mini · self-hosted small model · no LLM at all

| Rejected | Why |
|---|---|
| Claude Haiku 4.5 | ~8× the input cost of Flash-Lite. Configure as the failover provider, don't use as primary. |
| GPT-4o-mini | Comparable cost, no advantage; the existing prompt is tuned for Gemini |
| Self-hosted / fine-tuned | Premature with zero users |
| No LLM | The deterministic grammar cannot handle genuinely messy speech. Removing the fallback would break Rule 5 handling. |

**Note:** Gemini 2.5 Flash-Lite has a published retirement date. Verify the successor's pricing at
`ai.google.dev` directly — the aggregator tables in the research were internally inconsistent and
listed at least one model name that appears to be fabricated.

**Exit cost: near zero** — behind `ParseProvider`.

---

## SD-007 — Auth: **Google sign-in** (MVP)

| Rejected | Why |
|---|---|
| Phone OTP | What every Indian SMB app uses, and correct eventually. **Blocked:** DLT registration with TRAI requires a registered business entity. A legal blocker on a pilot's critical path. |
| Email + password | Password reset flows, storage, and support burden for zero benefit |
| Magic link | Fine, but Google is one tap and most Android users are already signed in |

Schema stays phone-ready. Revisit when there's a registered entity.

---

## SD-008 — Mobile packaging: **Capacitor** (after web MVP)

**Alternatives:** React Native · Flutter · TWA/Bubblewrap · PWA only

| Rejected | Why |
|---|---|
| React Native / Flutter | A second codebase, or a rewrite. Absurd for a solo developer with a working web app. |
| PWA only | Works, but **Play Store presence matters** — Pilloo's 50K downloads came from the Play Store, not a URL |
| TWA / Bubblewrap | Genuinely simpler than Capacitor and worth considering: it just wraps the PWA. **Rejected because it gives no native plugin access** — and native mic handling and offline speech are both plausible needs. If those never materialise, TWA would have been the better call. |

**Deferred until the web MVP is validated.** $25 one-time. iOS deferred further — $99/year.

---

## SD-009 — Testing: **Vitest** + SQL RLS tests

| Rejected | Why |
|---|---|
| Jest | Slower, needs more config with Vite |
| Playwright / Cypress E2E | **Not in MVP.** Solo projects abandon E2E suites by month three, and then they lie about coverage. Revisit with real users. |
| pgTAP | Heavier than needed. Plain SQL assertions run from a test script are enough for RLS. |

The tests that matter here are `domain/` unit tests and RLS negative tests. Everything else is
manual for now, and saying so honestly is better than a neglected E2E suite.

---

## SD-015 — Development tooling: **Antigravity** · 18 Aug 2026

| Rejected | Why |
|---|---|
| **Lovable** | Recommended in an earlier revision for Phase 3 scaffolding. Dropped: the UI is already specified in `13-DESIGN.md` and `05-FRONTEND-SPEC.md`, it generates in its own idiom requiring reconciliation, and one tool means one code style. |
| Cursor / Windsurf | Comparable IDEs, but the owner's Google AI Pro plan already covers Antigravity at no extra cost |
| Codex as primary | ChatGPT Go quota is tighter. **Kept as backup** for quota exhaustion and second-opinion debugging. |
| Cline / Aider / Continue.dev | All viable, all require bringing your own API key. No advantage over a covered plan. |

**Exit cost: zero.** `09-WORKING-AGREEMENT.md`'s bootstrap prompt lets any tool pick up the project
from the docs. This is a preference, not a dependency.

## SD-016 — Diagrams: **Mermaid** · 18 Aug 2026

| Rejected | Why |
|---|---|
| Figma / Excalidraw / draw.io | Binary or external files that drift from the docs and can't be read by an AI |
| ASCII art | Doesn't render, hard to edit, no semantics |
| PlantUML | Needs a rendering step; GitHub renders Mermaid natively |

Plain text in markdown, versioned in git, rendered by GitHub, read natively by AI tools.

## SD-010 — Things deliberately NOT adopted

Recorded so they aren't re-proposed every few months.

| Not using | Why not | Reconsider when |
|---|---|---|
| Redux / Zustand / Jotai | React state plus a small context is enough for this app's size | State bugs actually appear |
| Tailwind vs plain CSS | ~~Undecided — see Open below~~ **Closed 17 Aug 2026 — Tailwind, see SD-011.** Row kept as history (26 Sep 2026 note). | — |
| GraphQL | REST + Supabase client is simpler for one consumer | Never, probably |
| Docker | Nothing to containerise; Netlify and Supabase are managed | Self-hosting anything |
| Microservices | One person, one app | Never |
| Kubernetes | See above | Never |
| Redis / caching layer | No measured cache pressure | Measured pressure |
| Message queue | The sync worker is the queue | Background jobs beyond sync |
| Sentry / error tracking SaaS | Console + structured logs are enough for one user | Real users hit bugs you don't see |
| Analytics SaaS | One user, and you can ask him | Multiple shops |
| CI/CD beyond tests-on-push | Netlify auto-deploys; GitHub Actions runs Vitest | Releases start breaking |
| Staging environment | Doubles maintenance for one pilot user | Second shop |
| Feature flags | No users to flag features for | Multiple shops on one build |
| i18n framework | Two languages, a flat key map is enough | A third language |

---

## SD-011 — Styling: **Tailwind CSS** · closed 17 Aug 2026

Was SD-Q1.

| Rejected | Why |
|---|---|
| Port the predecessor's 1,855-line CSS | It encodes the **old visual language**, which the owner has said isn't good enough. Porting it means carrying forward the thing we want to leave. |
| CSS Modules | Fine, but slower to iterate and weaker AI tooling support |
| Styled-components / Emotion | Runtime cost on budget Android for no benefit here |

Tailwind also generates markedly better with AI tools, which matters when AI writes most of the code.
**Design tokens are defined in `tailwind.config.ts` from `13-DESIGN.md`** — not scattered as raw
utility values. That keeps the visual language in one place and reviewable.

**Amendment, 26 Sep 2026 — the `tailwind.config.ts` line above is stale.** `KB-000` pinned **Tailwind
v4** (20 Aug 2026): tokens live in an `@theme` block in `src/index.css`, and there is **no
`tailwind.config.ts` and no PostCSS config** — v4's Vite plugin handles both. `13-DESIGN.md` §8 is the
current spec. The decision (Tailwind, tokens in one reviewable place) stands; only the file changed.

## SD-012 — Local storage: **Dexie** · closed 17 Aug 2026

Was SD-Q2. ~25 KB, actively maintained, thin enough that the exit cost is near zero — the raw
IndexedDB API underneath stays accessible. This is the deliberate exception to the working
agreement's "can this be 30 lines of our own code?" rule: raw IndexedDB is genuinely unpleasant, and
getting transactions and schema versioning wrong here would corrupt bill data.

## SD-013 — Charts: **deferred, no decision needed** · closed 17 Aug 2026

Was SD-Q3. Reports are post-MVP. Deciding a charting library now would be picking a tool for a
feature that doesn't exist. Revisit when a report ticket is written.

## SD-014 — Excel import/export: **SheetJS (xlsx)** · 17 Aug 2026

Needed for bulk catalog upload (`KB-314`), which is table stakes — Vyapar and myBillBook both have
it, and a shop with 500+ products will not type them in one at a time. SheetJS parses `.xlsx`
client-side, so upload becomes a normal local write that syncs like anything else. No server-side
file handling, no new infrastructure.

---

## SD-017 — Build-script runner: **tsx** (dev-only) · 08 Sep 2026

Needed to run `scripts/build-catalog-seed.ts` (`npm run seed:catalog`, `KB-003`) as committed,
type-checked TypeScript without a manual compile step.

| Rejected | Why |
|---|---|
| Plain `.js` for the script | Would avoid the dependency, but the correction that created this script explicitly wanted a typed, committed, reproducible transform — losing types on the one script that touches money-seed data is the wrong trade. |
| `ts-node` | Heavier, slower startup, more configuration surface for the same job |
| Relying on Node's native `--experimental-strip-types` | Version-dependent (Node 22.6+, and only unflagged on very recent Node) — not safe to assume on the owner's installed Node LTS |

**Exit cost: near zero.** Dev-only, not in `dependencies`, not part of any shipped bundle. Deleting
it just means switching the one script's run command.

## SD-018 — Node type declarations: **@types/node** (dev-only) · 08 Sep 2026

Needed so `scripts/build-catalog-seed.ts` type-checks against `node:fs`, `node:path`, etc. Standard,
near-universal companion to any typed Node script; no alternative considered — the alternative is no
type-checking on the seed script, which is exactly the reproducibility guarantee `KB-003`'s
correction asked for.

## SD-019 — Supabase CLI: **`supabase` ^2.117.0** (dev-only) · 17 Sep 2026

Needed to run `supabase link`/`supabase migration`/etc. against the project's real Supabase instance
(`KB-102`) without requiring a machine-global install. Added by the owner directly as part of linking
the project (ref `urcenodcxtzwjrulwvgf`) ahead of `KB-102`'s schema/migration work — this entry
documents it per `09-WORKING-AGREEMENT.md` §B6, not a new choice made here.

No alternative considered: this is the official CLI for the platform this project already committed
to (`SD-002` — Supabase/Postgres), not a general-purpose tool with competing options.

**Exit cost: near zero.** Dev-only, not in `dependencies`, not part of any shipped bundle. The CLI is
also independently reinstallable globally if ever removed from the repo's own devDependencies.

## SD-020 — ESLint: **`eslint` ^10.10.0 + `@typescript-eslint/parser` ^8.70.0** (dev-only) · 17 Sep 2026

Needed to enforce `07-DECISIONS.md` D16: `domain/` must never import from `data/`, `providers/`, or
`ui/` (`02-ARCHITECTURE.md` §10). That boundary was true by discipline alone through Phase 0, safe
only because those folders were empty — Phase 1 puts real code in them, so a stray import would now
compile and pass every test while silently breaking the one property that keeps `domain/` testable
without a database or browser. Owner decided to add tooling rather than rely on manual review alone.

**Deliberately minimal — one rule, nothing else.** `eslint.config.js` has exactly one rule
(`no-restricted-imports`, scoped to `src/domain/**/*.ts` only) blocking imports matching
`**/data/**`, `**/providers/**`, `**/ui/**`. No formatting rules, no style rules, no other
correctness rules, no linting of `ui`/`data`/`providers`/`app` themselves. `@typescript-eslint/parser`
is included only so ESLint can parse `.ts` syntax (`import type`, generics) — none of
`@typescript-eslint/eslint-plugin`'s rules are used, so that package isn't installed at all.

Verified the rule actually fires, not just configured and assumed: temporarily added a real
`../data/*` import inside `src/domain/`, confirmed `npm run lint` fails with the exact message above,
removed the probe file, confirmed clean again.

| Rejected | Why |
|---|---|
| A full `@typescript-eslint/eslint-plugin` + recommended rule set | Exactly what this decision explicitly avoids — style/correctness linting nobody asked for, when the only need is one import-boundary rule |
| `dependency-cruiser` or similar dedicated boundary tool | A second dependency and a second config format for a need one ESLint rule already covers |

**Exit cost: near zero.** Dev-only, two packages, one rule, one config file. Deleting `eslint.config.js`
and the two devDependencies removes it cleanly with no trace elsewhere in the codebase.

## SD-021 — Postgres client for tests: **`pg` + `@types/pg`** (dev-only) · 20 Sep 2026

Needed for `KB-105`'s automated RLS negative-test suite (`scripts/rls-negative-tests.ts`), which
connects directly to Postgres and switches simulated roles/JWT claims mid-transaction to exercise RLS
for real — something Vitest's `domain/`-oriented setup has no way to do, and shouldn't (hard rule 3:
`domain/` never touches a database). `pg` is the standard, minimal, actively-maintained Postgres
driver for Node — no ORM, no query builder, nothing beyond raw parameterized SQL, which is exactly
what a test asserting on Postgres error codes needs. **This entry should have been added at `KB-105`
itself and was missed** — logged now, during `KB-106`'s documentation pass, rather than left
permanently absent.

**Exit cost: low.** Dev-only, used by exactly one script; a different Postgres client would be a
same-shape swap with no ripple into `domain/` or the app.

## SD-022 — Supabase client: **`@supabase/supabase-js`** (runtime) · 20 Sep 2026

Needed for `KB-106` (Google sign-in) and everything after it that talks to Supabase from the browser —
auth, the eventual sync worker, storage. Fails `09-WORKING-AGREEMENT.md` §B6's first question ("can
this be 30 lines of our own code?") on purpose: hand-rolling OAuth redirects, JWT refresh, and session
persistence is exactly the kind of thing not worth re-implementing when the platform's own official
client (`SD-002` already committed to Supabase/Postgres) does it correctly and is the primary,
actively-maintained SDK for the one backend this project has.

**Exit cost: real but bounded.** This is the one true "hard to leave" dependency in the project so
far — swapping backends would touch this everywhere it's used. Accepted because switching backends is
not a scenario this project is hedging against; `SD-002` already closed that question.

## SD-023 — Component testing: **`@testing-library/react` + `jsdom`** (dev-only) · 20 Sep 2026

Needed to test `KB-106`'s `AuthProvider` — a React context with real hook/effect logic (session
state, subscription cleanup) that a database-free, DOM-free `domain/`-style unit test can't exercise
meaningfully. `@testing-library/react`'s `renderHook` against a mocked Supabase client (not the real
one — no network, no real OAuth) tests the state machine itself: loading → signed-out/signed-in
transitions, `signInWithGoogle`/`signOut` calling the right client methods, the auth-state listener
unsubscribing on unmount. `jsdom` is the DOM environment `renderHook` needs; scoped to this one test
file via a `// @vitest-environment jsdom` docblock, not a global config change — every `domain/` test
keeps running under the faster, DOM-free `node` environment `vite.config.ts` already sets.

**Exit cost: low.** Dev-only, standard for React component testing, no production bundle impact.
Real OAuth round-trip correctness still comes from `KB-106`'s manual browser verification, not from
these tests — mocked-client tests prove the state machine, not that Google sign-in actually works.

## SD-024 — Local storage: **`dexie` ^4.4.6** (runtime) + **`fake-indexeddb` ^6.2.5** (dev-only) · 20 Sep 2026

Library choice already closed (`SD-012`, 17 Aug 2026) — this entry pins the actual version and adds
the test-only dependency `SD-012` didn't need to name yet.

`fake-indexeddb` is `KB-109`'s addition: Dexie's own recommended way to test against a real,
spec-compliant IndexedDB implementation under Node/Vitest — not a hand-rolled mock of Dexie's API,
which would under-test exactly what `SD-012` names as the real risk of choosing Dexie ("getting
transactions and schema versioning wrong here would corrupt bill data"). Same justification shape as
`SD-023`'s `jsdom`: standard, dev-only, needed because this is real database logic a manual mock
can't exercise meaningfully.

**Exit cost: low.** Dev-only, used only by `db.test.ts`; no production bundle impact, no ripple into
`domain/`.

## SD-025 — Development tooling: **Claude Code** · 26 Sep 2026 (decided 21 Aug 2026)

**Supersedes SD-015** (Antigravity), which is left as written. Decision record: `07-DECISIONS.md`
D28 (supersedes T1). Antigravity's quota ran out mid-`KB-000`; Claude Code has built every ticket
since, bootstrapped from `CLAUDE.md` (auto-loaded) and `18-AGENT-CONTRACT.md`.

| Rejected | Why |
|---|---|
| Staying on Antigravity | Quota exhausted mid-ticket — the failure mode SD-015's own Codex-backup row anticipated |
| Codex as primary | Same reasoning as SD-015: tighter quota, and one tool means one code style |

**Exit cost: zero, as SD-015 predicted and 21 Aug 2026 demonstrated** — the switch cost nothing
because the docs, not the tool, hold the project's context. Keep it that way: rules live in
`CLAUDE.md`/`18-AGENT-CONTRACT.md`, never in a tool-specific config only one agent reads.

## How to add to this document

Every new dependency, service, or platform gets an entry: what was chosen, what was rejected, why,
and the exit cost. If an entry cannot be written honestly, that is a signal the choice hasn't been
thought through.
