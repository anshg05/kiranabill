import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, runBackup, type BackupConfig } from "./backup";

// KB-407: a public key whose private half was never saved AND proven makes every backup a trap. setup-key.sh writes
// `keyConfirmed: true` only after the owner opened a test note with the real key (stage 4); the backup refuses without it.

let dir: string;
const base = { driveFolder: "X:\\drive", recipient: "A".repeat(40) };
const write = (extra: Record<string, unknown>) => {
  const file = join(dir, `c${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify({ ...base, ...extra }));
  return file;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kbc-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the backup key must be confirmed", () => {
  it("loadConfig refuses a config with no keyConfirmed", () => {
    expect(() => loadConfig({ KB_BACKUP_CONFIG: write({}) })).toThrow(/never confirmed|not confirmed/i);
  });
  it("loadConfig refuses keyConfirmed: false and anything that is not literally true", () => {
    for (const v of [false, "true", 1, null]) expect(() => loadConfig({ KB_BACKUP_CONFIG: write({ keyConfirmed: v }) }), String(v)).toThrow(/confirmed/i);
  });
  it("loadConfig accepts keyConfirmed: true", () => {
    expect(loadConfig({ KB_BACKUP_CONFIG: write({ keyConfirmed: true }) }).recipient).toBe(base.recipient);
  });
  it("runBackup refuses an unconfirmed key even when called directly - before touching Docker, the CLI or any folder", async () => {
    const cfg = { ...base, gpgExe: "gpg", gnupgHome: dir, stateDir: dir, spoolDir: join(dir, "s"), keyConfirmed: false } as BackupConfig;
    await expect(runBackup(cfg, { source: "local" })).rejects.toThrow(/confirmed/i);
  }, 60_000);
});
