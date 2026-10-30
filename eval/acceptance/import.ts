/**
 * KB-364: put the owner's phone recordings on the PC.
 *     npm run accept:import                      (no file: creates the sheet template)
 *     npm run accept:import -- path/to/kb-acceptance-2026-10-30.json
 * Writes each clip to eval/acceptance/audio/<A-number>.<ext> (git-ignored: it is the owner's voice) and adds a block to
 * eval/acceptance/sheet.txt for every slot that has none yet - never touching a block already filled in.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CATEGORIES, slots } from "../../src/acceptance/categories.js";
import { extensionFor, parseSessionFile } from "../../src/acceptance/sessionFile.js";
import { AUDIO_DIR, SHEET, ensureAudioDir } from "./store.js";
import { addMissingBlocks } from "./tools.js";

const file = process.argv[2];
if (!file) {
  // no file: just make sure the sheet exists with a block for every slot (fill it in while you record)
  writeFileSync(SHEET, addMissingBlocks(existsSync(SHEET) ? readFileSync(SHEET, "utf8") : ""));
  console.log("eval/acceptance/sheet.txt is ready - one block per order, A01..A50. To import a phone session:  npm run accept:import -- <file>");
  process.exit(0);
}
const session = parseSessionFile(readFileSync(file, "utf8")); // refuses a bad file before anything is written
ensureAudioDir();
for (const clip of session.clips) {
  for (const old of readdirSync(AUDIO_DIR).filter((f) => f.startsWith(`${clip.id}.`))) rmSync(path.join(AUDIO_DIR, old)); // a re-record replaces
  writeFileSync(path.join(AUDIO_DIR, `${clip.id}.${extensionFor(clip.mime)}`), Buffer.from(clip.audioBase64, "base64"));
}
const sheet = addMissingBlocks(existsSync(SHEET) ? readFileSync(SHEET, "utf8") : "");
writeFileSync(SHEET, sheet);

const have = new Set(readdirSync(AUDIO_DIR).map((f) => f.split(".")[0]));
console.log(`Imported ${session.clips.length} clip(s) from ${path.basename(file)} into eval/acceptance/audio/ (${have.size} of ${slots().length} recorded in all).`);
for (const c of CATEGORIES) {
  const mine = slots().filter((s) => s.category === c.id);
  const got = mine.filter((s) => have.has(s.id)).length;
  console.log(`  ${got === c.count ? "ok " : "-- "} ${c.title}: ${got}/${c.count}${got < c.count ? `  (missing ${mine.filter((s) => !have.has(s.id)).map((s) => s.id).join(", ")})` : ""}`);
}
console.log("\nNext: fill in eval/acceptance/sheet.txt, then  npm run accept:build");
