# 07 — Decision Log

**Last updated:** 9 Oct 2026 (rev 43) · Supersedes rev 40

Every architectural decision, dated, with reasoning. **Never edit an entry.** When a decision
changes, add a new one that supersedes it. The history is the point — it stops decisions being
re-argued and stops an AI tool from silently choosing differently.

---

## Closed

| # | Decision | Choice | Reasoning |
|---|---|---|---|
| **A1** | Product thesis | One-turn billing that never silently gets a number wrong | Pilloo has better recognition and still needs 4 turns, and printed ₹300 for a ₹150 bill with no warning |
| **A2** | Primary metric | Turns-to-bill, target 1 | Accuracy alone is insufficient — Pilloo is accurate *and* slow |
| **A3** | Udhaar in MVP | **Out** | Doesn't test the differentiator. Schema stays ledger-ready. |
| **A4** | Shop profile | Unlimited bills, unlimited catalog, mobile + desktop | Owner decision |
| **C1** | Delivery | **Web + PWA first.** Android (Capacitor) only after web MVP is complete. iOS deferred. | Owner decision, rev 2. One surface at a time. |
| **C2** | Frontend | React + TypeScript + Vite | Standard, best AI-tool support, Capacitor-compatible |
| **C4** | Database | Supabase / Postgres | Relational integrity for money |
| **C5** | Auth (MVP) | Google sign-in only | Phone OTP needs DLT/TRAI registration → needs a registered business entity |
| **D1** | Money | Integer paise everywhere | No floats, ever |
| **D4** | Catalog model | Shared versioned base + per-shop catalog; shop picks at onboarding; can pull base items in and edit price | Owner decision |
| **E1** | Sequencing | Fix eval + pricing grammar **before** any new feature work | Owner decision |
| **B1** | STT primary | Groq Whisper large-v3, behind a provider interface | Proven. **Not** turbo: 22.3% vs 15.7% WER. |
| **B4** | Parse layer | Deterministic grammar first, LLM fallback | Fixes latency, cost, reproducibility together |
| **B7** | Interaction model | Push-to-talk, batch. Never conversational. | Conversational design is exactly why Pilloo needs 4 turns |
| **B10** | Learning scope | Strictly per-shop | Current code defaults to `"global"` — silent multi-tenancy break |

---

## D5 — Offline AND online, staged 🟢

**Supersedes:** "online only" (rev 1). Owner decision.

Offline is not one feature. It's four levels with very different costs. MVP ships levels 1–2.

| Level | Capability | MVP? |
|---|---|---|
| 1 | **Offline read** — catalog, history, settings cached and browsable | ✅ Yes |
| 2 | **Offline manual billing** — create, edit, finalise without network; sync on reconnect | ✅ Yes |
| 3 | **Offline voice** | ❌ No — requires on-device STT. See O1. |
| 4 | Multi-device concurrent editing with conflict resolution | ❌ No — one device per shop in MVP |

### Architecture: local-first, not an outbox bolt-on

The app always reads and writes **IndexedDB**. A background sync worker reconciles with Supabase.
**One write path**, so offline is the natural behaviour rather than a special case. A bolted-on
outbox creates two write paths, and that is where the bugs live.

**Why this is tractable here:** finalised bills are **immutable and append-only**. There is almost no
conflict surface. The only mutable data is the shop catalog and shop settings — both low-frequency,
both resolvable with last-write-wins plus a timestamp.

### The one hard problem: receipt numbering offline

A sequential per-shop receipt number cannot be assigned without the server.

**Solution: block allocation.** When online, the device reserves a block of receipt numbers (e.g.
50). Offline bills draw from the reserved block, so **the number shown to the customer never changes
after sync**. If the block is exhausted while offline, fall back to a device-prefixed number and
reconcile on sync.

---

## D6 — Customer name and mobile on the bill 🟢

**Owner decision:** name always present, mobile optional. Both stored on the bill so the future
udhaar feature has the data.

**⚠️ One modification, and it matters.**

A *mandatory* customer name directly violates non-negotiable #2 — *never ask a question mid-bill* —
and reproduces the exact friction observed in Pilloo, which demanded *"बिल किसके नाम पर बनाना है?"*
for a one-item rice bill and had to be told *"अरे बस बिल बनाओ किसी के नाम पर मत बनाओ."*

**Recommendation:** the field is always visible and always fillable — before, during, or after
billing — and **defaults to "Cash"**. It never blocks finalise. Mobile is optional and free-text.

This captures the same data for udhaar later without putting a question between the shopkeeper and a
finished bill. When udhaar arrives, a real customer identity becomes required only for **credit**
bills — where the shopkeeper actually wants to record who owes them.

*If you want it genuinely blocking, say so and I'll change it. But the thesis says otherwise.*

---

## N2 — Base catalog mechanism 🟢 (confirmed)

- `base_products` — shared, read-only, **versioned**. Seeded from the existing 482 products.
- `shop_products` — per shop. Either references a base product **plus a shop-owned price**, or is
  fully custom.
- **Price always lives in `shop_products`.** Chini is ₹45 in one shop, ₹48 in another.
- At onboarding: import the base catalog, or start empty. Either way, base products can be pulled in
  and edited later.
- Base catalog improvements are **offered**, never auto-applied over a shop's edits.

---

## N1 — Catalog matching: **my rev 1 recommendation was wrong** 🟢

I recommended a 5,000-product client-side threshold. I then benchmarked your actual
`getBestCatalogMatch()`, and the real number is far lower.

**Method:** worst-case queries with no exact match (which is every keystroke of a type-ahead search),
catalog scaled by cloning, budget Android estimated at 4× desktop.

| Catalog | Desktop | Budget Android | Verdict |
|---:|---:|---:|---|
| 482 | 2.3 ms | ~9 ms | smooth |
| 1,000 | 5.7 ms | ~23 ms | **laggy** |
| 2,000 | 10.0 ms | ~40 ms | laggy |
| 5,000 | 26.4 ms | ~106 ms | **unusable** |
| 10,000 | 56.3 ms | ~225 ms | unusable |
| 20,000 | 126.1 ms | ~504 ms | unusable |

60 fps budget is 16.7 ms per keystroke. Above that, typing visibly stutters.

I also tested whether memoising `buildValidatorCatalog()` helps — it rebuilds the entire index on
every lookup, so it looked like the obvious win. **It isn't.** Memoised timings were within noise.
The cost is the **O(n) linear scan** in the matcher, which scores every catalog entry against every
query variant.

**So the real ceiling of the current implementation is ~1,000 products, not 5,000.**

### Decision

This is an **implementation** limit, not a fundamental one. Client-side search libraries handle tens
of thousands of items smoothly because they use an index instead of a scan.

| Option | Verdict |
|---|---|
| Keep the O(n) scan, cap catalog at 1,000 | ❌ Caps the product arbitrarily |
| Move matching server-side (Manus's `pg_trgm`) | ❌ Network call per keystroke; loses the hand-tuned category guards, length-scaled thresholds and phonetic variants in `validator.js`; **and cannot work offline** |
| **Client-side matching backed by a real index** | ✅ **Chosen** |

Implementation:

- Prefix map on the first 2–3 characters → candidate set
- Character n-gram inverted index for fuzzy candidates
- Score only the candidate set (typically tens of entries), never the whole catalog
- Build once on catalog load; update incrementally on edits
- **Every existing guard in `validator.js` is preserved** — they run on candidates, unchanged

**Threshold after this work: 10,000 products client-side.** Above that, server-side search.

*The pilot shop runs 500+ SKUs and is mart-like rather than a corner kirana, so the 10,000 ceiling
has roughly 20× headroom — but it is headroom, not an impossibility. If a shop approaches 5,000,
revisit early rather than at the threshold. See `NI-12`.*

**On what competitors do:** I have no web access, so I won't invent their implementations. What
follows from architecture: desktop-first Indian billing software (Vyapar, Marg, Busy) runs on a
**local database**, so matching is local by definition. Offline-capable mobile POS systems generally
cache the catalog locally, because counter latency is not negotiable and a per-keystroke network
round trip is. **D5 forces the same conclusion independently — server-side matching cannot work
offline.**

**New ticket: `KB-CATALOG-INDEX`.** Now a blocker for type-ahead search, not a nice-to-have.

---

## O1 — Web Speech API: secondary provider, not primary 🟢

### Strengths
- **Free.** Zero per-call cost — roughly 48% of your per-bill spend at large-v3.
- **Fast.** No audio upload to your server then to Groq. Removes a full round trip.
- **Already in your codebase** as a fallback path.
- **Can work offline** on Android with the Google offline language pack installed — the only
  realistic route to offline voice, short of a WASM Whisper (too heavy for budget phones).

### Weaknesses — one is close to disqualifying
- **No phrase biasing.** You cannot supply a vocabulary. This kills differentiator #2 in the PRD:
  shop-scoped biasing toward one shop's fifty real items, the one lever a generic competitor
  structurally cannot pull. Whisper accepts a `prompt`; Web Speech accepts nothing.
- **No control over the model.** Google can change or throttle it. Not a supported API contract.
- **Browser inconsistency.** Good on Chrome/Android, absent on Firefox, poor on iOS Safari. Inside a
  Capacitor WebView, behaviour depends on the WebView build.
- **Flaky continuous mode on mobile** — your existing code already carries mobile-specific retry and
  queueing logic, which suggests you hit exactly this.
- **Often still needs network.** Google's recogniser is cloud-backed unless the offline pack is present.

### Decision

**Primary: Groq Whisper large-v3.** Phrase biasing is worth more than the cost saving, and the cost
is manageable at pilot scale (~₹300–500/month).

**Secondary: Web Speech API**, behind the same `TranscriptionProvider` interface, used for:
1. Fallback when Groq fails or times out
2. The **offline voice path** (level 3), once levels 1–2 are shipped
3. A cost-reduction option for very high-volume shops later

### Does it block anything?

**No.** Both sit behind one interface, so this is a configuration choice, not an architectural
commitment. It does not limit scalability and it does not block the app. Test it when convenient —
not before Phase 2. The provider interface is the decision that matters; which provider wins is
reversible in a day.

---

## Rev 3 — 17 Aug 2026

### D7 — Catalog: database is the source of truth, client holds a cache 🟢

**Clarification, not a reversal.** The predecessor's `products.js` was a hardcoded file; that is
exactly what is being replaced.

- **Source of truth: Postgres** (`shop_products`, per shop). Every write is a database write.
- **Client cache: IndexedDB** — a synced read-copy, for instant search and offline operation.
- **Search index: in memory**, built from the cache.

Products are added from the Catalog screen, from bulk Excel import, or **inline during billing** —
all three are the same database write, and all three appear immediately in the catalog list.

**Why not query the server per keystroke:** type-ahead fires on every character; a round trip is
100–300 ms on Indian mobile data and stops working offline. Offline-capable POS software keeps a
local copy — Vyapar's desktop product works this way. The cache is bounded (500 products ≈ 80 KB)
and falls back to server-side search above 10,000.

### D8 — Bulk catalog import 🟢

Excel/CSV upload with a preview-and-confirm step. Table stakes: Vyapar and myBillBook both have it,
and a 500-product shop will not type them in one at a time. New ticket `KB-314`.

### D9 — Phase 0 restructured: build `domain/` first 🟢

**Supersedes:** "fix the grammar in the old codebase, then port it."

The old code is a **reference, not a base.** Its *knowledge* migrates; its *implementation* does not.
Phase 0 now builds `src/domain/` as standalone TypeScript with the eval harness, before any UI,
database or auth. Same work, done once instead of twice.

### D10 — Design direction 🟢

See `13-DESIGN.md`. Utility-instrument layout, Indian palette, Devanagari-first typography.
Explicitly not generic SaaS blue, no gradients, no glassmorphism.

---

## Rev 4 — 18 Aug 2026

### T1 — Build tool: **Antigravity, single tool through MVP** 🟢

Owner has Google AI Pro (covers Antigravity) and ChatGPT Go (covers Codex).

**Antigravity primary, all phases. Codex backup only** — quota exhaustion mid-ticket, or a bug stuck
over an hour needing different reasoning.

Rationale beyond quota: it is an **IDE**. The owner maintains this codebase alone for years, so
seeing every file change matters more than agent throughput. A cloud agent returning finished diffs
optimises the wrong variable.

### T2 — Lovable dropped 🟢

**Supersedes** rev 1's "Lovable for Phase 3 UI scaffolding." `13-DESIGN.md` and
`05-FRONTEND-SPEC.md` already specify the UI, so the scaffolding value is gone; it generates in its
own idiom requiring reconciliation; and one tool means one code style. Simpler for one person.

### T3 — MCP servers: none at Phase 0 🟢

Each connected MCP injects tool definitions into every request, consuming context. Only three are
ever relevant: **Supabase** (Phase 1, read-only token preferred), **Chrome DevTools** (Phase 3),
**GitHub** (optional). All free. Everything else in Antigravity's catalogue is irrelevant here.

**Migrations stay as committed files applied manually** — the agent never alters the schema directly.

### T4 — Diagrams: **Mermaid** 🟢

Plain text in markdown: versions in git, renders on GitHub, read natively by AI tools. No binary
image files, no external diagram tool, no drift between diagram and doc. All diagrams in this set
are validated against the Mermaid parser.

### T5 — Graphify: parked, not rejected 🟢

Knowledge-graph layer over the codebase to cut agent navigation tokens. **Unknown to this
documentation set** — postdates available knowledge; licence, maintenance and whether it uploads
code are unverified.

On principle: the problem it solves does not exist at Phase 0, because there is no code. The
17-document set already provides a curated context layer, more accurate than an auto-generated
graph. **Reconsider at Phase 3.** Recorded as `NI-13`.

---

## Closed — 17 Aug 2026

| # | Question | Resolution |
|---|---|---|
| **O2** | Sarvam pricing | **Dropped.** Owner will not pursue. Groq Whisper large-v3 is the decision; `TranscriptionProvider` keeps it reversible if accuracy ever demands it. |
| **O3** | Why was the fast-path regex experiment rolled back? | **Void — no such experiment.** The note came from an AI-generated summary, not from the owner. There is no evidence any rollback happened. Build the deterministic parser fresh with no inherited assumption. |
| **O4** | Does Pilloo implement `ka`/`wala`? | **Closed: it does not.** Owner tested "chawal 5 kilo tees wala" and "chawal 5 kilo tees ka" — Pilloo returns the same amount for both. **The pricing grammar is confirmed as a genuine differentiator** and may be claimed. |

---

## Rev 5 — 08 Sep 2026

### D11 — Money rounding: **half-up**, not banker's rounding 🟢

**Supersedes:** the "banker's rounding" note in `03-DATA-MODEL.md` section 8 (rev 2 and earlier).
That note was the owner's error, corrected during `KB-003`.

Banker's rounding (round-half-to-even) exists to keep statistical aggregates unbiased across many
transactions — the right property for accounting/statistical systems, not the property this product
needs. The thesis (`01-PRD.md` — *never silently get a number wrong*) is about a **specific
shopkeeper trusting a specific number in front of them**, not about long-run statistical bias.

**Concrete difference:** at exactly 1516.5 paise, half-up rounding gives ₹15.17; banker's rounding
gives ₹15.16. A shopkeeper checking the total on a calculator expects the half-up answer — that's the
rounding everyone is taught by hand. Predictability to the person reading the bill outweighs an
unbiasedness property nobody at the counter is measuring.

**Scope:** this is the rounding rule for every money computation in `domain/money.ts` — line totals
(`qty × rate_paise`) and any future rounding point. Bill totals are **never** re-rounded; they are a
sum of already-rounded, half-up line totals (unchanged from `03-DATA-MODEL.md` section 8).

**Implementation note:** `domain/money.ts` performs this rounding using integer string-slicing, not
floating-point division, so a genuine half-paise tie can never be pushed the wrong way by
floating-point error. A test (`money.no-float.test.ts`) statically asserts the file contains no
division operator and no `parseFloat` call, specifically to catch a future edit that reintroduces
float rounding (e.g. `Math.round(x * 100) / 100`) even though a correctness/drift test alone wouldn't.

---

## Rev 6 — 08 Sep 2026

### D12 — Catalog category: two fields, seven guard buckets plus "other", precomputed at seed time 🟢

During `KB-003`, the owner's own onboarding correction claimed `legacy/products.js` has a
per-product `category` field. It doesn't — products are grouped under 48 comment headers by
position (`14-LEGACY-REFERENCE.md` section 9). Deriving a single category value from that
positionally is straightforward. What isn't straightforward: those 48 headers are the wrong grain
for the validator's actual need, and several of them mix genuinely different product types under one
heading (worst case: `GRAINS / SEEDS`, which contains grains, dals, spices, and two bars of soap).

**Decision: `CatalogEntry` carries two category fields, not one.**

| Field | What | Used for |
|---|---|---|
| `sourceCategory` | The literal header text, verbatim, all 48 values | **Provenance only.** Never read by the validator. How a wrong assignment gets debugged later. |
| `guardCategory` | One of exactly eight values: `dal`, `oil`, `masala`, `tea`, `grain`, `soap`, `hygiene`, `other` | **What `KB-005b`'s validator reads** to reject a mismatched match — a "daal" matching a soap |

**The eight `guardCategory` values:** the six buckets already in `legacy/products.js`'s
`CATEGORY_GUARDS` (`dal`, `oil`, `masala`, `tea`, `grain`, `soap` — `14-LEGACY-REFERENCE.md` section
5), **plus `hygiene`**, split out of `soap` (28 + 15 = 43 products in one bucket is too coarse —
toothpaste matching a bar of detergent is exactly the kind of mismatch this guard exists to prevent),
**plus `other`**, for the roughly 58% of the catalog that is none of the above (biscuits, stationery,
medicines, beverages, and so on).

**`guardCategory` is precomputed at seed time from an explicit, committed mapping table**
(`CATEGORY_TO_GUARD` in `scripts/build-catalog-seed.ts`, one entry per `sourceCategory`), with
per-product-id overrides (`GUARD_CATEGORY_ID_OVERRIDES`) for the specific items that don't match
their header's majority category — every override was decided by reading the actual product, not
guessed from the header name or inferred by keyword matching. This is a deliberate reversal of the
legacy approach, which ran `CATEGORY_GUARDS` keyword matching against the spoken phrase **at match
time, every time**. Precomputing it once, reviewably, is simpler, faster, and — because the owner can
read and disagree with every line of the mapping before it ships — more trustworthy than an inference
rule nobody re-checks.

**Why not merge or rename the 48 `sourceCategory` values down to something cleaner:** several are
near-duplicates of each other (`WASHING / CLEANING` vs `WASHING / CLEANING BRANDS`,
`ATTA / GRAINS / FLOUR` vs `BRANDED ATTA / FLOUR`, and six more pairs like them) because the original
24-category array and the later "expanded set" push-blocks were never unified. Collapsing them would
destroy provenance for a cosmetic gain. `sourceCategory` stays exactly as written in
`legacy/products.js`; `guardCategory` is the clean, semantic layer built on top.

---

**Amendment, 09 Sep 2026 — the eight-bucket version above was the owner's own error, corrected the
same day.** `other` at 58% of the catalog defeated the purpose: a mishearing of "biscuit" could match
"bulb," and nothing would reject it, because both were `other`. The six original buckets (plus
`hygiene`) came from `legacy/products.js`'s `CATEGORY_GUARDS`, which was hand-built for mishearings
that had actually happened — not as a taxonomy of a grocery shop's full stock. `other`'s size was the
evidence that a mishearing-driven list doesn't cover a real kirana's shelves.

**`guardCategory` is now sixteen values, not eight:** the original seven (`dal`, `oil`, `masala`,
`tea`, `grain`, `soap`, `hygiene`) plus eight new buckets built to actually cover the catalog —
`dairy`, `snack`, `sweet`, `beverage`, `condiment`, `dryfruit`, `household`, `medicine` — plus `other`.
`tea` stays separate from the new `beverage` bucket deliberately: chai patti is a high-frequency
spoken item and deserves its own tight guard rather than being lumped in with cold drinks.

Several `sourceCategory` headers split by product type rather than by majority rule — `sugar` goes to
`sweet`, `salt` goes to `condiment`, even when both sit under one header
(`SUGAR / SALT / JAGGERY`, `SUGAR / NAMKEEN BRANDS`) — using the same per-id override mechanism
already established for `GRAINS / SEEDS`.

**Result: `other` fell from 279 products (58%) to 9 (1.9%)** — `EGGS` (2, left as-is: one product
pair, distinctive) and seven `MISC GROCERY` baking ingredients (baking soda, baking powder, agar
agar, food color, rose water, corn starch, yeast) that genuinely fit none of the sixteen buckets.
Forcing them into a wrong bucket to hit a number would have created exactly the false-positive risk
this system exists to prevent — see `14-LEGACY-REFERENCE.md` section 5 for why they're left alone.

---

## Rev 8 — 14 Sep 2026

### D13 — Four interpretive calls made while turning the old Gemini prompt into deterministic `domain/grammar.ts` logic 🟢

`docs/14-LEGACY-REFERENCE.md` section 1 is a verbatim LLM prompt — it can absorb inconsistency
through few-shot pattern-matching in a way a deterministic function cannot. Writing `KB-005`'s tests
against it required resolving four real ambiguities the prompt either left open or answered two
different ways. Recorded here so a future session doesn't have to re-derive — or accidentally
re-litigate — the same four calls.

**1. "Total price only, no qty/unit spoken" — the prompt contradicts itself; resolved by catalog
resolution.**

RULE 2's own text says: *"if only total price is spoken and no quantity/unit is spoken, do NOT
invent qty or unit — set qty:null, unit:''."* Its own examples do exactly that anyway: `"namak 20
rupay ka"` → `qty:1, unit:kg`; `"ajwain 10 rupay"` → `qty:1, unit:gm`.

**Decision:** if the spoken product resolves against the catalog, assume `qty:1` of **that catalog
entry's own unit**. If it doesn't resolve, `qty:null, unit:""` — there is nothing to fall back to.
This explains every example in the source prompt without contradiction, and matches the already-shipped
`KB-004` fixture (VC005: `"ajwain 10 ki"` → `qty:1, unit:"gm"`, Ajwain's catalog unit) — a real
consistency check, not just a plausible-sounding rule.

**2. `paune` and `sawa` are compositional, not fixed constants — `dedh`/`dhai` stay fixed.**

`docs/14-LEGACY-REFERENCE.md` section 3 already flagged `paune=0.75` as wrong in context: *"paune
do" is 1.75, not 0.75.* The general pattern in spoken Hindi is that `paune`/`sawa` modify whichever
number word follows them (`paune do` = 2 − 0.25 = 1.75; `sawa teen` = 3 + 0.25 = 3.25), while `dedh`
(1.5) and `dhai` (2.5) are idiomatic to those exact values and don't compose the same way — nobody
says "dedh teen" to mean something.

**Decision:** `paune <number>` = number − 0.25; `sawa <number>` = number + 0.25; bare `paune`/`sawa`
(no following number word) default to the "...ek" form (0.75 / 1.25 respectively), preserving the one
bare-form usage already live in the `KB-004` eval fixtures (VC010: `"sawa kilo besan"` → `qty:1.25`).
`dedh` and `dhai` stay fixed constants.

**Extending the same compositional treatment to `sawa` was not asked for** — only `paune` was flagged
as broken. Doing it anyway, because leaving `sawa` non-compositional while fixing `paune` would leave
the grammar asymmetric for no linguistic reason: both words follow the identical construction in real
speech.

**3. `chataak` is a unit (≈50g), not a fraction multiplier.**

The old Gemini prompt listed `chataak=0.05` alongside the fraction words (`aadha`, `paav`, `sawa`...),
but `HINDI_FRACTIONS` in the actual code dictionary never had an entry for it — the two sources
disagreed, per `14-LEGACY-REFERENCE.md` section 3. `0.05` only makes sense read as *0.05 kg = 50g* — a
weight, not a multiplier applied to a following unit word the way `aadha kilo` (0.5 × kilo) works.

**Decision:** `chataak` joins the unit system (alongside `kg`/`gram`/`liter`), not the fractions
table — `1 chataak = 50g`, converting straight to `gm` the same way any other weight unit does. Not
invented: it's the same number in the old prompt, correctly reinterpreted as what it actually
described. **Owner's note for the pilot:** some regional usage puts a chataak closer to 58g (1/16 of
a traditional seer) — worth a real-world sanity check once testing in the shop, not blocking now.

**4. Bail-out (`null`) is for structural ambiguity only, never for an unknown or unpriced product.**

`04-VOICE-PIPELINE.md` §3 lists "unrecognised token" among Layer 1's bail-out triggers, which could be
misread as "any product not in the catalog." Hard rule 5 (`never block billing on an unknown
product`) and Rule 5's own examples (`ajwain`, `saunf`, `kali mirch`, `chawal` — all ordinary,
catalog-real product names) rule that reading out: a product name is never itself a grammar token to
recognise, it's the remainder left over after qty/unit/price/rule-words are stripped, so it can never
by itself trigger the "unrecognised token" bail.

