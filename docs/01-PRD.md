# 01 — Product Requirements Document

**Last updated:** 16 Sep 2026 (rev 4) · **Status:** Final · **Supersedes:** rev 3

**Rev 4 note:** S6 updated with `KB-009`'s real fast-path coverage measurement (92.8%, Phase 0
fixture data) — the number that used to be an assumption everything else in this document rested on.

---

## 1. The problem

Indian kirana shops bill by memory and paper. Existing software fails them in two specific,
observed ways:

**It's too slow at the counter.** The loudest complaint about billing apps in this market is speed
during rush hours — *"peak time par app itna hang hota hai ki bill banane me 5 minute lag jate hain…
bheed me dukan par gaali khani padti hai."* A shopkeeper with four customers waiting will abandon
any app that adds seconds per bill.

**Where voice exists, it doesn't save time.** From a shopkeeper using an existing voice billing
app: *"वॉइस एंट्री का फीचर तो दिया है, लेकिन दुकान के शोर में काम ही नहीं करता… फिर उसे मैन्युअली डिलीट करके हाथ से ही टाइप करना पड़ता है।"*
And plainly: *"It saves no time."*

That sentence is what this product exists to disprove.

---

## 2. Competitive reality (field-tested, not researched)

The author personally installed and used every voice billing app available.

| App | Downloads | Recognition | Turns to bill | Fatal weakness |
|---|---|---|---|---|
| **Pilloo** | 50K, free | **Very good** | **4–5** | Conversational. Blocks on every unknown product, asks for customer name unprompted, silently produced ₹300 for a ₹150 bill after mishearing तीस as पीस. Receipt is an A4 tax invoice with HSN/SAC and signature blocks — for ₹150 of rice. |
| **VocoBill** | 10, free | Breaks often | — | Voice unreliable. Type-ahead search is fast. |
| **Biller** | 5, ₹199/mo | Untested (paid) | — | No traction |
| **VoiceKhata** | — | — | — | Not a billing app |
| Vyapar, myBillBook, Khatabook, OkCredit, Marg, Busy, Zoho | Large | **No voice at all** | — | Voice is absent from the entire mainstream category |

**Conclusions we build on:**

1. Voice billing is genuine whitespace in the mainstream category.
2. It is empty because voice is *hard*, not because nobody thought of it.
3. Recognition is solvable — Pilloo solved it.
4. **Nobody has solved speed.** Pilloo has the best recognition in the category and still needs
   four turns, because a conversational design must stop and ask.
5. **Nobody guards numbers.** The best app in the category printed a 2× wrong total with no warning.

---

## 3. Product thesis

> **One-turn billing that never silently gets a number wrong.**

Both halves are load-bearing.

**One turn.** Speak once. Every item lands in an editable table. Unknown products are flagged and
kept, not asked about. No questions are asked mid-bill. Glance, tap to fix if needed, finalise.

**Never silently wrong about a number.** A misheard *name* is visible — the shopkeeper sees
`पैपेट` and catches it. A misheard *number* looks completely normal and goes out the door. Every
Hindi ASR model fails on numbers (a July 2026 clinical benchmark found *every single top-10 failure
was a number*), and no product in this category defends against it.

**The pitch, demonstrable in a ten-second video:** same order, one turn versus four.

---

## 4. Users

**Primary user — the shopkeeper.** Owner-operator of a grocery shop. Bills in Hindi/Hinglish.
Android phone, sometimes a laptop at the counter. Works in noise, under time pressure, with
customers waiting. Not technical. Will abandon anything slower than their current method within a week.

**Pilot shop:** the author's own family grocery shop. Real daily billing, unlimited access, no
adoption friction.

**Not users in the MVP:** staff members, accountants, wholesalers, customers.

---

## 5. MVP scope

### In

| # | Feature | Notes |
|---|---|---|
| F1 | Google sign-in | One method only. Phone OTP deferred — needs DLT/TRAI registration, which needs a registered business entity. |
| F2 | Shop setup | Name, phone, logo. Choose starting catalog: prebuilt base, or empty. |
| F3 | Catalog management | List, search, add, edit, delete, set price. Per-shop prices always. |
| F4 | **Voice billing** | The product. 5-layer pipeline. See `04-VOICE-PIPELINE.md`. |
| F5 | Manual add with type-ahead | The floor. When voice fails, this keeps the shopkeeper in the app. |
| F6 | Editable bill table | Qty, rate, total, remove, per-line review flags |
| F7 | Number safety | Loud flags on suspicious numbers. Cannot finalise unacknowledged. |
| F8 | Finalise + receipt | Image, PDF, WhatsApp. Kirana parchi format, not a tax invoice. |
| F9 | Bill history | Cloud-stored, searchable by date, amount, customer name, item |
| F10 | Learning system | Per-shop. Corrections → provisional (3 sightings) → promoted. |
| F11 | Settings | Shop details, bill language, catalog source, developer mode |

### Out — deliberately, with reasons

| Deferred | Why |
|---|---|
| **Udhaar / credit** | Loudest market pain and in every competitor — but it does not test the differentiator, which is speed. Schema stays ledger-ready. Revisit immediately post-MVP. |
| Customer database | Bills carry an optional free-text customer name. No profiles, no phone numbers. |
| Inventory / stock | Different product |
| GST | Pilot shop doesn't need it. Adding it later is additive, not structural. |
| Thermal printing | Hardware dependency, small audience initially |
| Staff accounts / roles | One user per shop in MVP. Schema carries `role` anyway. |
| Multi-store | One shop per account. Schema carries `shop_id` anyway. |
| Reports / analytics | Not why anyone switches |
| Offline **voice** | Requires on-device STT. Offline *manual* billing IS in MVP. |
| Discounts, UPI on receipt, item reordering | Post-MVP polish |

