# 12 — Parked

**Last updated:** 14 Sep 2026 (rev 8)

Everything deliberately not being done now. Four sections, one file.

**Purpose:** an idea that arrives mid-ticket gets written here and the current work continues. This
is the mechanism that stops scope creep without losing good ideas.

> **Split this file** into `KNOWN_ISSUES.md`, `SUGGESTIONS.md` and `NOT_YET_INVESTIGATED.md` when it
> passes ~500 lines. That is what happened on SolarOps, and splitting earlier is premature.

---

## A. Known issues

Confirmed problems, not yet fixed. Each has a ticket or an explicit reason for waiting.

| # | Issue | Severity | Ticket | Notes |
|---|---|---|---|---|
| KI-01 | API keys exposed in distributed `.env.local`; `.gitignore` doesn't exclude it | **HIGH** | KB-001 | Ignore file first, then rotate |
| KI-02 | ~~`includes("bas")` finalises the bill on "basmati". 8 aliases across 5 products collide.~~ | **HIGH** | KB-002 | **Closed 14 Sep 2026.** `domain/commands.ts` matches whole tokens/token-sequences only, never a substring of a longer token, plus a no-digit and a ≤6-token guard. Regression test asserts `matchCommand("basmati")` and `matchCommand("basmati chawal")` are both `null`; a full sweep of all 482 catalog aliases asserts zero trigger any command. |
| KI-03 | Pricing grammar fails `ka`/`wala`. VC013 "5 kg chawal 30 ka" → ₹100 instead of ₹30 | **HIGH** | KB-005 | This is the differentiator |
| KI-04 | Default-price path broken — VC001, VC009 return rate null, total 0 | **HIGH** | KB-005 | Same root area |
| KI-05 | Eval: 12 of 25 cases never run; fixtures hardcode stale prices and dead display names | HIGH | KB-004 | Guards nothing in current state |
| KI-06 | `buildBillHTML()` doesn't escape interpolated values — `displayName`, shop name, customer name go raw into `innerHTML` | MEDIUM | KB-308 | Self-XSS now; stored XSS once server-side |
| KI-07 | Learning scope defaults to `"global"` — every device shares one pool | MEDIUM | KB-209 | Silent multi-tenancy break |
| KI-08 | Receipt rounds per line **and** on the sum, so lines visibly don't add up | MEDIUM | KB-308 | Round once, at line level |
| KI-09 | Bill history has no `schema_version` — any item-shape change breaks old bills | MEDIUM | KB-103 | Fixed by the new schema |
| KI-10 | No bill number; `id: Date.now()` | MEDIUM | KB-111 | Prerequisite for disputes and GST |
| KI-11 | `getBestCatalogMatch()` is an O(n) scan — ~106 ms/keystroke at 5,000 products on a budget phone | MEDIUM | KB-201 | Blocker for type-ahead |
| KI-12 | `buildValidatorCatalog()` rebuilds the whole index on every lookup | LOW | KB-201 | Memoising alone doesn't fix KI-11 — the scan dominates |
| KI-13 | Bill Language setting saved to `kb_billLang`, never read by `buildBillHTML()` | LOW | KB-308 | Ghost feature |
| KI-14 | No `inputmode="decimal"` on qty/rate inputs | LOW | KB-303 | |
| KI-15 | No loading state during mic permission request | LOW | KB-302 | |
| KI-16 | `BILL_UNITS` in `app.js` includes `bag`; the manual-add dropdown doesn't | LOW | KB-305 | Small drift, symptom of no single source |
| KI-17 | ~~`eval/voice-cases.json` stores rupees as decimals, not integer paise~~ (e.g. VC010 `"total": 112.5`) | MEDIUM | KB-004 | **Closed 14 Sep 2026.** Every `expectedItem` now carries a `catalogId`, hand-resolved against `src/domain/catalog.ts`. `priceType: "default"` items no longer store `rate`/`total` at all — `eval/run-eval.ts` derives them from the live catalog every run via `lineTotalPaise()`. Remaining literal spoken `rate`/`total` are integer paise. Confirmed the drift was real, not theoretical: VC001's Chini is 4500 paise (₹45) live, the fixture had hardcoded 43. |
| **KI-18** | `legacy/README.md` missing — required by `15-BUILD-GUIDE.md` §3 Step 4 | LOW | — | Create it. Content is in the build guide. |
| **KI-19** | Mukta set as `--font-body`, not `--font-sans`, so Tailwind's system stack stays the default and every component must opt in | LOW | KB-301 | Fix when Phase 3 starts. See `13-DESIGN.md` §8. |

