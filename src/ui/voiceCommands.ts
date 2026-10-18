import type { BillCommand } from "@/domain/commands";

// KB-339 (D86, owner): what a spoken command does. domain/commands.ts (KB-002) decides WHAT was said - the whole
// utterance only; this says what the bill does about it. No command ever finalises by voice (Bill Banao is a deliberate
// tap, gated by the pending checks) and none clears the bill.

export const COMMAND_FINISH_HINT = "Tap Bill Banao to finish";
export const COMMAND_CLEAR_HINT = "To clear the whole bill, use the menu → Clear bill";
export const COMMAND_NOTHING_TO_REMOVE = "Nothing to remove";

/** Returns the one-line answer to show, or null when the bill's own Undo strip already says it. */
export function runBillCommand(command: BillCommand, rows: readonly { readonly id: string }[], remove: (id: string) => void): string | null {
  if (command === "finalize") return COMMAND_FINISH_HINT;
  if (command === "clearAll") return COMMAND_CLEAR_HINT;
  const last = rows[rows.length - 1];
  if (!last) return COMMAND_NOTHING_TO_REMOVE;
  remove(last.id); // the existing one-level Undo brings it back
  return null;
}
