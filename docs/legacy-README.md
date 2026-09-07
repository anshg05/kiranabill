# legacy/

**Reference material, not source code.**

- **Never imported** by `src/`
- **Never built, linted, or tested** — excluded in `tsconfig.json`
- **Never edited**

This is the predecessor: `KiranaBill-Phase1-Fixed`, ~9,000 lines of vanilla JS. It worked. It
produced real bills. Its implementation is not being carried forward — only its knowledge.

## Read this instead

**`docs/14-LEGACY-REFERENCE.md`** already extracts everything worth keeping, as specification:

- The complete Gemini pricing-grammar prompt, verbatim (the Layer 2 spec)
- `HINDI_NUMBERS` and `HINDI_FRACTIONS`
- The 16 mishearing normalisation rules
- The six category guards, with every keyword
- Length-scaled matching thresholds and phonetic variants
- The 11 review reason codes, plus the new number-safety codes
- Unit handling and rate-basis inference
- The 8 known defects that must not be reintroduced

Come here only when that document isn't enough.

## What's in here

| File | Use |
|---|---|
| `products.js` | **Seed data.** 482 products, ids 1–634, Hindi/Latin/Devanagari aliases → `base_products` |
| `voice.js` | Source of the Gemini prompt and the normalisation rules (both already extracted) |
| `validator.js` | Source of the category guards and thresholds (already extracted) |
| `learning-store.js` | Three-tier learning design → `docs/08-LEARNING-ENGINE.md` |
| `billing-ui.js`, `styles.css`, `index.html`, `app.js` | Discarded. Replaced by React + Tailwind. |
| `netlify/functions/` | Discarded. Replaced by one `/voice` endpoint. |
| `netlify/functions/.learning-sync-store.json` | Real learning data under a `"global"` scope — live evidence of `KI-07`, the multi-tenancy bug the new schema fixes |
| `eval-old/` | The 25 voice cases and their stale results |
| `local-dev-server.js` | Discarded. Vite handles this. |

## Why it's kept at all

Two reasons. `products.js` is genuine seed data that must be imported once. And when a hand-tuned
rule in `docs/14-LEGACY-REFERENCE.md` looks arbitrary, the original code shows the case it was
written for.

That's it. Nothing here runs.
