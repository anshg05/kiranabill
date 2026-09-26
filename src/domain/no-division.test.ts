import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as ts from "typescript";

/**
 * KB-005f (docs/12-PARKED.md KI-30, docs/07-DECISIONS.md D11/D36). The
 * money path must never divide: KI-30 was `Math.round(pricePaise / 1000)`
 * in grammar.ts - a per-gram rate rounded to whole paise, then multiplied,
 * so "500 gram chini" billed Rs.25 instead of Rs.22.50. Every scale change
 * between gm<->kg and ml<->liter is a factor of 1000, so it is done by
 * integer multiplication and decimal-string shifting in money.ts, like
 * roundMilliPaiseHalfUp - never by `/`.
 *
 * money.no-float.test.ts scans money.ts as text. That approach can't be
 * extended to grammar.ts or reviewFlags.ts: both contain regex literals
 * (e.g. /\baur\b/i, /[.,!?]/g) whose slashes a text scan can't tell from a
 * division operator. This test parses each file with the TypeScript
 * compiler API (typescript is already a devDependency - no new dependency)
 * and inspects real syntax nodes: any `/` or `/=` binary expression, or a
 * parseFloat call, fails it - comments, strings and regex literals can't
 * trigger it.
 */

const domainDir = path.dirname(fileURLToPath(import.meta.url));
const MONEY_PATH_FILES = ["money.ts", "grammar.ts", "reviewFlags.ts"] as const;

function findForbidden(fileName: string): string[] {
  const source = readFileSync(path.join(domainDir, fileName), "utf8");
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];

  const lineOf = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.SlashToken || op === ts.SyntaxKind.SlashEqualsToken) {
        found.push(`${fileName}:${lineOf(node)} division: ${node.getText(sourceFile)}`);
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile).endsWith("parseFloat")) {
      found.push(`${fileName}:${lineOf(node)} parseFloat: ${node.getText(sourceFile)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("money path has no division (KB-005f, KI-30) - TypeScript AST scan", () => {
  for (const fileName of MONEY_PATH_FILES) {
    it(`${fileName} contains no / or /= operator and no parseFloat`, () => {
      expect(findForbidden(fileName)).toEqual([]);
    });
  }

  it("the scan itself detects a real division and ignores regex literals, comments and strings", () => {
    const probe = "const a = 10 / 2; const r = /x\\/y/g; // 1 / 2\nconst s = '3 / 4';";
    const sf = ts.createSourceFile("probe.ts", probe, ts.ScriptTarget.Latest, true);
    const divisions: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.SlashToken) {
        divisions.push(node.getText(sf));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(divisions).toEqual(["10 / 2"]);
  });
});
