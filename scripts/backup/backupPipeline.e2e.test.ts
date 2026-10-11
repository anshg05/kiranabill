import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gpgPath, runBackup, type BackupConfig } from "./backup";
import { parseBackupName } from "./backupCore";
import { rehearse } from "./rehearseRestore";

/**
 * KB-407 (D75): the whole backup pipeline against the LOCAL stack, with a THROWAWAY key - the real one exists only
 * with the owner. dump -> scan -> gzip -> gpg (public key only) -> files -> retention, then the restore rehearsal:
 * decrypt with the private key, load into a scratch database, compare every table's row count.
 * Needs `npx supabase start` and Docker (the CLI dumps in a container). Run: `npm run test:e2e`.
 * (Short temp paths on purpose: gpg-agent's socket path has a length limit.)
 */

const GPG = "C:\\Program Files\\Git\\usr\\bin\\gpg.exe";
const gpg = (home: string, args: string[]) => spawnSync(GPG, ["--homedir", gpgPath({ gpgExe: GPG }, home), "--batch", "--no-tty", ...args], { encoding: "utf8" });

describe("KB-407 encrypted backup + restore rehearsal - real local stack", () => {
  let root: string;
  let cfg: BackupConfig;
  let fullHome: string;
  const drive = () => cfg.driveFolder;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "kbt-"));
    fullHome = join(root, "full");
    const pubHome = join(root, "pub");
    for (const d of [fullHome, pubHome, join(root, "drive"), join(root, "state")]) mkdirSync(d, { recursive: true });
    const gen = gpg(fullHome, ["--passphrase", "", "--quick-generate-key", "kb-test <kbtest@example.invalid>", "default", "default", "never"]);
    if (gen.status !== 0) throw new Error(`could not make a throwaway key: ${gen.stderr}`);
    const fpr = gpg(fullHome, ["--list-keys", "--with-colons"]).stdout.split("\n").find((l) => l.startsWith("fpr:"))!.split(":")[9]!;
    const pub = spawnSync(GPG, ["--homedir", gpgPath({ gpgExe: GPG }, fullHome), "--batch", "--export", fpr], { encoding: "buffer" }).stdout;
    const imp = spawnSync(GPG, ["--homedir", gpgPath({ gpgExe: GPG }, pubHome), "--batch", "--import"], { input: pub, encoding: "buffer" });
    if (imp.status !== 0) throw new Error("could not import the public key");
    cfg = { driveFolder: join(root, "drive"), recipient: fpr, gpgExe: GPG, gnupgHome: pubHome, stateDir: join(root, "state"), spoolDir: join(root, "state", "spool") };
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("1. a backup is three encrypted files; nothing readable is in them, and the laptop's keyring cannot open them", async () => {
    const r = await runBackup(cfg, { source: "local" });
    expect(r.files.length).toBe(3);
    expect(readdirSync(drive()).filter((f) => parseBackupName(f)?.stamp === r.stamp).length).toBe(3);
    expect(readdirSync(drive()).some((f) => f.endsWith(".tmp"))).toBe(false);
    for (const f of r.files) {
      const bytes = readFileSync(join(drive(), f));
      expect(bytes.length).toBeGreaterThan(200);
      const text = bytes.toString("latin1");
      expect(text).not.toContain("COPY ");
      expect(text).not.toContain("CREATE TABLE");
      expect(text).not.toContain("auth.users");
      expect(text).not.toContain(".local");
      // The public-key-only keyring on this "laptop" must NOT be able to decrypt: that is the whole design.
      const open = spawnSync(GPG, ["--homedir", gpgPath({ gpgExe: GPG }, cfg.gnupgHome), "--batch", "--no-tty", "--decrypt", gpgPath({ gpgExe: GPG }, join(drive(), f))], { encoding: "buffer" });
      expect(open.status).not.toBe(0);
    }
    expect(r.counts["public.shops"]).toBeGreaterThan(0);
    expect(r.counts["auth.users"]).toBeGreaterThan(0);
    expect(existsSync(join(cfg.stateDir, "LAST_SUCCESS.json"))).toBe(true);
    expect(Object.keys(r.counts).some((t) => t === "auth.refresh_tokens" || t === "auth.sessions")).toBe(false);
  }, 240_000);

  it("2. the rehearsal: decrypt with the private key, restore into a scratch database, every table's row count equal to the manifest (the dump's own snapshot)", async () => {
    const out: string[] = [];
    // Not compared with the live database here: the other e2e files write to it at the same time. (Run
    // `npm run backup:rehearse -- --compare-live` on a quiet stack for that exact check.)
    const r = await rehearse({ backupDir: drive(), gnupgHome: fullHome, gpgExe: GPG, log: (l) => out.push(l) });
    expect(r.mismatches).toEqual([]);
    expect(r.tables).toBeGreaterThanOrEqual(14);
    expect(r.rows).toBeGreaterThan(0);
    expect(out.join("\n")).toMatch(/public\.bills\s+backup\s+\d+\s+restored\s+\d+/);
  }, 240_000);

  it("3. retention on real files: the month's first set and the newest of each day stay, a middle same-day set goes, a next-day set is added - always whole sets", async () => {
    const stampsOf = (dir: string) => new Set(readdirSync(dir).map((f) => parseBackupName(f)?.stamp).filter(Boolean));
    const first = [...stampsOf(drive())][0]!; // test 1's backup: the oldest of the month
    const b = await runBackup(cfg, { source: "local", now: new Date(Date.now() + 5_000) });
    expect(stampsOf(drive())).toEqual(new Set([first, b.stamp]));
    const c = await runBackup(cfg, { source: "local", now: new Date(Date.now() + 10_000) });
    expect(stampsOf(drive())).toEqual(new Set([first, c.stamp])); // b was neither the newest of the day nor the month's oldest
    const d = await runBackup(cfg, { source: "local", now: new Date(Date.now() + 86_400_000 + 10_000) });
    expect(stampsOf(drive())).toEqual(new Set([first, c.stamp, d.stamp]));
    expect(readdirSync(drive()).filter((f) => parseBackupName(f)?.stamp === d.stamp).length).toBe(3);
    expect(stampsOf(cfg.spoolDir)).toEqual(new Set([c.stamp, d.stamp])); // the local spool keeps the newest of the last 3 days
  }, 400_000);

  it("4. a missing Drive folder is a visible failure that says so - nothing is written anywhere else", async () => {
    const bad = { ...cfg, driveFolder: join(root, "no-such-drive") };
    await expect(runBackup(bad, { source: "local" })).rejects.toThrow(/Google Drive for desktop/);
    expect(existsSync(bad.driveFolder)).toBe(false);
  }, 60_000);

  it("5. a key that is not in the keyring fails before anything reaches the folder", async () => {
    const before = readdirSync(drive()).length;
    const wrong = { ...cfg, recipient: "0".repeat(40) };
    await expect(runBackup(wrong, { source: "local", now: new Date(Date.now() + 60_000) })).rejects.toThrow(/gpg failed/);
    expect(readdirSync(drive()).length).toBe(before);
    expect(readdirSync(cfg.spoolDir).filter((f) => f.endsWith(".tmp")).length).toBe(0);
  }, 120_000);

  it("6. the probe stores nothing and prints the counts a restore needs", async () => {
    const before = readdirSync(drive()).length;
    const r = await runBackup(cfg, { source: "local", probe: true });
    expect(r.files).toEqual([]);
    expect(r.counts["public.shops"]).toBeGreaterThan(0);
    expect(readdirSync(drive()).length).toBe(before);
  }, 120_000);

  it("7. a rehearsal with the WRONG key fails - a backup nobody can open is not a backup", async () => {
    const strangerHome = join(root, "stranger");
    mkdirSync(strangerHome, { recursive: true });
    const gen = gpg(strangerHome, ["--passphrase", "", "--quick-generate-key", "stranger <s@example.invalid>", "default", "default", "never"]);
    expect(gen.status).toBe(0);
    await expect(rehearse({ backupDir: drive(), gnupgHome: strangerHome, gpgExe: GPG, log: () => undefined })).rejects.toThrow(/gpg --decrypt failed/);
  }, 120_000);

  it("(helper) the config the tests wrote is valid JSON-able", () => {
    writeFileSync(join(root, "cfg.json"), JSON.stringify(cfg));
    expect(JSON.parse(readFileSync(join(root, "cfg.json"), "utf8")).recipient).toBe(cfg.recipient);
  });
});