**Note on section A:** these were found in the predecessor. Since Phase 0 rebuilds `domain/` rather
than patching it, most are now **"must not be reintroduced"** rather than "must be fixed." Each is
covered by a test in the new code. KI-01 (exposed keys) is the exception — it is a live risk today
and independent of the rewrite.

---

## B. Deferred features

Decided against for MVP, with the reason and the trigger to reconsider.

| Feature | Why deferred | Reconsider when |
|---|---|---|
| **Udhaar / credit ledger** | Loudest validated market pain and in every competitor — but it does not test the differentiator, which is speed. Schema stays ledger-ready. | **Immediately post-MVP. Highest-value next feature.** |
| Customer database | Comes with udhaar. Bills already carry name + mobile so existing data can be matched in. | With udhaar |
| Offline voice (level 3) | Needs on-device STT | After Web Speech evaluation |
| Multi-device concurrent editing (level 4) | Real conflict resolution; not needed for one counter | A shop has two counters |
| Staff accounts and roles | One user per shop in MVP. Schema carries `role`. | A shop has employees |
| Multi-store | One shop per account. Schema carries `shop_id`. | An owner has two shops |
| Inventory / stock | Different product | Explicit demand |
| GST | Pilot shop doesn't need it; additive later, not structural | A shop asks |
| Thermal printing | Hardware dependency | A real shop asks |
| Reports / analytics | Not why anyone switches | Post-MVP |
| UPI link on receipt | Two lines of code, but not a differentiator | Post-MVP polish |
| Discounts | Post-MVP | Post-MVP |
| Item reordering on the bill | Cosmetic | Post-MVP |
| Quick-add frequent items row | Learning system may make this redundant | After learning data exists |
| iOS app | $99/year vs Android's $25 one-time | Android proves the wrapper |
| Server-side catalog search | Only needed above 10,000 products | A shop exceeds it |
| Self-hosted STT | Break-even ≈54 busy shops | ~50 shops |

---

## C. Suggestions and ideas

Unvalidated. Recorded so they aren't lost, **not** commitments.

| # | Idea | Origin | Assessment |
|---|---|---|---|
| SG-01 | "Same as last time" — regenerate a regular customer's usual basket by voice or one tap | Earlier planning | Genuinely good, and only possible because we're voice-first with purchase history. Needs customers, so it lands with udhaar. |
| SG-02 | Frictionless customer capture — track a spoken name silently, offer to save it after it recurs | Earlier planning | Solves real onboarding friction. UX refinement, not a moat. |
| SG-03 | Shop logo on the receipt | Predecessor half-built it | In `KB-107` (upload) and `KB-308` (render) |
| SG-04 | Debug panel toggle in settings | Already done in the predecessor | Carry forward as Developer Mode |
| SG-05 | Show a running total as items are spoken, before finalising | New | Cheap, and reinforces number-trust. Consider for `KB-301`. |
| SG-06 | Read the total back aloud after parsing ("teen sau paachas rupay") | New | Could catch number errors through a second channel. Interesting; test after the number benchmark exists. |
| SG-07 | Per-shop confidence tuning — a shop with clean speech gets looser thresholds | New | Premature. Needs data from multiple shops. |
| SG-08 | Export bills to Excel/CSV for a CA | Market research — myBillBook users complained loudly about Tally export | Cheap, real pain. Post-MVP. |

---

## D. Not yet investigated

Open questions. Each has a trigger.