### Explicitly not in scope, ever

Cement/steel/building materials. This is a grocery product.

---

## 6. Platform

**One codebase, three surfaces.**

| Surface | How | When |
|---|---|---|
| Website | React PWA | MVP |
| Installable PWA | Manifest + install prompt | MVP |
| Android app | Capacitor wrapper around the same build, Play Store | After web MVP is validated in the pilot shop |
| iOS app | Same wrapper | Deferred — Apple charges $99/year vs Google's $25 one-time |

Must work on **both mobile and desktop**. The bill table is a table on desktop and cards on mobile
— the predecessor already does this.

---

## 7. Offline and online

MVP works **fully offline for manual billing** (levels 1-2). Voice requires network (level 3 deferred).
The app writes to IndexedDB and syncs in the background - see `02-ARCHITECTURE.md` §2.

| Condition | Required behaviour |
|---|---|
| Offline, browsing or billing manually | Everything works. Small "Offline" chip. No dialogs. |
| Network drops mid-bill | Nothing is lost. Bill finalises normally with a reserved receipt number. |
| Network returns | Chip shows "Syncing…", then clears. No user action required. |
| Voice attempted offline | Mic disabled with a one-line reason, not a silent failure. |

Losing a half-built bill because the wifi blinked is the kind of thing that gets an app deleted.

---

## 8. Success criteria

The MVP is validated when, measured over **20 consecutive real bills in the pilot shop**:

| # | Criterion | Target |
|---|---|---|
| S1 | **Median turns-to-bill** | **1** |
| S2 | **Silent number errors** | **Zero** — hard gate, non-negotiable |
| S3 | Median seconds from mic-tap to items on screen | < 2s for fast-path, < 5s otherwise |
| S4 | Zero-edit bill accuracy | ≥ 80% |
| S5 | Voice faster than typing the same bill | Yes, measured |
| S6 | Fast-path coverage (no LLM call) | ≥ 60% of utterances — **60–70% target, MEASURED at 92.8% (`KB-009`, 15 Sep 2026)** |
| S7 | Bills lost or corrupted | Zero |

**S2 is the release gate.** A billing app that is silently wrong about money is not shippable,
regardless of how good every other number looks.

**S6's 92.8% is a Phase 0 measurement, not this table's pilot number yet.** `KB-009` ran the real
deterministic parser over 125 hand-authored fixture cases (`docs/10-TRACKER.md`), not the 20
consecutive real bills this table is officially measured against — a strong signal that the cost
model and moat argument (`01-PRD.md` §"Compounding fast-path coverage") rest on real ground, not an
assumption, but not yet the pilot-validated number. Revisit once real bills exist.

---

## 9. What makes this defensible

Honest assessment, in descending order of strength.

**1. Compounding fast-path coverage + per-shop learning.** See `08-LEARNING-ENGINE.md`. The per-shop learning system feeds the deterministic parser's
vocabulary. The more a shop bills, the more utterances are handled locally — faster and cheaper
every month. A competitor launching tomorrow starts at 0% coverage and cannot buy past it; coverage
is earned per shop, per month. This is the only genuinely compounding advantage here.

**2. Shop-scoped phrase biasing.** Whisper accepts a decoding bias. A generic app must bias toward
a global catalog. We bias toward *one shop's fifty real items*. Structurally unavailable to a
competitor serving everyone from one model.

**3. One-turn discipline.** Not a feature — a set of refusals. Never block, never ask, always
degrade to search. Easy to copy in principle; requires abandoning the conversational model in
practice, which is Pilloo's entire architecture.

**4. The pricing grammar.** `wala`/`wali` = per-unit rate, `ka`/`ki` = line total. Currently unique.
Also currently **partially broken** — must be fixed before it can be claimed. Copyable in a week
once someone thinks of it.

**5. Number-safety discipline.** Cheap to copy, but nobody has, and it's the trust story.

---

## 10. Cost constraints

This is a self-funded solo project. The architecture must be cheap to run at one shop and must not
become unsellable at a hundred.

**Reference points from market research:** Vyapar ₹1,999–4,599/year, myBillBook ₹399–3,599/year.
Call the realistic ceiling **₹167–383/month** per shop.

**Design constraint:** AI cost per shop must stay under ~25% of a realistic subscription price.
At 100 bills/day that means **under ~₹40/month**, which the current LLM-every-call architecture
misses by roughly 12×. This is why the deterministic fast path is architecture, not optimisation.

---

## 11. Timeline

Honest estimate for one person, part-time, with AI writing the code:

| Phase | Work | Estimate |
|---|---|---|
| 0 | Build `domain/` + eval harness, new codebase | 3 weeks |
| 1 | Foundation: auth, shop, schema, RLS, sync | 3 weeks |
| 2 | Voice pipeline + deterministic fast path | 4 weeks |
| 3 | Billing UI, receipt, history | 3 weeks |
| 4 | Pilot hardening + 20-bill validation run | 2 weeks |
| | **Total** | **~15 weeks** |

Phase 0 comes first and is not optional. The pricing grammar is the differentiator and it currently
fails on its own test cases — carrying a broken differentiator into a new stack just makes it broken
and more expensive to fix. Phase 0 builds `domain/` **fresh** in the new stack rather than patching
the predecessor; see `07-DECISIONS.md` D9.

*This estimate has no historical basis. Re-estimate after Phase 0 actuals.*
