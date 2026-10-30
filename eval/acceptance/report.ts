/**
 * KB-364: the acceptance gate, replayed OFFLINE and printed in plain words - no Groq, no Gemini, nothing spent.
 *     npm run accept:report
 * Uses the frozen Whisper text (orders.json) and Gemini's recorded answers (recorded.json) from the last `accept:live -- --freeze`.
 * Per order: exact / inexact (why) / WRONG (why, and whether a Theek hai warned about it).
 */
import { SEED_PARSER_CATALOG } from "../../src/domain/seedCatalog.js";
import { compareOrder, gate } from "./compare.js";
import { replayLayer2, runOrder } from "./run.js";
import { readOrders, readRecorded } from "./store.js";

const { orders, frozen } = readOrders();
const recorded = readRecorded();
const ready = orders.filter((o) => !!o.transcript);
console.log(`accept:report - ${ready.length} order(s) with a frozen text (${frozen ? "set LOCKED" : "set not locked yet"}); nothing is called`);

const verdicts = [];
for (const o of ready) {
  let v;
  try {
    v = compareOrder(o.id, o.expected, await runOrder(o.transcript!, replayLayer2(recorded)), SEED_PARSER_CATALOG);
  } catch (e) {
    console.log(`ERROR ${o.id}: ${(e as Error).message}`);
    continue;
  }
  verdicts.push(v);
  const tag = v.wrong.length ? "WRONG  " : v.exact ? "exact  " : "inexact";
  console.log(`${tag} ${o.id} ${o.category}: "${o.transcript!.slice(0, 90)}"`);
  for (const w of v.wrong) console.log(`           ! ${w}`);
  for (const m of v.missing) console.log(`           - ${m}`);
  for (const x of v.inexact) console.log(`           ~ ${x}`);
  if (!v.notAddedOk) console.log(`           ~ the number of "Not added" pieces differs`);
  if (v.unexpectedChecks) console.log(`           ~ more Theek hai checks than accepted`);
}
const g = gate(verdicts);
console.log(`\n${g.exact}/${g.total} exact; ${g.wrongLines} wrong line(s) (${g.silentWrongLines} with NO warning); ${g.unexpectedCheckOrders} order(s) with unexpected checks`);
console.log(g.passed ? "PASSED" : `NOT passed - ${g.reasons.join("; ")}`);
