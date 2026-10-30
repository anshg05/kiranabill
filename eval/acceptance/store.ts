import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedItem } from "../../src/domain/grammar.js";
import type { AcceptanceOrder } from "./types.js";

// KB-364: where the acceptance orders live. COMMITTED: orders.json (the owner's words, the frozen Whisper text, the expected bills),
// recorded.json (the exact lines Gemini answered, replayed offline) and sheet.txt. NOT committed: audio/ (the owner's voice).

export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const AUDIO_DIR = path.join(DIR, "audio");
export const SHEET = path.join(DIR, "sheet.txt");
const ORDERS = path.join(DIR, "orders.json");
const RECORDED = path.join(DIR, "recorded.json");

/** The release gate needs at least this many orders once the set is frozen. */
export const MIN_FROZEN_ORDERS = 40;

export interface OrdersFile {
  /** true once the owner froze the set (accept:live --freeze with enough orders): from then on the full gate is enforced in `npm test`. */
  readonly frozen: boolean;
  readonly orders: readonly AcceptanceOrder[];
}

/** Layer 2's answers, keyed by the exact text it was asked; null = Layer 2 failed for that text. */
export type Recorded = Readonly<Record<string, readonly ParsedItem[] | null>>;

export function readOrders(): OrdersFile {
  return existsSync(ORDERS) ? (JSON.parse(readFileSync(ORDERS, "utf8")) as OrdersFile) : { frozen: false, orders: [] };
}
export function writeOrders(file: OrdersFile): void {
  writeFileSync(ORDERS, JSON.stringify(file, null, 2) + "\n");
}
export function readRecorded(): Recorded {
  return existsSync(RECORDED) ? (JSON.parse(readFileSync(RECORDED, "utf8")) as Recorded) : {};
}
export function writeRecorded(recorded: Recorded): void {
  writeFileSync(RECORDED, JSON.stringify(recorded, null, 2) + "\n");
}
export function ensureAudioDir(): void {
  mkdirSync(AUDIO_DIR, { recursive: true });
}
