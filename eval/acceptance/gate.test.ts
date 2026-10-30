import { describe, expect, it } from "vitest";
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { compareOrder, gate } from "./compare.js";
import { replayLayer2, runOrder } from "./run.js";
import { MIN_FROZEN_ORDERS, readOrders, readRecorded } from "./store.js";

// KB-364 (owner, 30 Oct 2026): the PERMANENT release gate, tier A - offline, free, deterministic. Every acceptance order the owner
// recorded: its FROZEN Whisper text through the shipped resolver, Gemini's RECORDED answer replayed where Layer 2 is asked, compared
// with the bill the owner wrote. Once the set is locked a wrong line fails at any time; the full gate (>= 90% exact, no unexpected check, >= 40 orders) is
// enforced once the set is frozen. Tier B (`npm run accept:live`) does the same from the AUDIO, live, before a release.

const { frozen, orders } = readOrders();
const recorded = readRecorded();
const ready = orders.filter((o) => !!o.transcript);

describe("acceptance orders, tier A (frozen text + recorded Gemini answers)", () => {
  if (ready.length === 0) {
    it("no acceptance orders yet - record them with ?session=1 on a draft (docs/23-ACCEPTANCE.md)", () => {
      expect(frozen).toBe(false);
    });
    return;
  }

  const verdicts = new Map<string, Awaited<ReturnType<typeof evaluate>>>();
  async function evaluate(o: (typeof ready)[number]) {
    const actual = await runOrder(o.transcript!, replayLayer2(recorded));
    return compareOrder(o.id, o.expected, actual, SEED_PARSER_CATALOG);
  }

  // Before the set is LOCKED (owner: only after his review and a passing run) the orders are REPORTED, not enforced - `npm run accept:report`
  // prints each one in plain words. Once locked, a wrong line fails here, at any time.
  it.each(ready.map((o) => [o.id, o] as const))(frozen ? "%s: no wrong line" : "%s: evaluated (not enforced until the set is locked)", async (_id, o) => {
    const v = await evaluate(o);
    verdicts.set(o.id, v);
    if (frozen) expect(v.wrong, `${o.id} (${o.category}) "${o.transcript}"`).toEqual([]);
  });

  it(frozen ? "the full gate: >= 90% exact, no unexpected check, enough orders" : "the full gate is reported (it becomes a hard stop when the set is frozen)", async () => {
    const all = await Promise.all(ready.map(evaluate));
    const g = gate(all);
    if (!frozen) {
      console.info(`[acceptance] not frozen yet: ${g.exact}/${g.total} exact, ${g.wrongLines} wrong, ${g.unexpectedCheckOrders} unexpected-check orders`);
      return;
    }
    expect(ready.length, "a frozen set must hold enough orders").toBeGreaterThanOrEqual(MIN_FROZEN_ORDERS);
    expect(g.reasons, all.filter((v) => !v.exact).map((v) => v.id).join(" ")).toEqual([]);
  });
});