| # | Question | Why it matters | Investigate before |
|---|---|---|---|
| **NI-01** | **What fast-path coverage is actually achievable?** | The cost model, latency story and moat argument all assume 60–70%. Never measured. If it's 30%, the economics change materially. | **`KB-008`, in Phase 0** |
| NI-02 | Why was the earlier fast-path regex experiment rolled back? (O3) | If it was rolled back for accuracy, that's a real signal | `KB-207` |
| NI-03 | Sarvam Saarika pricing (O2) | Best reported code-switch accuracy, India residency, no public price | Phase 2 |
| NI-04 | Does Pilloo implement `ka`/`wala`? (O4) | If it does, differentiator #4 is void | Claiming the grammar publicly |
| NI-05 | Does Web Speech API match Whisper on real utterances? | Free, on-device, offline-capable — but no vocabulary hints | Phase 2 |
| NI-06 | Does trimming the catalog slice from 80 to 30 products hurt parse accuracy? | Direct cost reduction if not | `KB-205` |
| NI-07 | Does Gemini context caching actually apply to our static grammar block? | 43% of every prompt is byte-identical | `KB-205` |
| NI-08 | Real bills/day and catalog size at the pilot shop | Every performance and cost assumption is calibrated on guesses | Phase 4 |
| NI-09 | Which competitor did the market-research quotes actually come from? | Some quoted "user complaints" showed signs of fabrication — a source with a citation but no quote text | Before using any of it externally |
| NI-10 | ~~Tailwind or port the CSS?~~ | **Closed 17 Aug** — Tailwind. See SD-011. | — |
| NI-14 | ~~Where does `base_products.category` come from?~~ | **Closed 08 Sep**, during `KB-003` — it's positional, not a stored field or a guard-derived guess: `legacy/products.js` groups products under 48 comment headers, and `scripts/build-catalog-seed.ts` assigns each product the header it falls under. See `14-LEGACY-REFERENCE.md` section 9. | — |
| **NI-11** | **Barcode scanning for packaged goods** | The shop is 500+ SKUs and mart-like. For *packaged* goods with printed barcodes, a camera scan beats voice decisively. Voice's real advantage is **loose goods sold by weight** — dal, rice, atta, sugar — where there is no barcode to scan. A serious grocery product probably needs both eventually. | After MVP pilot. Do not add to MVP. |
| **NI-13** | **Graphify — knowledge graph over the codebase** | Claims 70–90% token reduction by letting an agent query a graph instead of scanning files. **Unverified:** postdates this documentation set; licence, maintenance status and whether it uploads code are all unknown — check before installing. Not useful at Phase 0 (no code yet), and the 17-doc set is already a curated context layer. | **Phase 3**, when `src/` is large enough that the agent misses cross-file relationships |
| **NI-12** | **Is the target a kirana or a grocery mart?** | Owner describes 100+ bills/day, 500+ products, "like DMart/JioMart". That is materially larger than a corner kirana and changes assumptions about counters, staff, and barcode need. The MVP is unaffected; the *positioning* may be. | Phase 4 |
| **NI-20** | **Claude Code launched a session in `.claude/worktrees/` instead of the main checkout, breaking the single-branch workflow and costing a manual conflict merge.** No config flag found in project `.claude/`, `~/.claude/settings.json`, or `~/.claude/.claude.json`. Likely a harness-level feature (SDK Agent tool isolation, or a desktop-app session isolation toggle) that runs before CLAUDE.md loads. | **Trigger:** check the desktop app's new-session settings before the next multi-session task. |
| **NI-21** | **`domain/grammar.ts` (`KB-005`) resolves a self-contradiction in the qty/unit-when-no-quantity-spoken rule.** `docs/14-LEGACY-REFERENCE.md` section 1 (the verbatim old Gemini prompt, used as-is by Layer 2 / `KB-205`) still has the original contradiction. When `KB-205` builds the LLM fallback, the prompt text must be updated to match `grammar.ts`'s resolution, or Layer 1 and Layer 2 can disagree on identical input. | **Trigger:** before `KB-205`. |

---

## How to use this file

- **Bug found mid-ticket** → section A, keep working
- **Idea mid-ticket** → section C, keep working
- **Something you don't understand** → section D with a trigger, keep working
- **Deciding not to build something** → section B with a reason and a trigger

Nothing gets deleted. Items move: D → A when confirmed, C → a ticket when adopted, A → closed when
fixed (with the date). The history of what you chose *not* to do is as valuable as what you built —
it stops the same idea being re-argued every three months.