**Decision:** `parseUtterance` returns `null` only for genuine multi-signal ambiguity it would
otherwise have to guess through — two unclaimed numbers with no `wala`/`ka` to say which is which,
or conflicting units in one utterance. A bare or unpriced product, known or not, always returns an
item (Rule 5b: `priceType: "unknown"`, never a bail) — that is what "never block" means in code.

---

## Rev 9 — 14 Sep 2026

### D14 — Discrete-count units (`piece`/`packet`/`dozen`/...) are mutually interchangeable for a catalog default price lookup 🟢

**Made during `grammar.ts` implementation, not pre-approved like D13 — flagging for review, not presenting as settled.**

`KB-004`'s eval fixture VC019 ("2 packet oreo aur 1 monaco") expects Oreo's default price to resolve
even though the catalog stores Oreo's unit as `"piece"` while the utterance says `"packet"`. Treating
these as incompatible (the same strict logic used for `kg` vs `piece`, which correctly bails) would
make this ordinary, already-approved fixture unparseable.

**Decision:** `piece`, `packet`, `dozen`, `box`, `bottle`, `pouch`, `bag`, `can`, `tin` are treated as
mutually compatible for the purpose of reading a catalog's default price — "1 packet" and "1 piece"
both mean one retail unit of whatever the product is, regardless of which count-word the seed data
happened to store. This is **not** the same as unit *conversion* (there's no numeric factor between
"packet" and "piece" the way there is between `kg` and `gm`) — it's treating them as synonyms for "one
discrete thing," which is how a shopkeeper actually uses these words interchangeably for packaged
goods. Weight (`kg`/`gm`) and volume (`liter`/`ml`) units are explicitly **not** in this group — those
still require real SI conversion, or the lookup bails.

**Risk this doesn't cover:** if `KB-003`'s catalog seeding is ever inconsistent about which count-word
it assigns per product (e.g. one dozen-eggs product priced "per piece" by mistake), this rule would
silently paper over that inconsistency rather than catching it. Worth a spot check during `KB-005b`,
which builds the real catalog matcher this stopgap will be replaced by.

**Confirmed, 14 Sep 2026 — checked, not just asserted.** Owner asked whether any product in the
catalog is genuinely sold under two different discrete units at different prices (e.g. single
`piece` vs. a `dozen` box), which would make this decision actively wrong rather than just
approximate. Grouped all 482 products by exact `displayName`: only two names repeat at all
(`masoor daal`, `agarbatti`), and both repeats share the *same* unit on both sides — no case exists
where the same product carries two different discrete units. **D14 stands as written.**

---

## Rev 10 — 14 Sep 2026

### D15 — Learned-alias retirement is confidence-threshold-based (<=0.3), not a flat suppression count 🟢

**Unlike every decision before this one, there is no source to point to.** `08-LEARNING-ENGINE.md`
section 4 says a suppressed alias's confidence decrements and "two suppressions retire it," but gives
no decrement value, and `legacy/learning-store.js` has no confidence score, no suppression, and no
retirement logic at all to check against — confirmed by grepping the file directly during `KB-008`.
This decision is chosen, not found, and future sessions need to know that plainly.

**The math already in the doc:** confidence starts at 0.5 on first correction, +0.2 per confirmation
without edit (0.5 → 0.7 → 0.9), promoted at ≥0.8. Section 10 rule 5 says suppression should be
"symmetric with promotion" but doesn't say what that means mechanically.

**Decision:**
- Suppression decrements confidence by **-0.2** — the literal symmetric counterpart to the +0.2
  confirmation increment.
- **Retirement fires when confidence drops to or below 0.3** (symmetric with the 0.5 starting point
  and the 0.8 promotion threshold), not a separate suppression counter. The entry is removed from
  state outright when this happens — it does not linger at exactly 0.3.

**Why not a flat "two suppressions" counter (the first draft of this ticket, before the owner
corrected it):** a count independent of confidence treats every alias identically regardless of how
much evidence supports it — an alias confirmed three times (0.9) and one confirmed once (0.5) would
both retire after the same two suppressions. That isn't actually symmetric with promotion, where more
confirmations earn more trust. Under the threshold rule instead:

| Confidence before suppression | Confirmations behind it | Suppressions survived |
|---|---|---|
| 0.5 | 1 | **0** — retires on the first suppression (0.5 − 0.2 = 0.3) |
| 0.7 | 2 | 1 — retires on the second (0.7 − 0.2 − 0.2 = 0.3) |
| 0.9 | 3 | 2 — still alive at 0.5 after two suppressions |

A well-established alias is harder to dislodge than a shaky one just created — the behavior
"symmetric with promotion" should actually produce, and the reason `KB-008`'s test file has a
dedicated test proving the 0.9-survives-two / 0.5-survives-zero contrast directly, not just a
changed constant.

**Revisit when:** real suppression events accumulate during the pilot and this can be checked against
actual shopkeeper correction behavior, the same way the length-scaled matching thresholds
(`14-LEGACY-REFERENCE.md` section 6) at least came from the old code's real tuning and this doesn't.

---

## Rev 11 — 17 Sep 2026

### D16 — `domain/` import isolation is enforced by ESLint, not manual review alone 🟢

**Resolved 17 Sep 2026, same day it was opened.** Originally recorded as a decision *needed*, not yet
made — see the question below, kept verbatim for the record. Owner decided: add tooling.

`domain/` import isolation is currently enforced by discipline only, with no tooling. This was safe
in Phase 0 because `data/`, `providers/` and `ui/` were empty (`KB-101`, `KB-000` before it) — there
was nothing in them for `domain/` to accidentally import. It stops being safe the moment Phase 1 puts
real code in those folders, since a stray import would compile and pass tests while silently breaking
the one rule that keeps `domain/` testable without a database or browser (`02-ARCHITECTURE.md` §10).

Verified directly during `KB-101`, not assumed: every import in every `domain/` production file
(`catalog.ts`, `catalogIndex.ts`, `commands.ts`, `grammar.ts`, `learning.ts`, `money.ts`,
`validator.ts`, `vocabulary.ts`) is either same-directory or a same-directory JSON file. Zero imports
from `data/`, `providers/`, `ui/`, or `app/`. True today; nothing stops it from becoming false the
first time a Phase 1 ticket adds a convenience import across the boundary.

**The question, as originally put to the owner:** add a minimal ESLint config (one rule —
`no-restricted-imports` or equivalent, scoped to blocking `domain/` → `data`/`providers`/`ui`) before
`KB-102`, or rely on manual review (reading the diff, same as every ticket this session) now that the
folders are no longer empty?

**Decision: add it.** `eslint.config.js`, one rule only (`no-restricted-imports`, scoped to
`src/domain/**/*.ts`, blocking `**/data/**`/`**/providers/**`/`**/ui/**`) — no formatting rules, no
style rules, no other correctness rules. `eslint` + `@typescript-eslint/parser` (parser only, not the
full plugin — no `@typescript-eslint/eslint-plugin` rules are used). Logged per `09-WORKING-AGREEMENT.md`
§B6 as `11-STACK-DECISIONS.md` SD-020. Verified the rule actually fires before calling this done: a
temporary real `../data/*` import inside `src/domain/` was confirmed to fail `npm run lint` with the
intended message, then removed.

---

## Rev 12 — 18 Sep 2026

### D17 — The four learning tables get sync columns (`local_id`/`device_id`/`updated_at`) that `03-DATA-MODEL.md`'s per-table lists don't show 🟢

