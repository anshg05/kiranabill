# 07 — Decision Log

**Last updated:** 18 Sep 2026 (rev 12) · Supersedes rev 11

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

## Superseded

| Date | Was | Now | Why |
|---|---|---|---|
| 08 Sep 2026 | Banker's rounding for money (`03-DATA-MODEL.md` section 8, rev 2) | **Half-up rounding** (D11) | Owner's error, caught during `KB-003`. Predictability for the shopkeeper checking a total by hand beats statistical unbiasedness. |
| 16 Aug (r2) | Online only | **Offline + online, levels 1–2 in MVP** | Owner decision. Local-first; immutable bills make sync tractable. |
| 16 Aug (r2) | Client-side catalog threshold 5,000 | **~1,000 with current code; 10,000 after a real index** | Benchmarked. Current matcher is O(n) and unusable past ~2,000 on a budget phone. Memoising the index build does not help. |
| 16 Aug (r2) | Ship PWA, web and Android together | Web + PWA first, Android after | Owner decision |
| 16 Aug (r1) | Catalog matching moves to Postgres `pg_trgm` (Manus) | Client-side with a proper index | Per-keystroke network call; loses hand-tuned guards; **cannot work offline**, which D5 now requires |
| 16 Aug (r1) | 26 pre-build documents | 8, rest generated on trigger | Solo developer; documents' real job is being the AI's context window |
| 16 Aug (r1) | Phone OTP in MVP | Google sign-in | DLT/TRAI needs a registered business entity |
| 16 Aug (r1) | Bill-backed udhaar as core differentiator | Speed + number-trust | Vyapar, myBillBook and Busy already do itemised credit against bills |
| 16 Aug (r1) | "The category can't monetise kirana shops" | Shops do pay | OkCredit 2 lakh+ paying, profitable Nov 2025; Vyapar 1 lakh+ paying, ₹69 Cr FY25 |
