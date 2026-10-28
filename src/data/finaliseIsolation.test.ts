import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// KB-352 (owner, 28 Oct 2026): Bill Banao's path - the number, the one local write, the receipt read - must not be able to wait on learning,
// the catalog, sync, metrics or the share files: none of them may even be imported by it. (A plant that imports one of them fails here.)

const read = (f: string) => readFileSync(join(__dirname, "..", "..", f), "utf8");
const FORBIDDEN = /from "(?:\.\/|@\/data\/|\.\.\/data\/)(learnBill|sync|aliasEvidence|shopCatalog|pullLearning|billMetrics|phaseTimings|catalogPullStatus)"/;

describe("the save path imports nothing that runs after the receipt", () => {
  for (const f of ["src/data/finalise.ts", "src/data/receipt.ts", "src/data/receiptNumbers.ts", "src/ui/useFinalise.ts"]) {
    it(f, () => {
      const imports = read(f).split("\n").filter((l) => l.startsWith("import "));
      expect(imports.filter((l) => FORBIDDEN.test(l)), f).toEqual([]);
    });
  }
});