**A real contradiction between two docs, resolved by reasoning during `KB-103`, not silently patched.**

`03-DATA-MODEL.md`'s "Iron rules" (top of the document) state unconditionally: *"Every syncable row
carries `local_id`, `updated_at`, `device_id`."* But that same document's own per-table column lists
for `learned_aliases`, `provisional_products`, `price_observations`, and `learning_events` — section 5,
"Learning tables" — list none of those three columns on any of the four.

Separately, `08-LEARNING-ENGINE.md` section 8 ("When learning runs") says plainly: *"Sync | Learning
rows push like any other data."* Learning is explicitly designed to run offline-first, locally, against
IndexedDB, then sync up — the same shape as `bills`, which *does* carry all three sync columns in its
own listing.

**Decision: add `local_id` (uuid), `device_id` (text), and `updated_at` (timestamptz) to all four
learning tables** — `learned_aliases`, `provisional_products`, `price_observations`, `learning_events`.

**Why the omission is treated as incomplete, not deliberate:** the "Iron rules" section is stated
unconditionally, with no carve-out for learning tables. `08-LEARNING-ENGINE.md` independently and
explicitly confirms these rows sync like everything else. Section 5's per-table lists are shorter and
less detailed than sections 2–4's (`shops`, `shop_products`, `bills`) throughout — `bill_items`, by
contrast, genuinely has no sync columns of its own, but that is because it syncs atomically as part of
its parent `bill` (`bill_id` FK), a real structural reason the learning tables don't share: each of the
four learning tables is its own root-level syncable entity, with no parent row carrying sync state on
its behalf.

**What this doesn't change:** `bill_items` stays without independent sync columns — confirmed
intentional, not swept up by this decision. Only the four standalone learning tables gain the three
columns.

---

## Rev 13 — 20 Sep 2026

### D18 — `bills_enforce_immutability`'s cancel-transition check switched from an explicit column list to a `jsonb` row diff 🟢

**Related to `KB-103`/D17 above — a second real gap found in the same ticket's trigger work, closed
structurally rather than left as a maintenance hazard.**

The first version of `bills_enforce_immutability()` (`supabase/migrations/20260917194832_billing.sql`)
enforced "only `status` may change on cancellation" by listing every other column explicitly —
`new.id is distinct from old.id or new.shop_id is distinct from old.shop_id or ...` for all thirteen
non-status columns. The owner asked to see the actual SQL before pushing to prod and asked directly:
does this enumerate columns, and if so, what happens when a future migration adds a column to `bills`
and whoever writes it forgets to add it here?

