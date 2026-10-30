/**
 * KB-364: eval/acceptance/sheet.txt -> eval/acceptance/orders.json (the file the gate reads).
 *     npm run accept:build
 * A sheet error stops it and leaves orders.json as it was; a frozen transcript survives a rebuild.
 */
import { existsSync, readFileSync } from "node:fs";
import { CATEGORIES } from "../../src/acceptance/categories.js";
import { SHEET, readOrders, writeOrders } from "./store.js";
import { buildOrders } from "./tools.js";

if (!existsSync(SHEET)) {
  console.error("eval/acceptance/sheet.txt does not exist yet - run npm run accept:import first");
  process.exit(1);
}
const r = buildOrders(readFileSync(SHEET, "utf8"), readOrders());
if (!r.file) {
  console.error("The sheet has errors - orders.json was NOT changed:");
  for (const e of r.errors) console.error(`  ${e}`);
  process.exit(1);
}
writeOrders(r.file);
console.log(`orders.json: ${r.file.orders.length} order(s) ready${r.pending.length ? `, ${r.pending.length} block(s) still empty (${r.pending.join(", ")})` : ""}.`);
for (const c of CATEGORIES) {
  const n = r.file.orders.filter((o) => o.category === c.id).length;
  console.log(`  ${n === c.count ? "ok " : "-- "} ${c.title}: ${n}/${c.count}`);
}
for (const s of r.skipped) console.log(`  skipped ${s.id}: ${s.reason}`);
console.log(`${r.file.orders.filter((o) => !!o.transcript).length} have a frozen transcript. Next: npm run accept:live -- --freeze`);
