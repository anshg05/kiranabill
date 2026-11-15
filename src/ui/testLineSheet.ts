import { flushSync } from "react-dom";
import { screen, within, type BoundFunctions, type queries } from "@testing-library/react";

// KB-413 step 1 (owner, answer 9): a line's editors (quantity, unit, rate, amount, Change item, Remove) live in its edit sheet, opened
// by the line's "Edit <name>" button. Tests that used to reach them in the desktop table (gone - D110 8.11) open the sheet instead:
// `lineSheet("Chini amount")` opens Chini's sheet (if it is not already the open one) and returns it to query in.
const FIELD = / (quantity|rate|amount|unit)$/;
export const lineName = (labelOrName: string) => labelOrName.replace(FIELD, "").replace(/^(Change item|Remove) /, "");

export function lineSheet(labelOrName: string) {
  const name = lineName(labelOrName);
  const open = screen.queryByRole("dialog", { name: `Edit ${name}` });
  if (open) return within(open);
  // flushSync: many tests call this inside their own act(), which would hold the sheet back until it ends
  flushSync(() => screen.getByRole("button", { name: `Edit ${name}` }).click());
  return within(screen.getByRole("dialog", { name: `Edit ${name}` }));
}

type Queries = BoundFunctions<typeof queries>;
const EDITOR = /( (quantity|rate|amount|unit)$)|(^(Change item|Remove) )/;

/** Where today's tests used `within(screen.getByRole("table"))`: a query for a line's editor ("Chini amount", "Remove Chini") is
 *  answered in that line's edit sheet (opened if needed); any other query (an error under an editor, a name, a check) on the whole
 *  screen - the cards AND an open sheet - so "it is gone" can never pass just because a sheet hides the cards. */
export function billQueries(): Queries {
  return new Proxy({} as Queries, {
    get: (_t, method: string) =>
      (...args: unknown[]) => {
        const opts = args[1] as { name?: unknown } | undefined;
        const name = typeof opts?.name === "string" ? opts.name : null;
        const scope: Queries = name && EDITOR.test(name) ? lineSheet(name) : within(document.body);
        return (scope as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!(...args);
      },
  });
}

/** Like lineSheet, for the n-th line of that name (two lines can share one). */
export function nthLineSheet(labelOrName: string, n: number) {
  const name = lineName(labelOrName);
  flushSync(() => screen.getAllByRole("button", { name: `Edit ${name}` })[n]!.click());
  return within(screen.getByRole("dialog", { name: `Edit ${name}` }));
}