**The honest answer was: a silent gap.** Nothing in Postgres ties a hand-written column list inside a
plpgsql function body to the table's actual schema. A future `alter table bills add column
discount_paise bigint` with no matching edit to this trigger would let that column change freely
during a cancel — exactly the class of defect this trigger exists to prevent — and every existing
test (the local dry-run, the verification script, `db diff`) would keep passing, because none of them
exercise a column that doesn't exist yet. The migration's own comment claimed the explicit list "forces"
future columns through the check "deliberately" — that language overstated what it actually guaranteed
and was corrected.

**Decision: replace the explicit list with `(to_jsonb(old) - 'status') is distinct from (to_jsonb(new)
- 'status')`.** This compares the entire row, minus `status`, as `jsonb` — any column that exists on
`bills` at execution time is automatically included, whether or not it existed when this trigger was
written. Same reasoning already applied elsewhere in this project (`07-DECISIONS.md` D16 / `SD-020`,
ESLint enforcing the `domain/` import boundary instead of relying on code review to catch a stray
import): close a gap structurally, so it can't be forgotten, rather than add a check that only fires
after the mistake already shipped.

**Why the jsonb-equality footgun doesn't apply here:** `jsonb` row comparison can be unreliable for
floating-point columns, where two numerically-equal values can serialize to different jsonb text and
compare as distinct. This is judged safe **for the `bills` table specifically**, not assumed safe for
jsonb diffs in general: every column on `bills` is `uuid`, `text`, `bigint`, `int`, or `timestamptz` —
never `float`/`real`/unconstrained `numeric` — so there is no floating-point representation ambiguity
for this comparison to trip over. Money on this table is already integer paise (`hard rule 1`), which
is exactly why this is safe. A future table with a float-typed column would need this reasoning
re-checked before reusing this pattern, not copied on the assumption it always holds.

**Re-verified after the change:** full local `supabase db reset` (all four migrations reapply cleanly,
in order) and `supabase db diff` (no drift), plus the same 13-part functional verification script
(all seven immutability scenarios) re-run and re-pasted in full in the `KB-103` handoff — not just a
diff against the prior run.

---

## Rev 14 — 20 Sep 2026

### D19 — Verifying a real auth session means calling `/auth/v1/user`, not just decoding the JWT client-side 🟢

**A verification standard, not an architecture decision — recorded so a future ticket touching real
session identity doesn't have to re-derive it.**

`KB-106`'s manual sign-in test needed to confirm that the identity RLS would see (the JWT's `sub`
claim, which is exactly what `auth.uid()` reads server-side per `KB-104`'s own investigation) was
genuinely the signed-in Google account — not just infer it from "the query didn't error," which the
owner explicitly named as the kind of assumption that had already been wrong three times this project
(`db diff`'s two independent failure modes, `KB-104`'s bootstrap-insert bug).

**Decision: when a ticket needs to prove a session's identity is real and correct, call Supabase
Auth's `/auth/v1/user` endpoint** (`Authorization: Bearer <access_token>`, `apikey: <anon key>`) and
compare its returned `id`/`email` against the JWT's own decoded `sub`/`email`. This is a genuinely
independent check, not a tautology: `/auth/v1/user` asks the Auth server to look the token up and
return what it has on record, rather than re-reading the same client-side blob a spoofed or corrupted
token could equally satisfy. Decoding the JWT alone proves the token is *well-formed*; hitting
`/auth/v1/user` proves the server itself still recognises it as a real, current session for that user.

**Where this applies again:** any future ticket that needs to confirm "this session really is who it
claims to be" before trusting an RLS-gated result — `KB-107`'s onboarding flow (confirming the
`shop_members` owner row that gets inserted actually matches the signing-in user) is the next likely
candidate.

---

## Rev 15 — 20 Sep 2026

### D20 — `shops_select` broadened to also allow `owner_user_id = auth.uid()`, not `is_shop_member(id)` alone 🟢

**A security policy change, made mid-`KB-107`, not folded in silently — same reasoning trail as any other decision here.**

**What changed:** `KB-104`'s original `shops_select` policy was `using (is_shop_member(id))` only. It
is now:
```sql
using (is_shop_member(id) or owner_user_id = auth.uid())
```

**Why:** `KB-107`'s onboarding flow needs to insert a `shops` row and its owning `shop_members` row as
two sequential steps (`KB-104`'s own smoke test proved these must happen in that order, in the same
request — see the `KB-106`/`KB-107` handoffs). If the second insert fails or the request is
interrupted between the two steps, the shop is left in a real, expected failure state: **a `shops` row
with no matching `shop_members` row.** `KB-107`'s `createShop()` needs to detect this "orphaned shop"
state on next load and resume at the membership-insert step, rather than silently creating a second,
duplicate shop. Under the original policy, that orphaned row was invisible to its own owner —
`is_shop_member(id)` is false precisely because the membership row is the thing that's missing — so
there was no way for the client to ever distinguish "no shop yet" from "shop exists, bootstrap
failed partway," and no way to resume safely at all.

**Why this doesn't weaken the security model:** `owner_user_id = auth.uid()` does not create a new way
to claim or see a shop. `shops_insert` (unchanged, `KB-104`) already requires exactly this same
condition — `owner_user_id = auth.uid()` — to create the row in the first place. This change only lets
an already-established fact (you are recorded, at insert time, as this shop's owner) also grant read
access to it. It cannot let a user see a shop they don't own: the clause is scoped to their own
`auth.uid()`, identical in shape to `shops_insert`'s own check. Verified, not assumed: `KB-105`'s
suite gained an explicit negative case for exactly this — a different user cannot see another user's
unmembered shop through this clause, only its actual owner can.

**Re-verified:** `KB-105`'s full 19-scenario suite (17 prior + 2 new: the owner-sees-own-unmembered-shop
case, and the different-user-still-blocked negative case) — 19/19, exit code 0, nothing else regressed.
Migration dry-run locally (`db reset`, all 8 migrations in order). Remote confirmation via
`supabase db dump --linked` (`KI-25`: never trust `db diff` alone for this) happens after the owner
runs `supabase db push`, per `17-MANUAL-TASKS.md` M-12 — not done as of this entry.

**Status update, 20 Sep 2026:** the owner pushed this migration and the live `shops_select` policy body
was confirmed directly against the remote (`CREATE POLICY "shops_select" ... USING (("public".
"is_shop_member"("id") OR ("owner_user_id" = "auth"."uid"())))`) — the exact broadened clause, not
just similar text elsewhere in the dump. This note corrects the "not done as of this entry" line
above rather than editing it, per this log's own append-only convention.

---

## Rev 16 — 20 Sep 2026

### D21 — Three real `KB-110` bugs a mocked test suite could not have caught, closed only by testing against the real local stack 🟢

**Not a single decision — a record of why "the mocked suite passes" was never treated as sufficient
proof for sync logic touching a real database, and what that discipline actually found.**

`KB-110`'s sync worker shipped with 21 passing mocked tests before any of what follows was found.
Every one of these three bugs is invisible to a hand-rolled mock, because a mock has no concept of a
real RLS policy set or a real `NOT NULL` constraint — it only enforces whatever the test author
thought to assert.

**1. Append-only retry bug.** `price_observations` and `learning_events` have `select`+`insert` RLS
policies only — confirmed by grepping `supabase/migrations/20260920095526_rls.sql` directly, not from
memory. `.upsert()` issues `INSERT ... ON CONFLICT DO UPDATE`; retrying an insert whose *request*
succeeded but whose *response* was lost hits the `DO UPDATE` branch on the now-existing row, which RLS
rejects outright (no update policy exists at all) — a correctly-synced row got permanently mislabeled
`conflict`. Fixed with `insertAppendOnly()`: a plain `.insert()`, treating a `23505` unique-violation as
success (re-fetches the existing row's real server id), routed around `isPermanentError()` entirely
rather than through it.

**2. Silent zero-row update bug.** `pushShop`/`pushReceiptNumberBlocks` used a plain `.update()` with no
verification a row was actually affected. `KB-105` already proved RLS `UPDATE`/`DELETE` is a silent
zero-row filter, not a raised error, for exactly this shape of statement — the same finding that shaped
the `bill_items` delete test earlier in this ticket chain. Fixed by adding `.select("id")` (returning an
array, not `.single()`, which would itself throw a non-SQLSTATE `PGRST116` on zero rows and get
misclassified as transient) and checking `data.length === 0` as its own explicit case.

**3. The `device_id` omission — found only by the real local-stack test, the strongest evidence yet in
this project for why a mocked suite is never sufficient proof against a real schema.** None of the four
learning-table push functions sent `device_id`, and it is a `NOT NULL` column on every one of them
(confirmed directly against `supabase/migrations/20260917194838_learning.sql`). Every real push would
have failed on the very first attempt with `23502 null value in column "device_id"` — a **more
fundamental failure than either bug above**, since it would have blocked the very first real sync
before the unique-constraint question or the retry-semantics question ever had a chance to matter. The
21-test mocked suite passed the entire time this bug existed, because nothing in a hand-rolled fake
client's `{ data, error }` responses knows what a real Postgres `NOT NULL` constraint requires. Found on
the very first run of a real end-to-end test (`fake-indexeddb` for the local side; a real signed-in
Supabase Auth user, real RLS, the real local Docker Postgres for the remote side) that pushed a real
bill, a real `price_observation`, and a real `learning_event`, then retried each and ran `syncNow()`
twice in a row to confirm idempotency as an actual end state (exactly 1 row server-side, not "didn't
throw a second time").

**Standing takeaway, not just a closed bug:** for any ticket that pushes or pulls against real Postgres
tables — RLS-protected, constrained, triggered — a mocked test suite proves the *orchestration logic*
correct, never the *real schema interaction*. Both are required before calling that logic done; neither
substitutes for the other. `KB-105`'s automated suite exists for exactly the RLS half of this; `KB-110`
is the first ticket to need the equivalent for real push/pull mechanics, and it will not be the last.

---

## Rev 17 — 20 Sep 2026

### D22 — Receipt block reservation: plain SELECT-then-INSERT, not an atomic RPC 🟡

**A deliberate MVP simplification, not an oversight — logged with an explicit revisit trigger, per the
same standard as `KB-110`'s accepted `bill_items` non-atomicity.**

`KB-111`'s block reservation (`reserveBlock()`) computes `max(block_end)` for a shop and inserts the next
50-number range as a plain two-step client operation — no `security definer` RPC, no row locking.

**The real race window, named explicitly, not just gestured at:** two devices reserving a block for the
same shop within the same query round-trip could both read the same `max(block_end)` and insert
overlapping ranges, each believing it owns numbers the other device also believes it owns.

**Why accepted for MVP:** Offline Level 4 (multi-device concurrent use) is explicitly out of scope —
`02-ARCHITECTURE.md` §3 states one device per shop. The race requires two devices reserving
*simultaneously*, which the product doesn't support happening at all yet.

**Revisit trigger, stated explicitly:** before any multi-device support ships — not discovered via a
real duplicate-receipt-number collision during the pilot. Whoever picks up multi-device support must
either wrap reservation in a `security definer` RPC using `select ... for update` (or an equivalent
serializing mechanism) or confirm some other reason the race can't manifest under that ticket's design,
before shipping it.

### D23 — Fallback receipt number format: full device UUID, not a truncated prefix 🟢

**Rejected a shorter, prettier format after computing the actual collision risk, not assuming a short
prefix was "probably fine."**

A 6-hex-character truncated device-id prefix (`{prefix}-{6 chars}-{n}`) has a birthday-paradox collision
probability of roughly 1-in-1.7-million for 5 device installations a single shop might accumulate over
its lifetime, 1-in-373,000 for 10. In isolation, low. **Rejected anyway**, because the fallback counter
`n` is device-local and starts fresh each time a device enters exhaustion mode — a prefix collision
between two devices doesn't create a small *chance* of a duplicate number, it creates a **near-certain**
one on the very first fallback number either device generates, since the two `n` sequences aren't
independent once the prefixes match. The birthday-paradox number describes the odds of the *setup*, not
the odds of the actual collision that follows it.

**Decision: use the full device UUID** — `{shop.receiptPrefix}-{full deviceId}-{n}`. Uglier
(`KB-550e8400-e29b-41d4-a716-446655440000-1`), but this is already the abnormal, explicitly-flagged
edge-case path (`receipt_number_source = 'fallback'`, D24 below) — not a string a customer is meant to
find elegant. Two random v4 UUIDs colliding is ~1-in-5×10³⁷: cryptographically negligible, not merely
statistically low, and removes the compounding-collision structure entirely.

### D24 — `bills.receipt_number_source`: a permanent bookkeeping label, never a trigger for renumbering 🟢

**Also inferred, flagged as such:** the receipt-number string format itself (`{prefix}-{number, zero-
padded to 6 digits}`, e.g. `KB-000142`) is read off a single mockup in `05-FRONTEND-SPEC.md` — no doc
states the padding width as a rule. If a future ticket finds conflicting evidence, this is the decision
that assumed it.

**The column's purpose, stated explicitly because the word "reconcile" in `02-ARCHITECTURE.md` §4 step 5
easily misreads as "fix the number":** `receipt_number_source` (`'block' | 'fallback'`) is a **permanent
bookkeeping label**, set once at bill creation and never changed again. Per §4 step 3 — *"the number
shown to the customer never changes after sync"* — a fallback-numbered bill's receipt number is never
replaced, renumbered, or touched once assigned; it stays exactly as printed on the physical receipt
forever. "Reconcile on sync and flag it" means the shop owner can eventually *see* that a bill used the
offline-exhaustion path (surfaced in whichever ticket builds S5/S6 — deliberately not decided here, same
scope discipline as `KB-109`'s item-search cut) — never that the system corrects or reissues the number.
Stated explicitly in the migration's own comment, not just here, so a future ticket touching this column
doesn't build renumbering logic against the letter of "reconcile" rather than its actual, narrower
meaning.

## Rev 18 — 20 Sep 2026

### D25 — Groq Whisper's real response contains no usable confidence score 🟢

**Verified against the live Groq API (`KB-204`), not assumed** — `TranscriptionProvider`'s
`confidence?` field was left optional in `02-ARCHITECTURE.md`'s original interface design, before
anyone had checked what Groq's endpoint actually returns. Now checked:

- Default (`response_format` omitted, i.e. `json`): the response body is `{ text, x_groq }` only.
  **No confidence field of any kind.**
- `response_format: "verbose_json"`: adds `segments[]`, each with `avg_logprob`, `no_speech_prob`,
  `compression_ratio` — log-probability and voice-activity internals, **not a 0–1 confidence score**.
  Turning `avg_logprob` into something comparable to a confidence would require inventing a mapping
  (e.g. some `exp(avg_logprob)` heuristic) that no doc specifies and no real speech data has validated.

**Decision: `groqTranscriptionProvider.ts` never populates `confidence`.** The field stays permanently
optional and permanently unset for this provider — this is not a gap to close later, it's the real
shape of the upstream API. If a future provider (or a different Groq response mode) genuinely offers a
usable confidence score, wire it in then; don't manufacture one now to fill an optional field.

Real request/response observed during verification (English TTS input "Two kilos of rice, thirty
rupees."):
```
200 OK, ~360-800ms — {"text":" 2 kilos of rice, 30 rupees", ...}
401 on a bad key — {"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}
```
The 401 shape is real and clean enough to classify as a permanent error whenever `KB-206` builds
retry/error handling for the `/voice` endpoint.

## Rev 19 — 20 Sep 2026

### D26 — Gemini's explicit context caching is not usable at the pricing-grammar prompt's real size 🟢

**Verified against the live API (`KB-205`), correcting `04-VOICE-PIPELINE.md` §4's own stated
assumption, not just noted in passing.** That section specified: *"Cache the static grammar block; it
is byte-identical on every call and ~43% of the prompt."* Attempting this for real, with the actual
prompt text `src/voice/pricingGrammarPrompt.ts` sends:

```
POST /v1beta/cachedContents
400 Bad Request
{"error":{"code":400,"message":"Cached content is too small. total_token_count=1233, min_total_token_count=2048","status":"INVALID_ARGUMENT"}}
```

The grammar prompt (3,622 characters) tokenizes to 1,233 tokens — Gemini's explicit caching floor is
2,048. **This is not a bug to fix by writing a longer prompt** — padding the prompt just to clear an
arbitrary token floor would be optimizing for the cache mechanism instead of correctness, exactly the
kind of inversion this project's rules exist to prevent. `04-VOICE-PIPELINE.md` §4 is corrected in
place to reflect this as a real, current fact, not a design intent.

**Open, explicitly not resolved here:** `04-VOICE-PIPELINE.md` §9's cost model (`Layer 2 fallback ~₹0.043/utterance`) needs to be checked against whether it assumed the ~43% cached-prompt saving or already
priced the prompt in full — unverified either way as of this entry. **Assigned to `KB-206`'s plan**,
since that ticket is what actually calls this provider in a real cost-bearing path for the first time.

### D27 — LLM parsing model pricing snapshot: `gemini-2.5-flash-lite` confirmed cheapest, dated explicitly 🟢

**Why this needs a dated entry, not just a code comment:** `11-STACK-DECISIONS.md` SD-006 already
flagged that Gemini 2.5 Flash-Lite has a published retirement date and that "the successor's pricing"
needed real verification, not an assumed model string. Provider pricing is exactly the kind of fact
that goes stale silently — a future session reading `GEMINI_MODEL = "gemini-2.5-flash-lite"` in
`geminiParseProvider.ts` has no way to know whether that was chosen yesterday or a year ago, or whether
it's still the right choice.

**Checked for real, 20 Sep 2026:** `ListModels` confirms `gemini-2.5-flash-lite` is still live, alongside
two newer generations already in production, `gemini-3.1-flash-lite` and `gemini-3.5-flash-lite`. Real
pricing from `ai.google.dev/gemini-api/docs/pricing`, per 1M tokens:

| Model | Input | Output |
|---|---|---|
| gemini-2.5-flash-lite | $0.10 | $0.40 |
| gemini-3.1-flash-lite | $0.25 | $1.50 |
| gemini-3.5-flash-lite | $0.30 | $2.50 |

**Decision: `gemini-2.5-flash-lite` stands.** It remains the cheapest by a wide margin (2.5–6x below the
newer generations), and `04-VOICE-PIPELINE.md` §9's cost model was computed against its pricing — moving
to a newer generation now would silently invalidate that cost model for no stated benefit. **Revisit
trigger:** before this model's actual retirement date, or if a future ticket needs capability the 2.5
generation lacks — check `ai.google.dev` again then, don't assume this table still holds.

---

## Rev 20 — 26 Sep 2026

**Recorded retroactively.** D28–D31 were real calls made on the dates given, recorded until now only
in `10-TRACKER.md` rows and ticket handoffs, never here. D32 is a standing rule that emerged from
`KB-206`. Written up during the 26 Sep docs housekeeping pass so a future session finds them where it
looks for decisions.

### D28 — Build tool: Antigravity → **Claude Code** 🟢

**Supersedes:** T1 (18 Aug 2026, "Antigravity, single tool through MVP"). **Decided:** 21 Aug 2026,
by the owner — `10-TRACKER.md` Recent changes, 21 Aug: Antigravity's quota ran out mid-`KB-000`.

Claude Code has been the build agent for every ticket since. `CLAUDE.md` (auto-loaded) plus
`18-AGENT-CONTRACT.md` are its operating rules. The handoff cost zero — the new tool picked the project
up from the docs, which is the property T1's own "exit cost: zero" claim (`11-STACK-DECISIONS.md`
SD-015) depended on. Matching stack entry: `SD-025`, superseding SD-015. T1's rationale for an *IDE*
over a cloud agent ("seeing every file change matters more than agent throughput") is preserved in
practice by the PLAN → approval → small-diff flow, not by the tool itself.

### D29 — Git: **single branch, all work on `main`** 🟢

**Supersedes:** `09-WORKING-AGREEMENT.md` §B4's original feature-branch rule ("never commit to `main`
directly"). **Decided:** 20 Aug 2026, by the owner — `10-TRACKER.md` Recent changes, 20 Aug: "Branch
workflow dropped — solo dev works on `main`, committing after each working step."

Never create or check out another branch; commit to `main` after each verified step. The ticket ID in
the commit message carries what a branch name used to. Binding statement: `CLAUDE.md` "Git". §B4 and
`10-TRACKER.md` ("then ticket branches") contradicted this until 26 Sep 2026 and were aligned then.
Related gotcha: a Claude Code session once launched in an isolated worktree, which breaks this rule —
`12-PARKED.md` NI-20.

### D30 — Layer 3 review flags: flag-only for unit/qty problems; `unusual_total` on computed totals only 🟢

**Decided:** 22 Sep 2026, by the owner, during `KB-208` (`src/domain/reviewFlags.ts`).

1. **`invalid_qty`, `invalid_unit`, `unit_mismatch` are flag-only, severity MEDIUM, and never
   substitute a value.** `legacy/validator.js` silently replaced a bad value with a plausible one
   (qty → 1, unit → a fallback) when these fired — a direct conflict with hard rule 7 ("never
   auto-change a price or unit — suggest only"). The severity follows from that behavior decision, not
   the other way round. `reviewFlags.ts` only ever reads items and produces flags; it never mutates a
   `ParsedItem`.
2. **`unusual_total` applies only to a *computed* total** — `priceType` `"default"` or `"rate"` —
   **never to `"total"`**, a spoken `ka`/`ki` override. A spoken total is a deliberate shopkeeper
   statement (Rule 2, the differentiator). The first implementation HIGH-flagged `"5 kg chawal 30 ka"`
   itself; the real-data check over all 125 eval fixtures caught it before commit.

### D31 — `resetLearning()` is **local-only**, and says so in its type 🟢

**Decided:** 22 Sep 2026, by the owner, during `KB-210` (`src/data/learningAudit.ts`).

`resetLearning()` clears a shop's `learnedAliases` / `provisionalProducts` / `priceObservations` in
IndexedDB only. Matching server rows are **not** deleted: `KB-110`'s sync worker has no generalized
delete propagation, and building it as a side effect of a settings action would be scope creep. The
limitation is structural, not a comment — the result type's `remoteDeletionNotPerformed` is the
literal `true`, never `boolean`, plus a warning string, so no caller can write a success path that
drops the caveat. `learningEvents` is **not** cleared (`08-LEARNING-ENGINE.md` §10 rule 6 applies to
the reset itself); a `learning_reset` event recording the cleared counts is appended instead. Open
consequence and close triggers: `12-PARKED.md` NI-27 — `KB-312`'s Developer Mode screen must surface
the warning.

### D32 — Real-verification scripts call the **shipped code path**, never a parallel request 🟢

**Standing rule**, from `KB-206` (22 Sep 2026); companion to D21.

`KB-204`'s real verification against Groq passed while the shipped `groqTranscriptionProvider.ts` was
broken (`KI-28`: every upload named `"audio"` with no extension, which Groq rejects) — the script
built its own request with a hardcoded `"audio.wav"` instead of calling `transcribe()`. `KB-206`'s
end-to-end script called the real function and caught it.

**Rule:** a script that claims real-infrastructure verification must invoke the actual shipped
function or endpoint, not re-implement its request construction against the same external API. A
real-infrastructure test only proves what it actually exercises. D21 says mocked suites never prove
real schema interaction; D32 says a hand-rolled "real" call doesn't prove the shipped code either.

---

## Rev 21 — 26 Sep 2026

### D33 — Model policy: the most capable model for money, number-safety, RLS, sync and migrations 🟢

**Restored, owner decision 26 Sep 2026.** Money, number-safety, RLS, sync-worker and migration work
always uses the most capable model available; lighter models only for mechanical work (scaffolding,
renames, doc formatting).

Originally the tracker's "Model policy" line (Antigravity era: "Flash for scaffolding and mechanical
work; thinking-tier (Opus/Sonnet) for `KB-005`, `KB-005b`, RLS and the sync worker — those are where an
invisible mistake costs months"). It lived only in `10-TRACKER.md` "Right now", never in this log or
`CLAUDE.md`, and was dropped unintentionally in `5b8e11c` when that section was rewritten for Phase 3 —
restored here, updated for Claude Code, so it no longer depends on a section that gets rewritten every
phase. The four areas are the same ones `18-AGENT-CONTRACT.md` §4 stop condition 10 names ("money, RLS,
sync, or the pricing grammar"), plus migrations. Referenced from `CLAUDE.md`.

### D34 — Push to `origin main` after a ticket closes 🟢

**Owner decision 26 Sep 2026; extends D29 (single branch, `main`), does not supersede it.** After a
ticket is closed and its commits verified, push them: `git push origin main`. **Amended 3 Oct 2026 (D55):** keep pushing
after each verified step — a push no longer deploys to production unless the latest commit message carries the deploy
marker `[deploy]`, which only the owner approves. Kept as its own entry
rather than folded into D33 because it is a Git-workflow rule, not a model rule — it belongs next to
D29, where a future session looking for Git rules will find it.

**Why:** until 26 Sep 2026 no document said when to push. `CLAUDE.md` said "commit directly to `main`"
and nothing more, so a full housekeeping pass (four commits) sat only on one laptop until the owner
noticed — a machine failure in that window would have lost it. Binding statement: `CLAUDE.md` "Git".
Pushing is an outward-facing action, so it happens once the ticket's commits are verified, not
mid-ticket.

---

## Rev 22 — 26 Sep 2026

### D35 — The 16 ms lookup budget is a steady-state requirement, and perf tests run alone 🟢

**Owner decision, 26 Sep 2026, `KB-005e`. Closes `12-PARKED.md` KI-23.** Two parts, one goal: the
perf test measures the real requirement, reliably.

**1. The 16 ms budget (`18-AGENT-CONTRACT.md` §8, `KB-005b`) is a steady-state requirement.** 16 ms is
one frame — the budget for *continuous* interaction (type-ahead, one lookup per keystroke), where the
lookup is warm. `src/domain/catalogIndex.perf.test.ts` therefore runs **10 untimed warm-up rounds** (each
one lookup of all five queries — 50 lookups) before timing exactly as before (5 runs per query,
averaged, budget unchanged). **N = 10 was chosen before verification:** the 26 Sep diagnostic showed the
heaviest queries settling after ~16–20 prior mixed lookups (`besan 500 gram` 4th after a `chawal`
warm-up; `chawal` 5th in reversed order, with one 13.49 ms run even after 20), and JIT tier-up timing
varies with load — so 2.5× the observed threshold. If the test fails in isolation again, KI-23 reopens;
N is not tuned to make it pass.

**The cold first lookup is not asserted; its cost is accepted.** Observed on 26 Sep 2026, across all
isolated runs, the first query's timing ranged **9.47–24.41 ms**, plus **62.74 ms** in one run under
contention (immediately after a stuck process cleanup). It is paid once per session, not per keystroke.
Cold timing is also the most load-sensitive measurement there is — it is what produced KI-23's entire
history of intermittent failures, on a lookup that had not regressed (warm `chawal` ≈ 10 ms, matching
the historical isolated figure).

**2. Perf tests run outside the parallel pool.** `vite.config.ts` defines two Vitest projects: `unit`
(every test file except `*.perf.test.ts`, parallel as before) and `perf` (`*.perf.test.ts` only).
`sequence.groupOrder` runs `unit` first and `perf` after it, alone — one `npm test` command, no
`package.json` change, no new dependency. Groups are awaited in turn and failures are reported, not
thrown, so `perf` still runs when `unit` fails (verified with a deliberate failing test). **Evidence:**
the 26 Sep VERIFY with warm-up but still inside the parallel run — full-suite warmed numbers were ~2×
isolated (`toor daal` ~10.6 vs ~5.5 ms; `chawal` 11.60–20.65 vs 5.85–10.53 ms), 1 of 3 runs failed.
After the split: `npm test` 5/5 passed.

**What this does not prove:** the budget on a real low-end Android phone — only on a dev laptop.
`12-PARKED.md` NI-28, trigger `KB-305`. And a deliberate heavy-load run (full suite during
`supabase db reset`) still failed once at 17.02 ms (`besan 500 gram`); by the agreed rule, recorded
in KI-23, not a reopen.

---

## Rev 23 — 26 Sep 2026

### D36 — A line keeps its spoken qty and unit; the rate carries its own unit; cross-unit totals are exact 🟢

**Owner decision, 26 Sep 2026, `KB-005f`. Closes `12-PARKED.md` KI-30.**

**A line keeps qty and unit exactly as spoken. A line's rate carries its own unit (`ParsedItem.rateUnit`).
Totals across gm/kg and ml/liter are computed exactly** — qty × rate, shifted by 1000, rounded half-up ONCE
at the line (D11) — never via a per-gram rate rounded to whole paise, and never with a division.
"500 gram chini" → qty 500, unit "gm", rate 4500, rateUnit "kg", total 2250 (₹22.50). The old code rounded
4500 paise/kg to "5 paise/gm" and billed ₹25 — silently, for 32 of 123 kg/liter products, in both
directions ("500 gram maida" under-billed ₹20 vs ₹21).

**Why this and not normalising the line to the catalog unit (the owner's first decision the same day,
reversed after a real check):** normalising "500 gram chini" to 0.5 kg hides the spoken number from the
line — a real `evaluateReviewFlags` run on the normalised item fired `number_dropped` and `qty_dropped`,
both HIGH, on every such line; it fights the number-safety gate's purpose (the shopkeeper sees their own
number); it would have needed a hard-rule-7 reading ("is re-expressing a unit auto-changing it?"); and it
contradicts the Layer 2 prompt, which reports the spoken unit. Keeping the spoken qty and giving the rate
its own unit has none of these. **No hard-rule-7 reinterpretation is involved:** nothing is converted or
substituted — the qty is what was said, the rate is the catalog price exactly as stored.

**Mechanics:** `grammar.ts`'s `unitScale()` decides the power of ten between the qty's unit and the rate's
unit (0, +3, -3, or null = incompatible → bail); `money.ts`'s `lineTotalPaiseScaled()` does the arithmetic
with string-slice half-up rounding at 10^3 or 10^6. `convertPriceBetweenUnits()`/`convertCatalogRate()`
(which divided) are deleted. `reviewFlags.ts` compares a rate against the shop price by scaling the finer
unit's price UP by 1000 and computes the expected total with the same `lineTotalPaiseScaled()`.
`src/domain/no-division.test.ts` (TypeScript AST scan) fails on any `/` in `money.ts`, `grammar.ts` or
`reviewFlags.ts`.

**`rateUnit` is required on `ParsedItem`** (`string | null`, null exactly when `rate` is null) — never an
implicit "same as unit": every place that builds a line must state the rate's basis. A spoken `wala` rate is
read literally, per the spoken unit ("500 gram jeera 600 wala" stays 600/gm, ₹3,00,000, HIGH-flagged —
KI-35). Layer 2's rate unit is Gemini's own claim and untrusted (KI-34).

**Out of scope, decided separately:** how the rate and its unit are *displayed* (KB-303 / KB-308); persisting
`rate_unit` (a `bill_items` column, a `LocalBillItem` field, the push mapping) is `KB-110b`'s — nothing
writes `bill_items` yet (KI-32).

---

## Rev 24 — 27 Sep 2026

### D37 — Bills push through one atomic, idempotent SECURITY INVOKER function; drafts stay local 🟢

**Owner decisions, 26–27 Sep 2026, `KB-110b`. Closes `12-PARKED.md` KI-29 and KI-31.** Migration `supabase/migrations/20260927090000_push_bill.sql`.

**1. `push_bill(p_bill jsonb, p_items jsonb) returns uuid`** — one RPC per bill. PostgREST runs it in one
transaction: it inserts the bill as **draft**, inserts every item, then sets it **final** (and **cancelled**
if that's the target), so `bill_items_immutability` never sees an item added to a final bill — the KI-29 bug,
where the old client upserted the bill as final first and every item insert was rejected. **SECURITY
INVOKER, never DEFINER:** every statement runs as the caller under the existing `bills`/`bill_items` RLS
(hard rule 4). `shop_id` and `bill_id` on items come from the function, never from the payload. Execute is
revoked from `public`/`anon`, granted to `authenticated`. Chosen over client-side ordering (draft upsert →
items → final update) because that is 3+ requests, non-atomic, and needs its own "already final?" round
trip. This also removes KB-110's documented "delete then reinsert items isn't atomic" window.

**2. "Already done" (idempotent retry):** the bill already exists for `(shop_id, local_id)` AND every
immutable bill field (`receipt_number`, `receipt_number_source`, `customer_name`, `customer_mobile`,
`subtotal_paise`, `total_paise`, `schema_version`, `device_id`) and the full item set (all content columns,
compared with `EXCEPT` both ways plus a count) are identical. Same status → return the existing id (no-op
success). `final` → `cancelled` → apply the cancel (only `status` changes, so `bills_immutability`'s D18 jsonb
diff passes). **Anything else → `KB409`** → the device marks the bill `conflict` and logs both versions; local
data is never discarded. Every comparison is `IS NOT DISTINCT FROM` and the caller tests `IS NOT TRUE`: a
missing/null payload field is a **mismatch, never NULL** — an AND-chain of `=` would return NULL, `if not NULL`
does not raise, and a divergent retry would silently succeed (owner's review; real-stack tests for an omitted
`receipt_number_source` and a null `total_paise` → KB409). A concurrent push of the same bill is absorbed
inside the function (`unique_violation` → re-read → compare); `syncNow()` also joins an in-flight run instead
of starting a second one.

**3. Only `final` and `cancelled` bills are pushed; drafts stay on the device.** `bills.receipt_number` is
NOT NULL and a draft has no receipt number yet (assigned at finalise, `16-APP-FLOW.md` §4); no doc requires
draft sync — a draft survives in IndexedDB (`16-APP-FLOW.md` §6). `push_bill` rejects any other status with
`KB400`.

**4. `LocalBill.localId` must be a UUID.** `bills.local_id` is `uuid` and `push_bill` casts it — anything else
is a permanent `22P02` conflict. `KB-307` generates it with `crypto.randomUUID()`; the e2e test uses real
UUIDs.

**5. Error classification (`sync.ts` `isPermanentError`, shared by every push function).** PERMANENT →
`conflict`: 42501, P0001, every 23xxx, every 22xxx, KB400, KB409. TRANSIENT → retry with backoff: no code
(network), 40P01, 40001, 57014, 08xxx, 53xxx, 55P03, PGRST*, and **any unknown code** (logged) — a retrying
bill is recoverable, a false `conflict` is not. Replaces `code.length === 5`, which made deadlocks,
serialization failures and timeouts permanent. **23503 is permanent because every `shop_product` is
server-originated today** (pulled, never created locally). When `KB-311`/`KB-314` let a device create
`shop_products`, a bill could push before its product exists — **revisit push order / 23503 then. Trigger:
`KB-311`.**

**6. Schema.** `bill_items.rate_unit` (D36) with `check ((rate_paise is null) = (rate_unit is null))` and **no
unit-vocabulary check** (units are free text; a value list would make valid custom-unit lines permanent
23514 conflicts — KI-16). Backfilled `rate_unit = unit` where `rate_paise` is set, with
`bill_items_immutability` disabled only for that statement inside one `DO` block (it can't be left off),
proven against a seeded final + cancelled bill. **Same-shop integrity:** `unique (id, shop_id)` on `bills` +
composite FK `bill_items (bill_id, shop_id) → bills (id, shop_id)` — before it, a shop-B user could attach an
item to a shop-A bill (RLS checked only the item's own shop; the immutability trigger reads the parent
through RLS and saw nothing) — proven by `test:rls` failing before the migration, passing after. **The plain
`bill_items_bill_id_fkey` was dropped:** redundant (both columns NOT NULL, so the composite FK enforces
everything it did) and *not* harmless — with both present PostgREST found two `bills`↔`bill_items`
relationships and rejected every embed ("Could not embed because more than one relationship was found"),
found by the first real e2e run, not by any mocked test. Local data: Dexie version 2 adds
`LocalBill.receiptNumberSource` and `LocalBillItem.rateUnit` with a defined upgrade.

**Verification standard added:** `npm run test:e2e` (a Vitest project on the real local Docker stack, calling
the shipped code — D21, D32) is required for any sync or schema ticket; `npm test` runs unit + perf only and
never needs Docker.

---

## Rev 25 — 27 Sep 2026

### D38 — Runtime bootstrap: per-user local DB, persistent device id, offline sessions, never sync without a real session 🟢

**Owner decisions, 27 Sep 2026, `KB-315`. Closes `12-PARKED.md` KI-32.**

**1. One local database per signed-in user — `kiranabill-<userId>`.** Sign-out stops the sync loop and closes
it; **nothing is deleted**. The same user signing back in continues, unsynced bills included; another user on
the same device gets a separate, empty database, so no shop's cached data is ever shown to another account.
**The old single `kiranabill` IndexedDB is abandoned, not deleted** — nothing of value was ever written to it
(no bills: KI-32), and an automatic delete is an irreversible action for no gain.

**2. A persistent device id in its own database, `kiranabill-device`** (per installation, not per user):
created once with `crypto.randomUUID()` inside one transaction (two tabs can't mint two), and used everywhere a
`device_id` is written — `copy_base_catalog`, receipt blocks, bills, learning rows, the fallback receipt number
(D23). The throwaway `crypto.randomUUID()` in `OnboardingScreen` is gone. **If IndexedDB is wiped**, the next
start mints a new id: unsynced local rows are lost (unrecoverable); the old install's unused receipt numbers
are skipped, never reused; fallback numbers embed the new UUID.

**3. Receipt blocks belong to the device that reserved them.** `pullReceiptNumberBlocks` pulls only this
device's blocks and `consumeNextNumber` only numbers from them — both used to take any block of the shop, so a
wiped device could pull its old block back and reissue numbers the old install had used offline and never
pushed. The first block is reserved at onboarding (`16-APP-FLOW.md` §2) and again on any online start with no
usable block.

**4. Offline session.** `@supabase/auth-js` returns `session: null` + a retryable error when an expired access
token (~1 h) can't be refreshed because the network is down — keeping the stored session (proven against the
real library, `bootstrap.e2e.test.ts` case 4). The device remembers the last user who signed in with a real
session (`activeUserId`); that case becomes an **offline session** for them, running from their local database.
A non-retryable failure (a rejected refresh token) or no remembered user → sign-in screen. An explicit sign-out
forgets `activeUserId`. **Offline-session mode can run indefinitely on the last sign-in. Nothing reaches the
server until a real session exists.**

**5. Never sync without a real session.** `syncNow()` checks `auth.getSession()` first; no live session → the
whole cycle is skipped, everything stays pending, and it reports transient (the loop backs off). Without this,
an offline session reconnecting with a rejected refresh token would sync as `anon`: `push_bill` → 42501 → every
offline-created bill a permanent conflict. With it, a real 42501 only ever means a real RLS rejection. Proven:
offline session → rejected refresh on reconnect → nothing pushed, all pending, none in conflict → sign in again
→ pushed (`bootstrap.e2e.test.ts` case 7).

**6. The sync loop** starts once a shop is active and stops on sign-out; start is idempotent and stop removes
the `online` listener (it used to leak). The `shop_products` pull cursor is per shop. **Sign-out with unsynced
rows: the UI must warn with the count of unsynced bills** (KB-312 / KB-313; `16-APP-FLOW.md` "Sign-out") — not
built here. Multiple open tabs each run a loop — safe today, not solved (`12-PARKED.md` KI-39).

### D39 — UI verification standard: real parser output in tests, owner's real-browser check before close 🟢

**Owner decision, 27 Sep 2026, `KB-301`.** Applies to every UI ticket from `KB-301` on.

**Amended 3 Oct 2026 (owner, `KB-307` commit 2) — the agent's own real-browser check comes first.** Every UI ticket gets a real-browser check **by the agent in the preview browser before the owner's check** (sign in with a throwaway local dev account; 375 px and desktop; for focus / scroll / keyboard behaviour check `document.activeElement`, that the element is scrolled into view, and that a focus ring is visible). jsdom-only verification is not enough for UI behaviour — Bill Banao's "focus the first pending item" passed in jsdom and did nothing visible in real Chrome.

**1. Component tests render real `parseUtterance()` output** from `eval/voice-cases.json` or
`eval/number-benchmark.json`, **never hand-built bills.** A hand-built `ParsedItem` can hold a combination
the parser never produces (and miss one it does — `VC015` "Surf Excel ek packet" really parses as qty 1
*packet* at ₹60 per *piece*, which is what the rate-unit display rule had to handle). Where a fixture carries
expected numbers (`number-benchmark.json`), assert against them. Where no fixture can produce a case yet, test
the pure formatting helper instead and say which later ticket adds the full-bill test (`KB-301`: the unpriced
"—" amount → `KB-305`).

**2. No UI ticket closes before the owner's real-browser check** at 375px and desktop width, with screenshots
reviewed. The agent supplies the checklist; `npm run dev` against the **local** Supabase stack (dev-only email
sign-in, `src/ui/DevEmailSignIn.tsx` — the local stack has no Google provider; never point dev at the remote
project to work around it). Dev-only aids (`?try=<utterance>`, the email form) must be proven absent from
`npm run build` output by grepping `dist/`.

Recorded in `09-WORKING-AGREEMENT.md` §B5 (the UI row).

### D40 — Every TypeScript file is type-checked by `tsc -b` and linted; `npx tsc --noEmit` retired 🟢

**Owner decision, 27 Sep 2026, `KB-316`. Closes `12-PARKED.md` KI-36.**

**1. Type-check = `tsc -b` over a solution `tsconfig.json`** that references five projects: `tsconfig.app.json`
(`src/`, the old root config verbatim), `tsconfig.node.json` (`vite.config.ts`), `netlify/tsconfig.json`
(production code — the same strictness as `src/`), `eval/tsconfig.json` and `scripts/tsconfig.json` (their
existing, looser options, unchanged). `npm run typecheck` and `npm run build` (what Netlify runs) both use it, so
a type error anywhere — including `netlify/functions` — fails the deploy. **`npx tsc --noEmit` is retired:** on a
solution config (`"files": []`) it checks nothing and exits 0 (tested, TS 5.9.3). Build-info files live in
`node_modules/.tmp/`.

**2. The root `tsconfig.json` keeps `baseUrl` + `paths`** even though `tsc -b` ignores them there: Netlify's
function bundler resolves `src/voice`'s `@/` imports from the nearest `tsconfig.json`. Dropping them would break
the deployed `/voice` function while every local check still passed.

**3. Lint covers every TS file** (`src/`, `netlify/`, `eval/`, `scripts/`, `vite.config.ts`) with the domain
import boundary (D16) plus five ESLint core correctness rules — `no-debugger`, `no-unreachable`, `no-dupe-keys`,
`no-dupe-else-if`, `no-self-assign`. No new dependency, no style rules. A TypeScript-aware rule set is
`12-PARKED.md` SG-10.

### D41 — Voice round trips: transcript first; on a Layer 1 miss, a text-only parse — with guardrails 🟢

**Owner decision, 27 Sep 2026, `KB-302` (Q1).** `02-ARCHITECTURE.md` §5 said "one HTTP round trip" and "Layer
1 first" at once; the built `/voice` couldn't do both (the client has no transcript until `/voice` answers,
and `/voice` always needed audio). Now: call 1 sends audio → transcript (shown at once); Layer 1 runs on the
client; only on a miss, call 2 sends the **transcript** (no audio) + the catalog slice → parse only. One
round trip on a hit, Groq billed once, and the parsed text is exactly the text on screen.

Rejected: always parse (Gemini billed every utterance, and the transcript can't show before items);
re-upload the audio on a miss (Groq billed twice; a second transcript may differ).

**Guardrails — `/voice` must not become a free Gemini proxy** (each tested): a request is audio **or** a
transcript, never both; transcript 1–600 characters (the vocabulary cap, 04 §2); slice ≤ 30 entries (04 §4),
rebuilt server-side from only the four fields the prompt uses (`id` ≤ 64, `displayName` ≤ 80, `unit` ≤ 16,
`suggestedPricePaise` an integer 0–10^9); text-only calls pass the same auth and per-shop rate limit as audio
calls; the slice is validated **before** any provider is called.

### D42 — Layer 1 uses the shop's catalog; a Layer 1 "hit" is strict; Layer 2 lines are settled and number-checked 🟢

**Owner decisions, 27 Sep 2026, `KB-302` (Q2, Q3, Q5, Q7).**

**1. The catalog is a required argument** of `parseUtterance`, `diagnoseUtterance`, `matchProduct` and
`buildCatalogIndex` — no default. The app passes the **shop's** catalog from Dexie (shop prices, shop product
ids, guard categories from the base product; D4); tests, eval and scripts pass the base seed explicitly
(`src/domain/seedCatalog.ts`, imported by no production file). A silent default to the seed is how Layer 1
came to price every shop from the base catalog.

**2. A Layer 1 hit** requires: `parseUtterance` ≠ null, every line matched a product in the shop's catalog,
and no HIGH `number_dropped` / `qty_dropped` / `number_unconsumed`. Anything else goes to Layer 2 — a comma
order Layer 1 merged into one line, or a garbled transcript it turned into one "unknown product".

**3. Settling Layer 2 (closes KI-34)** — `src/domain/layer2.ts`, rules in `04-VOICE-PIPELINE.md` §4: Gemini's
catalogId must be in the shop's catalog; a matched line shows the shop's name; money re-derived with D36
(default → shop price per the entry's unit; rate → per the spoken unit; total → spoken; unknown → none); qty
must be a valid `numeric(12,3)` or it is dropped and flagged `invalid_qty` (MEDIUM); non-integer paise dropped.

**4. Ordered number alignment for Layer 2 (NI-26)** — a new HIGH code, `number_misaligned`: the transcript's
numbers in spoken order; each line's spoken-origin numbers (qty; rate on a "rate" line; total on a "total"
line — a default line's catalog rate/total and an unspoken implied qty of 1 are skipped) must be found after
the previous line's, any order within a line. No segmentation on commas or "aur" (Whisper drops commas).

### D43 — Compound Hindi numbers: a multiplier combines only with the number immediately before it 🟢

**Owner decision, 27 Sep 2026, `KB-302`** (found while building it: "paanch sau gram chini" billed 100 gm for
₹5 with no flag; "do sau wala" dropped the "do"). Rules in `04-VOICE-PIPELINE.md` §3: `sau`/`सौ` ×100,
`hazaar`/`हज़ार`/`हजार` ×1000 combine only with the adjacent number before them (digits and fractions too —
`paune sau` = ¾ × 100 = 75, not 100 − 0.25); thousands + hundreds add; a whole group + a whole number under 100
adds, never after a fractional group; anything in between keeps numbers apart; no lakh. `saadhe N` = N + 0.5.
Fixed in the shared tokenizer, so Layer 1 and every number check read the same numbers. Benchmark NB111–NB129;
the 135 earlier fixture utterances parse byte-identically.

### D44 — Whisper language hint: "hi" 🟢

**Owner decision, 28 Sep 2026, after `KB-302`'s real-mic measurement** (owner's own voice, `netlify dev`, the
dev-only `?lang=` switch). **Auto-detect wrote spoken Hindi in Urdu script** — "دو کلو چینی…", "سابون ایک سو اسی
روپے", "ایک کلو کاجو ہزار روپے" — which Layer 1 can't read and in which `extractSpokenNumbers` finds **no numbers
at all** (`numbersHeard: []` on every Urdu transcript), so every number check went blind and some products went
unmatched and unpriced. **`hi` gave Devanagari with digits** — "2 किलो चीनी और 3 पार लेजी 10 वाला", "5 किलो चावल
30 का", "साबुन 180 रुपए" — every number visible, the right lines on the bill for 6 of 6 orders (one of them caught
only by HIGH flags: KI-45). The app now always sends `language: "hi"` (`src/ui/useVoiceBilling.ts`); the dev switch
keeps `?lang=auto|en` for measurements. Known cost: `hi` still glues some numbers to the next word ("दसवाला" —
KI-44) and Layer 1 misses most Devanagari (KI-49) — both next ticket.

### D45 — Warm mic: keep the stream 60 s after last use; never show "listening" before recording starts 🟢

**Owner decision, 28 Sep 2026** (`KB-302` measured tap → listening at **165–289 ms** on every tap against a 100 ms
budget; opening the mic costs ~150 ms each time). Keep the `MediaStream` open for 60 s after the last recording,
then release it (the browser's recording indicator stays on for that window). **Hard rule: the listening state is
never shown before `MediaRecorder` has actually started** — a lost first word is a wrong quantity. Budgets revised
in `05-FRONTEND-SPEC.md` §10: first tap ≤ 300 ms, warm taps < 100 ms. Built in the next ticket, not `KB-302`.

### D46 — Whisper stays on large-v3, not turbo 🟢

**Owner decision, 29 Sep 2026, `KB-317`**, on `npm run eval:audio` over the owner's 18 real recordings (both models
through the shipped Groq provider, language `hi`). Median Groq time: **large-v3 836 ms, turbo 713 ms** (~120 ms
faster). But turbo **garbled a number** — "250 ग्राम जीरा" came back "दो स्वपचास ग्राम जीरा" — and glued words
("किलोचीनी"), misspelt products ("मेगी", "आदा") and writes numbers as words. large-v3 gave the same text as at
record time on all 18, with digits. A garbled number is the one failure this app exists to prevent; 120 ms doesn't
buy it. Confirms `04-VOICE-PIPELINE.md`'s STT choice. Re-measure with `npm run eval:audio` if Groq changes models.

### D47 — Only a total spoken → qty stays empty (supersedes D13 point 1) 🟢

**Owner decision, 29 Sep 2026, `KB-317`** ("never invent a number"). When an item is spoken with only a total —
"साबुन 180 रुपए", "namak 20 rupay ka" — the line is **qty `null`, unit `""`, total as spoken**, whether or not the
product matches the catalog. D13 point 1 filled in qty 1 of the catalog's unit for a matched product; that is a
number nobody said. Built in `KB-317` commit 2 (tests first); `KB-004` fixture VC005 ("ajwain 10 ki" → qty 1 gm)
and any grammar test resting on D13 point 1 change with it, listed in that commit. D13 points 2–4 stand.

### D48 — Layer 1 reads Whisper's Devanagari; catalog alias fixes ship as a migration 🟢

**Owner decisions, 29 Sep 2026, `KB-317` commit 2** — on the owner's 25 real transcripts Layer 1 answered 4 (1 wrong).
1. **Items split on "aur", "और" and commas.** In a multi-item utterance every segment needs a product **and** a number,
   or the whole utterance is a miss (→ Gemini) — never a line merged, dropped or left without its number.
2. **Devanagari markers** — का/की/के (total), वाला/वाले/वाली/वला (rate), रुपए/रुपये/रुपया (currency) — count only
   straight after a number; elsewhere they are part of the name ("सरसों का तेल"). A glued number word splits
   ("दसवाला" → दस वाला).
3. **Spellings fold, letters don't** (owner: general normalisation, not one alias per misspelling). Product matching
   folds, on the catalog and the query alike: nukta and chandrabindu (फुटाना = फ़ुटाना), vowel length (साबून = साबुन),
   ै/े and ौ/ो, श/ष → स (बेशन = बेसन), व → ब (बरवटी = बरबटी). **Measured** on every real Whisper spelling seen (28)
   and every alias of every catalog product: +5 hits, 0 wrong, 0 new false matches, 0 aliases lost. **Rejected by
   measurement:** folding ा (ताज़ा and तज became ties) and **Devanagari → Latin transliteration** (no gain over the folds;
   विम, विम बार, मुरुक्कू became ties). Number and marker words keep their exact spelling; ड and ढ stay different
   letters, so every fraction spelling Whisper writes is listed (साढ़े/साड़े/साढे/साडे, डेढ़/डेड़/डेढ, ढाई/ढाइ/डाई,
   पौने/पोने), and every currency spelling (रुपए/रुपये/रुपया/रुपे/रूपए/रूपये/रूपया/रु).
4. **The bill shows the shop catalog's name** for a Layer 1 line, never the spoken words.
5. **Alias rulings:** आटा → Chakki Aata; sabun/साबुन → generic Sabun (614); bare shakkar → Chini; दाल and every
   toor/tur/tuvar/arhar spelling → Toor Daal (16); **Arhar Daal (17) deactivated** (same pulse, ₹140 — never deleted).
   Plus the Whisper spellings no fold reaches (a moved word boundary "पार लेजी", ल for र "मसूल", "चायपत्ती" as one
   word) — 8 aliases, listed in `scripts/catalogAliasFixes.ts`.
6. **Catalog alias fixes ship as a migration** that updates `base_products` and every existing shop's `source='base'`
   copy (Layer 1 reads the shop's own Dexie copy — a seed edit alone never reaches an existing shop). One list,
   `scripts/catalogAliasFixes.ts`, drives both the seed and the generated migration (a test fails on drift). Every
   product lookup must match exactly one row or the migration aborts.

### D49 — Mic budgets: cold tap ≤ 1 s, warm < 100 ms; no start on pointerdown (supersedes D45's cold budget) 🟢

**Owner decision, 30 Sep 2026, `KB-317` commit 4**, on the owner's browser measurement with the warm mic built:
warm taps **52 / 53 / 61 / 58 ms** (< 100 ms — met); the cold tap **816 ms = getUserMedia 709 + recorder start 106**.
The cold tap is dominated by the browser opening the device, which no code of ours shortens short of opening the mic
before a tap — ruled out (the mic is never on unasked). **Cold budget: ≤ 1 s. Warm: < 100 ms, unchanged.** Starting
on `pointerdown` instead of the click would save the measured 132–167 ms, but **not built**: a touch-scroll that
begins on the mic button would open the mic unintended. D45's other rules stand: 60 s warm window, "listening" only
once `MediaRecorder` has started, released when hidden / on leaving the screen / on sign-out, a recording in progress
stopped and discarded when the app is hidden (owner confirmed), a mic opened after the tab went hidden closed at once.

### D50 — Voice deadlines: Groq 8 s / Gemini 6 s on the server, 12 s / 8 s on the client; Gemini not auto-retried; a failed parse is kept, never lost 🟢

**Owner decision, 2 Oct 2026, `KB-319`** (KI-57, KI-58). Netlify's synchronous function limit is **60 s, not configurable** (docs.netlify.com/build/functions/configuration, updated 17 Sep 2026); `netlify dev` doesn't enforce it — that's how a 39 s order happened locally. Each `/voice` call reaches ONE provider (the client sends audio → transcript, then text → items on a Layer 1 miss), so its budget is ~1 s of auth/rate limit + one provider deadline.
1. **Server, per attempt** (`src/voice/deadline.ts` `withDeadline`; the request is aborted, a late answer never used): **Groq 8 s** (measured normal 0.8–2.6 s, outlier 18.7 s), **Gemini 6 s** (normal 1.6–3.5 s, outliers 12.9 / 20.4 s). A deadline → `/voice` **504**; a provider's own 429 → **503** "busy" (never 429 — that is the shop's own limit); anything else → 502.
2. **Client, per `/voice` call** (`data/voiceApi.ts`): **transcribe 12 s, parse 8 s** — a few seconds over the server's, so the server's clean error normally arrives first; the client's is the backstop (network, cold start, auth).
3. **Gemini is not retried automatically** (was 3 attempts, 0.5 / 1 s sleeps): 3 × 6 s + 1.5 s can't fit the 8 s client deadline, and the 5xx seen were quota (KI-50). Groq stays one attempt; a 429 fails fast with "Voice service busy — try again in a minute" (Hindi later, KI-59).
4. **A failed parse (5xx, 429, timeout, network) is kept on the bill** as "Not added: “…” — Retry / ✕" until the shopkeeper retries or dismisses it; new recordings carry on, several may be pending, **each counts in "N checks pending"** (Bill Banao waits for 0 — nothing said goes unbilled unnoticed). The owner rejected "a new recording clears the Retry": it silently loses an order. Retry re-sends the **text only** (same transcript, same slice, no Groq, no re-record); a re-spoken order retried anyway is caught by `already_on_bill` / `duplicate_line`. 401 / 400 are not retryable. **One set of lines per utterance:** a late answer is discarded by the deadline, and the bill accepts a Retry's lines only while its entry is still listed.
5. **No Retry cap:** every Retry is a human tap (disabled while in flight) and one `/voice` call against the per-shop 300/hour limit, which already bounds abuse.

### D51 — The type-ahead budget is two numbers: lookup ≤ 16 ms, keystroke → visible results ≤ 50 ms median (supersedes 05 §10's single 16 ms) 🟢

**Owner decision, 3 Oct 2026, `KB-305`**, on the first real-phone measurement (NI-28; Android 10, Chrome 152, the dev-only `/__dev/typeahead` bench): index build 481 products 72.5 ms · 10,101 products 1012.6 ms (one-time); lookup 481: median 0.30 · p95 0.50 · max 3.80 ms (n=510); lookup 10,101: median 5.80 · p95 11.20 · max 16.00 ms (n=510); keystroke → paint (10,101 catalog): median ~24–25 ms · p95 42–136 ms · max 136.4 ms (n=19–46).
1. **Lookup (`searchCatalog`) ≤ 16 ms per keystroke** — met on the phone even at 10,000 products (p95 11.2 ms, max 16.0).
2. **Keystroke → visible results ≤ 50 ms median on a realistic catalog.** One 60 Hz frame alone is ~16 ms, so "keystroke → paint < 16 ms" was never achievable — the old single figure conflated the lookup with the frame.
3. The bench's typing box gained a catalog-size toggle (481 / 10,101) so the realistic-catalog keystroke → paint is measured too; **that number is still to be recorded** (NI-28).
4. Scale note: a 10,000-product index build takes ~1 s on this phone — a one-time cost at catalog load, fine for real shops (~500 products: 72.5 ms).

### D52 — The customer on a bill: name ≤ 60 code points, mobile exactly 10 digits; the client and the CHECKs apply identical rules 🟢

**Owner decisions, 3 Oct 2026, `KB-306`** (D6 stands: "Cash" by default, never blocks finalise, never asked).
1. **Name:** trimmed, spaces collapsed, control characters dropped; empty or any "cash" → "Cash"; at most **60 code points**.
2. **Mobile:** optional; typed with or without +91 / 91 / 0, spaces, hyphens, Devanagari digits; **stored as exactly 10 digits** starting 6–9 (the form a future udhaar matches on). Purpose: the receipt to the customer's WhatsApp (`KB-308`/`KB-309`) and later udhaar. 01-PRD's "no phone numbers" corrected.
3. **Client ⇔ server parity:** `bills_customer_name_check` / `bills_customer_mobile_check` (migration `20261003090000`) are the same rules as `domain/customer.ts`. Postgres `char_length` counts code points and JS `.length` counts UTF-16 units (an emoji is 2), so the client counts code points — a mismatch would make a bill a permanent 23514 sync conflict. `data/customer.e2e.test.ts` pushes every tricky input (Devanagari, emoji, ZWJ sequences, exactly 60 / 61, every mobile prefix form) through the real `push_bill` and asserts client-accept ⇔ server-accept.
4. **Minimal personal data (DPDP Act 2023):** no profiles, no customers list, no recent-customers suggestions; customer fields never go to `/voice`; a failed bill push logs only its `localId` and error code. The receipt (`KB-308`) prints the name only when it isn't "Cash", and **never the mobile**. Erasure vs immutable bills → the pre-pilot privacy review.

### D53 — Integrity before bills and learning rows arrive: same-shop references, bills must add up, type-aware lint 🟢

**Owner decisions, 3 Oct 2026, `KB-307` commit 1** (migration `20261003100000`). Closes KI-38, KI-41, SG-10.
1. **Every cross-table reference stays inside its own shop** — composite FKs `(ref, shop_id)` for `learning_events.bill_id`, `bill_items.shop_product_id`, `learned_aliases.shop_product_id`, `price_observations.shop_product_id`, `provisional_products.promoted_shop_product_id` (plus `unique (id, shop_id)` on `shop_products`); each plain FK dropped (PostgREST embed ambiguity, D37). Why it was needed: insert RLS checks only the row's own `shop_id`, and an FK check runs as the table owner, ignoring RLS. A NULL reference stays allowed. `copy_base_catalog` is no longer executable by PUBLIC / `anon` — an anon call used to **run without error**.
2. **A bill entering `final` or `cancelled` must add up** — at least one item, items sum to `subtotal_paise`, `subtotal_paise = total_paise` (no discounts or tax yet — revisit with them). Enforced by a **table trigger** (`bills_totals`), not only inside `push_bill`: bills RLS lets a member write bills directly, so a `push_bill`-only check would leave a path open. Error `KB422`, classified **permanent** in `sync.ts` (the same request fails forever). `final → cancelled` isn't re-checked (it passed on entering final; `bills_immutability` forbids every other change).
3. **Type-aware lint (SG-10):** `@typescript-eslint/eslint-plugin` 8.70.0 (the sibling of the parser already installed — not the `typescript-eslint` meta-package, which would bundle a second parser; pinned to the installed parser's version rather than a same-day 8.71.0 that bumps the parser too) with exactly three rules — `no-floating-promises`, `no-misused-promises`, `await-thenable` — on `src/data`, `src/ui`, `netlify/`. Lint time ~5 s → ~29 s. The 10 existing findings (none in `src/data` or `netlify/`) were listed in KI-61 and then fixed before commit 2 (owner) — no file is excluded.

### D54 — Bill Banao: one atomic local write; offered only when nothing is pending, "Price needed" included 🟢

**Owner decisions, 3 Oct 2026, `KB-307` commit 2** (plan decisions 2 and 4).
1. **One Dexie transaction** (`data/finalise.ts`): the receipt number (this device's block, or the D23 fallback — `takeNextNumber`, local tables only), the bill (`final`, sync `pending`) and its items — all or nothing. The block top-up (`topUpReceiptBlock`) and a sync run **after** the commit, never awaited. The bill's `localId` is made when the bill starts; finalising it again (double tap, two tabs) returns the saved bill — one bill, one number.
2. **Bill Banao is offered only with ≥1 line and `pending` = 0.** `pending` = unacknowledged HIGH flags + lines that need an amount + not-added utterances. A line needs an amount when its price type is `unknown` (a custom item; **Rule 5b's bare "ajwain", whose total of 0 means no price — found while building: "total ≠ null" alone would have put "Ajwain ₹0" on a receipt**), or it has no total. Shown as **"Price needed"** / "Quantity needed" with no "Theek hai" — only a value clears it — replacing `missing_total` (HIGH, acknowledgeable) and `incomplete_item` on that line, so one line is never two checks. A real ₹0 price counts as priced; a typed ₹0 is still refused (KB-303).
3. **A tap while not offered** (`aria-disabled`, not `disabled`, so it lands) focuses the first pending item in bill order — a "Theek hai", the missing amount or quantity, then a not-added Retry — and announces the count.
4. **Saved screen:** "Bill {receipt number} saved", the bill read-only, **New bill** (empty, customer Cash, a new `localId`). The mic or Add item there starts the next bill directly (owner; re-check when `KB-308`/`KB-309` add sharing).
5. **`bill_items.review_flags`** stores `{code, severity, acknowledged}` per flag (owner); a bill-level flag is stored on its anchor line.

### D55 — Pushing no longer deploys: production only for a commit marked `[deploy]`, approved by the owner 🟢

**Owner decision, 3 Oct 2026.** Each production deploy costs 15 Netlify credits; 4 remained until 18 Oct, and the site can go offline at 0.
1. `netlify.toml` `ignore = "bash scripts/netlify-ignore.sh"`: the build is **skipped (exit 0)** unless the **latest** commit message contains `[deploy]` (`git log -1` — the build clone is shallow). Exit codes per Netlify's docs (0 = skip, 1 = build). Tested locally: a normal commit → skip; a `[deploy]` commit → build; the next normal commit → skip; a depth-1 clone → skip.
2. Pushing to GitHub after each verified step continues (D34). **The agent never puts `[deploy]` in a commit message unless the owner explicitly approves that release** — and never writes the marker into a message by accident (messages about this rule say "the deploy marker").
3. Testing on real devices: a draft deploy (`netlify deploy` without `--prod`, 0 credits). Never `--prod` without the owner's approval.
4. Netlify's docs don't say whether a skipped build costs credits — the owner verifies in the dashboard after the first push under this rule (Deploys shows Skipped/Canceled; credit usage unchanged).
5. **Every migration stays compatible with the app version currently deployed** (owner, 3 Oct 2026). `db push` goes live on the remote at once; code reaches production only at a `[deploy]` release — so for days the live app runs against the new schema. Additive changes only until the matching release (new nullable/defaulted columns, new tables, new functions); never rename/drop a column, tighten a constraint or change a function signature the deployed code still uses — split it across two releases (expand, deploy, then contract). Each migration's plan states which deployed version it was checked against.

### D56 — Learning at finalise: after the commit, its own transaction, idempotent, every alias event tagged with its layer 🟢

**Owner decisions, 3 Oct 2026, `KB-307` commit 3** (plan decisions 1 and 6, and the source-tagging / deterministic-id additions).
1. **When:** after the bill commit, in its own Dexie transaction (`data/learnBill.ts`), from the **committed** bill — a learning failure never touches the bill (08 §8, safety rule 7). Then the sync, so the bill and its learning rows push in one cycle. **Recovery:** on start (and after every save) `learnPendingBills` learns each final bill without a marker. Drafts never teach (hard rule 8).
2. **Idempotent:** append-only rows (events, price observations) get ids derived from bill `localId` + line + kind; one-per-key rows (learned alias, provisional product) from shop + key (`domain/ids.ts`, synchronous so it can run inside the transaction); and a `bill_learned` marker event is written in the same transaction. A bill with a marker is skipped — recovery or two tabs (KI-39) change nothing (tested: run twice → identical state; two concurrent runs → one run's state; e2e: re-learn + re-sync → identical server rows).
3. **What each line teaches** (`learnFromBill`, pure): an **unedited** fastpath / Gemini line matched to a product whose words aren't already an exact alias → alias confirmation (L2); edited lines and **hand-added lines never teach an alias**; a **removed** voice line (kept on the bill locally as `discardedLines`, never pushed) whose words are a learned alias → suppression; a rate differing from the shop's price **in the shop's own unit** → price observation (L3; a rate in another unit is skipped rather than converted with a division); a line with no product → provisional sighting (L1; its rate is the price, a total-only line gives none; the 3rd sighting is a `product_promotion_due` event — creating the product is `KB-320`).
4. **Every alias event records its source layer** (`fastpath` / `gemini` / `manual`) — the input for `KB-323`'s rule that Gemini-sourced confirmations need a higher threshold.
5. **Known limits, recorded:** a retired alias is kept at its last confidence (≤ 0.3), not deleted (deletes don't sync — NI-27); a provisional product stores only its latest suggested price, so its "modal price" has that one point; L4 / L5 are `KB-322` / `KB-321`. Event payloads carry no customer data.

### D57 — The receipt takes the legacy parchi's layout, and new shops print in English 🟢

**Owner decisions, 4 Oct 2026, `KB-308` commit 4** — a design change after the receipt (05 §6 as approved 3 Oct)
was built and checked; it amends that mockup, the Q3 strings and two display rules.
1. **Layout from `legacy/billing-ui.js` `buildBillHTML` — the layout only, never its code:** shop name centred, larger,
   bold; phone and `date | time` (05's date format, legacy's " | ") as small muted lines; a "Bill No." line (new); then
   "Customer: <name>" only when it isn't Cash, never the mobile (D52); dashed rules between sections; a **visible**
   header row (Item / Qty / Rate / Amt) with a darker rule under it and a light rule under each item; Qty left, Rate
   and Amt right, Amt bold with ₹; TOTAL larger and bold; a thank-you footer.
2. **Not taken from legacy:** `toFixed(0)` (amounts stay exact paise via `formatRupees` — ₹22.50 prints ₹22.50);
   raw HTML strings (React text, hard rule 9); the 📞 emoji (13 §7); a drop shadow (13 §7 — a 1 px border instead);
   the 520 px width (max 384 px, 100% narrower, no sideways scroll at 320 px).
3. **Changed from the 3 Oct receipt:** an unknown rate prints "—" (was blank); amounts carry ₹; the header row is
   visible (was screen-reader-only); "Bill:" → "Bill No."; "Amount" → "Amt"; "Thank you!" → "Thank You!"; "both"
   prints the thanks on one line (`धन्यवाद!  Thank You!`). Hindi strings added: "बिल नं.", "ग्राहक:". All labels in
   the one table in `domain/receipt.ts`, which stays the one source `KB-309` draws from.
4. **English by default:** `shops.bill_language` defaults to `'en'` for new shops (migration `20261004090000`; was
   `'hi'`). Existing shops keep their value. Hindi and both stay as options; switching is in Studio — **the edit must also set `updated_at = now()`** (KI-65: a device ignores a server-side shop edit that doesn't bump it) — until `KB-312`'s
   setting. Compatible with the deployed app (D55 §5): the default applies only when a shop is created, `createShop`
   never sends `bill_language`, and the deployed build (`6e29cf2`) draws no receipt.
5. **Unchanged:** unknown qty "—" (D47), SG-09 rate units, the fallback number breaking only after hyphens and copying
   whole (Q1 A), the customer's mobile nowhere in the page.

### D58 — Sharing the receipt, the legacy way: Image and PDF download, WhatsApp sends the image, SMS sends text 🟢

**Owner decisions, 4 Oct 2026, `KB-309`** (plan Q1–Q5 and additions; then commit 3: the owner's desktop check asked for
the legacy app's behaviour — `legacy/billing-ui.js` downloadImage / downloadPDF / shareWhatsApp / sendSMS, behaviour
only, never its code).
1. **One source:** everything is drawn from `domain/receipt.ts` — the image via `domain/receiptLayout.ts` (pure drawing
   steps), the messages via `domain/receiptText.ts`. No HTML is generated anywhere (hard rule 9).
2. **Image** — PNG at 2x, 768 px wide; the button always **downloads** it (`KB-000142.png`), desktop and phone, no share
   sheet. **PDF** — our own ~40-line one-image PDF, no dependency, page 58 mm wide (164.41 pt), height in proportion;
   the button always **downloads** it. The owner judges the 58 mm page on the phone.
3. **WhatsApp sends the IMAGE:** `navigator.share({ files: [png] })` when `canShare({ files })` is true — the shopkeeper
   picks WhatsApp and the chat; a cancelled sheet (AbortError) does nothing. Only without file sharing: `wa.me/91<mobile>`
   with the text receipt (the stored bill's mobile; none → `wa.me/?text=`). The share call happens **inside the tap** —
   the PNG and PDF are rendered when the receipt is shown (Android's activation rule); every font face/weight is loaded
   with the receipt's actual strings before drawing.
4. **SMS (new):** a sheet with a mobile field, pre-filled from the **stored** bill's mobile when it has one (read when the
   sheet opens), else empty; the shopkeeper can type or change it; D52 rules (`domain/customer.ts`
   `parseIndianMobile`); Send disabled until valid; a preview of the text. Send opens `sms:<10 digits>?body=…` (the
   Android form). The typed number is **never stored** and never changes the bill (immutable). Text only — a web page
   can't attach an image to an SMS. SMS text: bill_language labels, plain text, no WhatsApp `*bold*`, `Rs.` for ₹,
   `-` / `x` for `·` / `—` / `×` (each would force a Unicode SMS: 70 characters a part instead of 160; Devanagari
   labels in hi / both make it Unicode anyway).
5. **The mobile:** never shown on the receipt or the saved screen. Read from the stored bill at tap / sheet-open time —
   never the draft or the receipt model. With the SMS sheet open it appears only as the field's value.
6. **Phone testing (owner):** Google sign-in passes `redirectTo: <this origin>/` (the trailing `/` matters: proven
   locally, the bare origin doesn't match a `/**` pattern and falls back to the Site URL), so a draft deploy (or
   localhost) returns to itself, not to the Site URL (the live site). Supabase Redirect URL for Netlify drafts:
   **`https://*--kiranabilling.netlify.app/**`** (single `*`, owner, 6 Oct 2026). **Never the `**--` form** from
   Supabase's docs example: `**` also matches `/` and `.`, and with the implicit flow (tokens in the URL fragment)
   GoTrue then accepts `https://evil.example/x--kiranabilling.netlify.app/` and hands the session to that site —
   proven on the local stack (the verify link redirected there with `access_token` / `refresh_token`); the single-`*`
   pattern sends the same request to the Site URL and keeps a real draft URL. Pre-pilot: exact URLs, see 10-TRACKER
   "Before deployment".
7. **Privacy:** sharing sends the customer's name and items to WhatsApp (Meta), an SMS or another app, at the
   shopkeeper's tap — in the pre-pilot privacy review.

### D59 — Gemini under load (adds to D50): a 503 overload is "busy", automatic retry stays off, failures are logged in production 🟢

**Owner decision, 7 Oct 2026, KI-66.** D50 §3 turned off Gemini's automatic retry when the 5xx seen were quota (KI-50).
**The first non-quota Gemini 5xx seen** (draft deploy, 7 Oct 2026) was a **503 overload** — `"This model is currently
experiencing high demand"`, `UNAVAILABLE` — transient and external. The app kept the utterance with Retry, as D50 §4
designed.
1. **A Gemini 503 is `busy`**, like a 429 → `/voice` answers 503 "Parse busy" (was 502 "Parse failed"). Still retryable
   on the client; the on-screen message is unchanged.
2. **Automatic retry stays off for now** (owner): revisit with production numbers (how often, how long an overload lasts).
   Paid-tier requests are prioritised under load (Google forum staff), so KI-50 billing is the first lever.
3. **One production log line per provider failure** in `/voice` — step, kind, our status, the provider's HTTP status if
   any, duration. **Never** the transcript, the provider's body or a URL (customer data and keys stay out of logs).
4. **The Gemini key goes in the `x-goog-api-key` header**, not `?key=` in the URL — an error or log that carries the URL
   can never carry the key.

### D60 — History loads in windows: the newest 200 to open, 90 days to search, everything on demand 🟢

**Owner decision, 7 Oct 2026, `KB-310`**, after measuring on real IndexedDB (desktop Chrome): at 40,000 bills × 5
items (a busy shop: ~100 bills/day, ~36,000/year) loading every bill with its items took ~4.4 s (reading the items by
`anyOf` 4.1 s; a full item-table scan 1.6 s; the newest 200 bills by the date index 3 ms), and a per-keystroke filter
that rebuilt each bill's text took 32–87 ms. A phone is several times slower.
1. **Open:** the newest 200 rows from the `createdAt` index, without items — no Dexie schema change, no item count on
   the row.
2. **Search scope:** the last 90 days (≈ 9,000 bills for a busy shop) load in the background after opening; the list and
   search stay usable meanwhile; "Searching the last 90 days" while that's the scope.
3. **Search older bills:** loads every bill on demand (full-table item scan), offered under every search until loaded —
   also when the recent search finds nothing, so an older `dd-mm` date never just says "no bills".
4. **Search text built once per bill** at load (`toSearchEntry`); the query compiled once per keystroke
   (`compileQuery`). Measured (Node): 40,000 bills 1.3–2.7 ms a keystroke, 9,000 bills 0.3–0.6 ms.
5. **200 results, then "Show more".** With no search, the list is the newest rows (the 90-day window is for search
   only — a shop whose bills are all older still sees them).
6. **No budget yet** (owner): the phone numbers come from the dev-only `/__dev/history` bench at the next draft-deploy
   check (`npm run dev -- --host`, the phone opens `http://<laptop-ip>:5173/__dev/history`), as D51 was measured.

### D61 — History search rows live in a device-only table, written with the bill (replaces D60's item loads) 🟢

**Owner decision, 7 Oct 2026, `KB-310` commit 3** (option C, with a separate table). Measured on real Chrome
IndexedDB at 40,000 bills × 5 items: D60's 90-day load read items with `billItems.where("billLocalId").anyOf(ids)` —
**~22–26 ms per id** (10 ids 223 ms, 100 ids 2.6 s), so 9,000 ids ≈ 4 minutes; it never finished. The unit tests'
in-memory IndexedDB could not show it.
1. **`billSearch`** (Dexie v4): one row per final bill — `localId` (key), `shopId`, `finalizedAt` (index
   `[shopId+finalizedAt]`), `totalPaise`, the receipt sequence, the date key, the receipt number and customer name (for
   display), and lowercased `text` (customer name, every item's display and spoken names). **Never the mobile.** The
   receipt number is matched exactly and by its sequence — kept OUT of the substring text, so "14" never matches
   `KB-000142` (owner). `matchBill`'s rules unchanged.
2. **Written in `finaliseBill`'s transaction** — a final bill always has its row; if it can't be written, nothing is. The
   bill itself is untouched (hard rule 2). **Device-only:** `sync.ts` names every table it pushes and never this one
   (tested with a DBCore recorder: a push reads `bills`, never `billSearch`). It lives in the per-user database, kept or
   lost exactly like the bills — sign-out deletes nothing (D38).
3. **Upgrade:** v4 backfills every existing final bill (one item scan grouped by bill) — tested from a real old-version
   database.
4. **Loads:** the 90-day window is ONE range query on `[shopId+finalizedAt]`; "Search older bills" is all of the shop's
   rows; items are read only when a bill's detail opens. Guarded by a test that fails on any `billItems` / `bills` access,
   `get` / `getMany`, or cursor (`anyOf`) during a search load.
5. **Measured after** (desktop Chrome, `/__dev/history` over the LAN): newest 200 25–30 ms; 90-day load (9,000) ~245 ms;
   keystroke over 9,000 median 2.4 ms; all 40,000 ~1.1–1.2 s; keystroke over 40,000 median 11.4 ms.
6. **Not A or B:** per-bill `equals` queries (A, 1.4–2.8 s) and a full item scan (B, 2.5 s) both still read 45,000–200,000
   item rows on every History open, growing with the shop's history; the search row is read once, small, and indexed by
   date. Cost: one more write per bill and a schema version — accepted.
7. **Bills pulled from the server later (`KB-324`) need their rows too**, in the same transaction.
8. **Phone measurement and budgets** (owner, 7 Oct 2026; Android 10, Chrome 152; 40,000 bills, 9,000 in 90 days;
   `/__dev/history`). Budgets on the phone at 40,000 bills: **open ≤ 300 ms** (measured 234 / 72 / 62 ms); **90-day load
   ≤ 2 s**, in the background (1,624 / 1,187 / 1,145 ms); **older load ≤ 6 s**, with "Loading older bills…" (4,540 /
   3,825 ms); **keystroke ≤ 50 ms** (D51) — over 9,000 median 4.8 · p95 6.9 · max 14.7 ms, over 40,000 median 14.1 ·
   p95 16.4 · max 17.3 ms. Laptop over the LAN: 35 / 11 / 10 · 278 / 230 / 229 · 1,072 / 1,031 ms · 0.8 / 1.3 / 2.8 ·
   5.0 / 6.2 / 7.0 ms. All within budget; 05 §10.

### D62 — `shop_products.updated_at` is set by the server; the pull re-reads the last minute 🟢

**Owner decision, 8 Oct 2026, `KB-311` (plan Q2).** Migration `20261008090000_shop_products_updated_at`.
1. **A trigger sets `updated_at = now()`** on every insert and update of `shop_products`; whatever a client sends is
   ignored. Before it, `updated_at` was client-set (catalog migration) — a write that left it alone (a Catalog price
   edit, a Studio or SQL edit) was never pulled, not even by the writer's own re-pull (`KB-311` e2e test 4 failed
   exactly so). Additive (D55 §5): the deployed app only pulls `shop_products`.
2. **The pull overlaps its cursor by 60 s** (`SHOP_PRODUCTS_PULL_OVERLAP_MS`, `sync.ts`): `updated_at > cursor − 60 s`.
   `now()` is when the writing transaction STARTED; a slower transaction from another device can commit after this
   device's cursor passed that time, and `> cursor` alone skipped it forever (reproduced in `catalogEdit.e2e.test.ts`
   test 7 with two real transactions). Re-read rows are harmless (`bulkPut` by id); the cursor never moves back.
   Ceiling: a transaction open longer than 60 s can still be missed — none exists today.
3. **Catalog writes are online only** (`data/catalogEdit.ts`): Postgres first, then the re-pull; never Dexie first.
   Zero rows updated (RLS) is a failure, `23505` is "already in your catalog".
4. `shops` had the same client-set `updated_at` (KI-65) — done in D64 (a trigger and a new sync rule).

### D63 — Bills are pulled from the server: a server-set `synced_at`, a resumable backfill, then a 60 s-overlap incremental 🟢

**Owner decision, 8 Oct 2026, `KB-324` (plan Q1, Q2).** Migration `20261009090000_bills_synced_at_trigger`.
1. **`bills.synced_at` is set by the server** — a `BEFORE INSERT` trigger, `now()`; a client value is ignored. `created_at`
   and `finalized_at` are the DEVICE's (push_bill passes them through), so a bill made offline yesterday and pushed
   today looks old and cannot be a cursor. INSERT only: no update path is touched, so `bills_enforce_immutability`'s
   whole-row comparison never sees it change. **No backfill** (it would need the immutability triggers bypassed —
   never): bills from before the migration keep `synced_at` null and arrive through the backfill. Additive (D55 §5).
2. **Backfill, then incremental** (`pullBills`, `sync.ts`; sync_state `bills:<shopId>`, both resumable):
   - *Backfill:* every bill, newest first, 200 a page, keyset on `(created_at, id)`; the position is saved after each
     page. Before it starts, the newest server `synced_at` is recorded as the incremental cursor. It runs detached from
     the sync cycle, so pushes are never held up behind it.
   - *Incremental:* `synced_at > cursor − 60 s` (the D62 overlap), ids first — the window is re-read every 15 s cycle, so
     bills (and their items) are downloaded only when this phone lacks them (50 ids a request).
3. **A pulled bill** — the bill, its items and its `billSearch` row (D61) — is written in one transaction (bulk writes
   per page). Stored `syncStatus: synced` with its `serverId` (never re-pushed), and a local-only **`pulledAt`**:
   `learnPendingBills` and `learnFromSavedBill` skip it. It was made, and learned from, on another device (or before this
   phone was cleared); learning it again would double its counts (hard rules 8, 12). A bill already local (same
   `local_id`) is never touched. A bill that arrives already cancelled (e.g. a Studio edit) is stored, not listed.
4. **When:** only inside a sync cycle (a real session, D38) and only while the browser is online; offline it waits —
   no polling of its own (NI-38). History says "Loading bills from the server…" until the first pull ends ("Connect to
   the internet to load your earlier bills." offline), never "No bills on this phone yet." before that.
5. **Not in this ticket:** cancellations reaching other devices — nothing cancels a bill today; `KB-325` designs its own
   timestamp when it exists. Learning state (aliases, provisional products, price observations) is still not pulled:
   `KB-326`.
6. **Measured, 8 Oct 2026** (local stack, 5 items a bill): one 200-bill page = **531,904 B** JSON (2.7 KB a bill) —
   gzip 55,601 B, brotli 41,242 B. **36,000 bills = 180 pages = 95.7 MB JSON; ≈ 10.0 MB gzip; ≈ 7.4 MB brotli.** **The hosted API compresses — verified by the owner on the draft, 9 Oct 2026:
   `content-encoding: gzip` (a `shop_products` response, server `cloudflare`). So a 36,000-bill backfill is about 10 MB on the wire, not 96 MB.**
   Transfer at 10 Mbps: ~8 s (the uncompressed ~77 s no longer applies), plus 180 round trips. Writing into IndexedDB (Chrome desktop, local server): 0.75–
   0.87 s a page ≈ 230–270 bills/s → **36,000 bills ≈ 2.3–2.6 min on the laptop; on the phone, not measured — if it is
   4–6× slower (the D61 reads were), 10–15 min in the background.** The newest 200 are on screen after the first page.
   A shop with 3,000 bills: ~0.8 MB compressed, ~1 min on the phone. No window was added (owner's rule).

### D64 — For `shops`, the server's `updated_at` is the only clock (replaces last-write-wins on a device clock) 🟢

**Owner decision, 8 Oct 2026, `KB-312`** (closes KI-65). Migration `20261010090000_shops_updated_at_trigger`.
Settings makes shop edits routine, and `shops.updated_at` was set by the device: two phones with skewed clocks could
lose an edit, and an edit made in Studio / SQL that left `updated_at` alone never reached a device (KI-65). A trigger
alone would not have fixed it — `pullShop` compared the device's own `updatedAt` with the server's — so the rule changes
with it. This supersedes 02 §2's "last-write-wins on `updated_at`" **for shops**.
1. **A trigger sets `updated_at = now()`** on every insert and update of `shops` (a client value is ignored). Additive
   (D55 §5). **Why `20261010090000` is compatible with the deployed app (`6e29cf2`, still on the device-clock rule):**
   that build has no Settings, so it can never create a *pending* shop edit — `pushShop` never has a row to push, and
   the only thing that writes its local shop row is `pullShop`'s `put` of the server's own row. Its local `updatedAt`
   is therefore always a server-issued value, and its comparison (`local.updatedAt >= server.updated_at`) is server
   against server: with the trigger nothing changes while the row is untouched, and a Studio / SQL edit — which now
   bumps `updated_at` — is newer, so it is taken (KI-65 is fixed for that build too, without a release). Nothing breaks.
   (The migration file's own comment says the old build would "take an identical row back once per edit" — it would
   not; this paragraph is the accurate statement.)
2. **A push** (`pushShop`) sends the fields without `updated_at`, reads back the row's `updated_at` and stores it
   **verbatim** with `syncStatus: synced` — but only if the local row is **still the version it pushed** (its `updatedAt`
   is unchanged, still pending). An edit made while the request was out stays pending and goes up next cycle
   (`updateShopSettings` gives every edit a distinct `updatedAt`, also two in one millisecond).
3. **A pull** (`pullShop`) never touches a `pending` row; otherwise it takes the server row whenever its `updated_at`
   **string differs** from the local one. **Strings are compared verbatim, never through `Date`** (JS has milliseconds,
   Postgres microseconds — "equal" would never be equal and every pull would re-take the row). No comparison with a
   device clock at all. The "discarded local edit" log is gone: replacing a synced row is the normal path.
4. **Order is unchanged**: a cycle pushes before it pulls, so a pending edit is on the server before any pull.
5. **Whole-row push for now — NI-40:** two phones editing the same shop while one is offline — the **later arrival**
   overwrites the other's fields, including any server-side change to logo / address / prefix it had not pulled yet.
   Revisit with per-field push **before a shop can have a second device or staff**.
6. `createShop` / onboarding are unaffected: the shop is inserted on the server and `pullShop` fills Dexie; nothing
   writes the local shop row with a device-clock time any more except `updateShopSettings`, which is then replaced by
   the server's value on its push.
7. Tested on the real stack (`shopSettings.e2e.test.ts`): a Studio-style edit reaches the device; a device whose clock is
   5 minutes ahead and edits first — another device's later edit still wins on it; a pending edit is not clobbered by a
   pull; plus unit tests for a microsecond difference, an identical timestamp, and an edit during a slow push.

### D65 — The half-built bill is kept in the user's own database; the sync loop waits while offline; the header chip is a status, never a dialog 🟢

**Owner decision, 8 Oct 2026, `KB-313`** (plan Q1–Q5). No migration, no new dependency.
1. **The half-built bill survives** a reload, Android killing the backgrounded tab, or a crash (02, 05 §9, 16 §6 all promised it; it was
   held in a `useReducer` only). It is kept in the **`meta` table of the signed-in user's OWN database** (`kiranabill-<userId>`, D38) —
   never the shared device database, so one user's bill can never show for another user on the same phone — under **one key per shop**
   (`billDraft:<shopId>`). Nothing new in the Dexie schema. **No expiry.**
   - *Written* ~250 ms after a change (a burst of edits is one write) and at once on `pagehide` / when the tab is hidden.
   - *Kept:* lines, utterances with their flags and transcripts, acknowledged flags, "Not added" entries (a retry that was in flight comes
     back as not retrying — its request died with the page — transcript kept, so Retry works), the customer, the lines removed for learning,
     the bill's id and start time. Not kept: the one-level undo and the focused line.
   - *Restored* silently, exactly as left, once the draft has been looked at (the mic stays off until then, like the catalog).
     **Prices come back exactly as saved — nothing here looks at the catalog (hard rule 7)**; only the flags are re-derived from the lines.
   - *Never restored:* a bill whose `local_id` is already in `bills` (a crash right after Bill Banao — it is dropped, never re-finalised);
     a damaged or unknown-version value (a whole validation: money must be a safe integer, the customer must pass the same rules as the
     `bills` CHECKs — it starts an empty bill and removes the value, never throws); onto a bill someone already started.
   - *Dropped:* when Bill Banao saves (and it stays gone until New bill), on **Clear bill**, and an empty bill keeps none.
2. **Clear bill** (≡ menu, only while the bill has lines, behind a confirmation "N lines will be removed — nothing is saved."): the bill is
   thrown away and a new one starts. **It teaches nothing** (hard rule 8): the lines removed never reach learning (checked: no bill, no
   learning events).
3. **The sync loop waits while the browser is offline (closes NI-38).** Offline: `runLoop` sends nothing and schedules **no timer**; a
   `syncNow` (e.g. right after Bill Banao) returns `{ skippedOffline }` without a request and is not a failure. The `online` event runs a cycle
   at once and the 15 s cadence resumes (one timer at a time — `runLoop`'s reschedule clears any older one). "Offline" means
   `navigator.onLine === false`; Node and old browsers have no value and count as online. The existing back-off for "online but failing" is unchanged.
4. **The chip** (05 §7), in the header — a status, never a dialog: grey **Offline**; **Not syncing — sign in again** (online but no live
   session, D38's offline-session mode); amber **Sync failing** (3 transient failures in a row, or any bill in a permanent conflict — tappable:
   how many bills are waiting, the permanent ones separately, the last attempt, "Billing continues."); **Syncing…** only while a cycle runs
   AND something is waiting (an idle shop never flickers). The loop's state is a small store (`data/syncStatus.ts`) — **the loop exposed
   nothing before** (06 said "already built"; it wasn't).
5. **Sign-out warning** (16 §2): with bills that haven't reached the server, Sign out asks first — the count ("3 bills haven't reached the
   server yet — they'll stay on this phone and sync when you sign back in"), **a separate, truthful line for bills in permanent conflict**
   ("won't sync on its own" — signing back in will not fix them), and "Your bill in progress stays on this phone too" while a bill is being
   built. **Cancel** / **Sign out anyway**. With nothing unsynced it signs out at once.
6. **KB-110b loop tests:** none of the existing assertions changed. Added: offline at start sends nothing and schedules no timer; the timer
   firing after the browser went offline neither sends nor reschedules; `online` runs a cycle and resumes one timer; repeated events don't stack;
   failures feed the chip; a no-session skip is not a failure; `syncNow` offline sends nothing. The test harness's mock handlers may now be
   async (an edit during a slow push — D64) — a harness change, not an assertion.

---

## Superseded

| Date | Was | Now | Why |
|---|---|---|---|
| 3 Oct 2026 | 05 §10: keystroke → search results < 16 ms | **Lookup ≤ 16 ms; keystroke → visible results ≤ 50 ms median** (D51) | A 60 Hz frame is ~16 ms by itself; measured on a real phone. |
| 2 Oct 2026 | `geminiParseProvider.ts`: 3 attempts on a 5xx (0.5 / 1 s sleeps), no deadline | **One attempt, 6 s deadline; the shopkeeper's Retry** (D50) | 19.5 s of hidden retries can't fit an 8 s client deadline; the 5xx seen were quota. |
| 30 Sep 2026 | D45 / `05-FRONTEND-SPEC.md` §10: first (cold) tap → listening ≤ 300 ms | **≤ 1 s** (D49); warm < 100 ms unchanged | Measured: cold 816 ms, 709 of it the browser opening the device. |
| 29 Sep 2026 | D13 point 1: only a total spoken, product matched → qty 1 of the catalog's unit | **qty `null`, unit `""`** (D47) | Owner: never invent a number. |
| 21 Aug 2026 | Antigravity as the single build tool (T1) | **Claude Code** (D28) | Antigravity quota exhausted mid-`KB-000`; the docs carried the handoff at zero cost. Recorded here 26 Sep 2026. |
| 20 Aug 2026 | Feature branches, never commit to `main` (`09` §B4) | **Single branch, `main`** (D29) | Owner decision — solo developer; the ticket ID in the commit message does the branch name's job. Recorded here 26 Sep 2026. |
| 08 Sep 2026 | Banker's rounding for money (`03-DATA-MODEL.md` section 8, rev 2) | **Half-up rounding** (D11) | Owner's error, caught during `KB-003`. Predictability for the shopkeeper checking a total by hand beats statistical unbiasedness. |
| 16 Aug (r2) | Online only | **Offline + online, levels 1–2 in MVP** | Owner decision. Local-first; immutable bills make sync tractable. |
| 16 Aug (r2) | Client-side catalog threshold 5,000 | **~1,000 with current code; 10,000 after a real index** | Benchmarked. Current matcher is O(n) and unusable past ~2,000 on a budget phone. Memoising the index build does not help. |
| 16 Aug (r2) | Ship PWA, web and Android together | Web + PWA first, Android after | Owner decision |
| 16 Aug (r1) | Catalog matching moves to Postgres `pg_trgm` (Manus) | Client-side with a proper index | Per-keystroke network call; loses hand-tuned guards; **cannot work offline**, which D5 now requires |
| 16 Aug (r1) | 26 pre-build documents | 8, rest generated on trigger | Solo developer; documents' real job is being the AI's context window |
| 16 Aug (r1) | Phone OTP in MVP | Google sign-in | DLT/TRAI needs a registered business entity |
| 16 Aug (r1) | Bill-backed udhaar as core differentiator | Speed + number-trust | Vyapar, myBillBook and Busy already do itemised credit against bills |
| 16 Aug (r1) | "The category can't monetise kirana shops" | Shops do pay | OkCredit 2 lakh+ paying, profitable Nov 2025; Vyapar 1 lakh+ paying, ₹69 Cr FY25 |
