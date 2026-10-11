import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { join, parse, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import {
  DEFAULT_RETENTION,
  DumpScanner,
  FRESH_HOURS,
  LOCAL_SPOOL_KEEP,
  assertSafeArgs,
  backupFileName,
  buildDataDumpArgs,
  evaluateScan,
  freeSpaceVerdict,
  isStale,
  redact,
  selectRetention,
  stampOf,
  type BackupKind,
} from "./backupCore";

/**
 * KB-407 (D75): the daily encrypted backup of the production database to Google Drive.
 *
 *   data dump (public + auth users/identities + storage metadata) --scan--> gzip --> gpg (PUBLIC key) --> file
 *   schema dump -------------------------------------------------------> gzip --> gpg --> file
 *   manifest (counts per table, hashes, versions) ------------------------> gzip --> gpg --> file
 *
 * Nothing readable is ever written to disk: the dump is streamed through the scanner into gzip into gpg, and the
 * laptop holds only the PUBLIC key - it can encrypt but never decrypt. The remote needs no database password: the
 * Supabase CLI mints a short-lived login role from the access token that `supabase login` keeps in Windows
 * Credential Manager. The CLI is never run with --dry-run or --debug (they print that temporary password), and no
 * child output is logged raw - the dump IS the data. Every failure shows a message box; a second task checks the
 * last success is not stale.
 *
 * Usage: tsx scripts/backup/backup.ts [--probe] [--if-stale] [--check-stale] [--source linked|local] [--out DIR] [--no-alert]
 */

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CLI_JS = join(REPO, "node_modules", "supabase", "dist", "supabase.js");

export interface BackupConfig {
  /** Where finished sets are copied - the Google Drive for desktop folder. */
  driveFolder: string;
  /** Fingerprint of the owner's PUBLIC key. */
  recipient: string;
  gpgExe: string;
  /** A keyring holding ONLY the public key. */
  gnupgHome: string;
  /** last-success marker, the log, and the local spool of the last few encrypted sets. */
  stateDir: string;
  spoolDir: string;
  /** setup-key.sh writes true only AFTER the owner opened a test note with the real private key (stage 4). */
  keyConfirmed: boolean;
}

/** A public key whose private half was never saved and proven turns every backup into a trap: refuse it. */
export function assertKeyConfirmed(cfg: Pick<BackupConfig, "keyConfirmed">): void {
  if (cfg.keyConfirmed !== true) {
    throw new Error("the backup key was never confirmed (setup-key.sh did not finish stage 4) - no backup may run with an unproven key. Run: bash scripts/backup/setup-key.sh --reset, then setup-key.sh again");
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackupConfig {
  const appData = env.APPDATA ?? join(env.USERPROFILE ?? ".", "AppData", "Roaming");
  const local = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? ".", "AppData", "Local");
  const file = env.KB_BACKUP_CONFIG ?? join(appData, "KiranaBillBackup", "config.json");
  if (!existsSync(file)) throw new Error(`no backup config at ${file} - run scripts/backup/setup-key.sh first`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<BackupConfig>;
  const stateDir = raw.stateDir ?? join(local, "KiranaBillBackup");
  const cfg: BackupConfig = {
    driveFolder: raw.driveFolder ?? "",
    recipient: raw.recipient ?? "",
    gpgExe: raw.gpgExe ?? (existsSync("C:\\Program Files\\Git\\usr\\bin\\gpg.exe") ? "C:\\Program Files\\Git\\usr\\bin\\gpg.exe" : "gpg"),
    gnupgHome: raw.gnupgHome ?? join(appData, "KiranaBillBackup", "gnupg"),
    stateDir,
    spoolDir: raw.spoolDir ?? join(stateDir, "spool"),
    keyConfirmed: raw.keyConfirmed === true,
  };
  assertKeyConfirmed(cfg);
  if (!cfg.driveFolder) throw new Error(`config ${file}: driveFolder is empty`);
  if (!cfg.recipient) throw new Error(`config ${file}: recipient (the public key fingerprint) is empty`);
  return cfg;
}

// ------------------------------------------------------------------------------------------------ log + alert

function log(cfg: BackupConfig, message: string): void {
  const line = `${new Date().toISOString()} ${redact(message)}\n`;
  process.stdout.write(line);
  try {
    mkdirSync(cfg.stateDir, { recursive: true });
    const file = join(cfg.stateDir, "backup.log");
    if (existsSync(file) && statSync(file).size > 1_000_000) renameSync(file, file + ".1");
    appendFileSync(file, line);
  } catch {
    /* a log that cannot be written must not hide the real error */
  }
}

/** A message box that stays until dismissed - detached, so it never holds the run (or Task Scheduler) up. */
function alert(title: string, message: string, enabled: boolean): void {
  if (!enabled) return;
  const ps1 = join(REPO, "scripts", "backup", "alert.ps1");
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Title", title, "-Message", redact(message).slice(0, 500)], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    /* nothing more to do: the log has it */
  }
}

// ------------------------------------------------------------------------------------------------ pieces

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function dockerUp(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 20_000 });
  return r.status === 0;
}

/** The CLI runs pg_dump in a container, so Docker Desktop must be up. Starts it if needed and waits up to 3 minutes. */
async function ensureDocker(cfg: BackupConfig): Promise<void> {
  if (dockerUp()) return;
  log(cfg, "Docker is not running - starting Docker Desktop (up to 3 minutes)");
  spawnSync("docker", ["desktop", "start"], { stdio: "ignore", timeout: 60_000 });
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    if (dockerUp()) return;
    await sleep(5_000);
  }
  throw new Error("Docker Desktop did not start within 3 minutes - the backup needs it (the Supabase CLI dumps inside a container)");
}

function checkFreeSpace(cfg: BackupConfig): void {
  mkdirSync(cfg.stateDir, { recursive: true });
  const s = statfsSync(cfg.stateDir);
  const v = freeSpaceVerdict(Number(s.bavail) * Number(s.bsize), parse(resolve(cfg.stateDir)).root.replace(/[\\/]+$/, ""));
  if (!v.ok) throw new Error(v.message);
  log(cfg, v.message);
}

/** Runs the Supabase CLI and hands back its stdout as a stream. Rejects `done` with a redacted tail of stderr. */
function cli(args: string[]): { stdout: Readable; done: Promise<void>; abort: () => void } {
  assertSafeArgs(args);
  const child = spawn(process.execPath, [CLI_JS, ...args], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const tail: string[] = [];
  child.stderr.on("data", (d: Buffer) => {
    for (const l of d.toString("utf8").split(/\r?\n/)) if (l.trim()) tail.push(l);
    if (tail.length > 6) tail.splice(0, tail.length - 6);
  });
  const timer = setTimeout(() => child.kill(), 10 * 60_000);
  const done = new Promise<void>((resolveDone, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveDone();
      else reject(new Error(`supabase ${args.slice(0, 2).join(" ")} failed (exit ${code}): ${redact(tail.filter((l) => !/new version|recommend updating/i.test(l)).join(" | ")).slice(0, 400)}`));
    });
  });
  done.catch(() => undefined); // surfaced by whoever awaits it
  return { stdout: child.stdout, done, abort: () => child.kill() };
}

/**
 * Git for Windows' gpg is an MSYS program: it reads `C:\Users\x` as a RELATIVE path and fails ("keyblock resource ...
 * No such file"), so every path handed to it is written the MSYS way, /c/Users/x. (Gpg4win takes Windows paths: point
 * gpgExe at it and the paths are passed through untouched.)
 */
export function gpgPath(cfg: Pick<BackupConfig, "gpgExe">, p: string): string {
  const msys = cfg.gpgExe === "gpg" || /[\\/]usr[\\/]bin[\\/]/i.test(cfg.gpgExe);
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  return msys && m ? `/${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, "/")}` : p;
}

function gpg(cfg: BackupConfig, args: string[], stdio: Array<"pipe" | "ignore"> = ["ignore", "pipe", "pipe"]) {
  return spawn(cfg.gpgExe, ["--homedir", gpgPath(cfg, cfg.gnupgHome), "--batch", "--no-tty", ...args], { stdio, windowsHide: true });
}

/** source --(tap)--> gzip --> gpg --encrypt (public key) --> out */
async function encryptStream(cfg: BackupConfig, source: Readable, out: string, tap?: (chunk: Buffer) => void): Promise<void> {
  const enc = gpg(cfg, ["--yes", "--trust-model", "always", "--cipher-algo", "AES256", "--compress-algo", "none", "--recipient", cfg.recipient, "--encrypt", "--output", gpgPath(cfg, out)], ["pipe", "pipe", "pipe"]);
  let err = "";
  enc.stderr!.on("data", (d: Buffer) => (err += d.toString("utf8")));
  const exited = new Promise<void>((res, rej) => {
    enc.on("error", rej);
    enc.on("close", (code) => (code === 0 ? res() : rej(new Error(`gpg failed (exit ${code}): ${redact(err).slice(0, 300)}`))));
  });
  exited.catch(() => undefined); // awaited below; this stops an early gpg exit being reported as unhandled first
  const tapper = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      tap?.(chunk);
      cb(null, chunk);
    },
  });
  let pipeErr: unknown;
  try {
    await pipeline(source, tapper, createGzip(), enc.stdin!);
  } catch (e) {
    pipeErr = e; // usually EPIPE: gpg quit first, and ITS message is the useful one
  }
  await exited;
  if (pipeErr) throw pipeErr;
}

function sha256(file: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
  });
}

/** The file really is encrypted to the owner's key (we cannot decrypt it here - that is the point). */
function verifyEncrypted(cfg: BackupConfig, file: string): void {
  if (statSync(file).size < 200) throw new Error(`${file} is suspiciously small`);
  const keys = spawnSync(cfg.gpgExe, ["--homedir", gpgPath(cfg, cfg.gnupgHome), "--batch", "--list-keys", "--with-colons", cfg.recipient], { encoding: "utf8" });
  const ids = new Set(keys.stdout.split("\n").filter((l) => /^(pub|sub):/.test(l)).map((l) => l.split(":")[4]!.toUpperCase()));
  const packets = spawnSync(cfg.gpgExe, ["--homedir", gpgPath(cfg, cfg.gnupgHome), "--batch", "--list-packets", gpgPath(cfg, file)], { encoding: "utf8" });
  const used = [...(packets.stdout + packets.stderr).matchAll(/pubkey enc packet:.*?keyid ([0-9A-F]{16})/gi)].map((m) => m[1]!.toUpperCase());
  if (used.length === 0 || !used.some((k) => ids.has(k))) throw new Error(`${file} is not encrypted to the configured key`);
}

function migrationVersions(): string[] {
  return readdirSync(join(REPO, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).map((f) => f.split("_")[0]!).sort();
}

function gitCommit(): string {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "unknown";
}

function lastSuccessFile(cfg: BackupConfig): string {
  return join(cfg.stateDir, "LAST_SUCCESS.json");
}

function lastSuccess(cfg: BackupConfig): string | null {
  try {
    return (JSON.parse(readFileSync(lastSuccessFile(cfg), "utf8")) as { atUtc?: string }).atUtc ?? null;
  } catch {
    return null;
  }
}

function applyRetention(folder: string, policy: { daily: number; monthly: number }, cfg: BackupConfig, label: string): void {
  const r = selectRetention(readdirSync(folder), new Date(), policy);
  for (const name of r.remove) rmSync(join(folder, name), { force: true });
  log(cfg, `retention (${label}): kept ${r.keep.length} files, removed ${r.remove.length}`);
}

// ------------------------------------------------------------------------------------------------ the run

export interface RunOptions {
  source: "linked" | "local";
  /** Counts only: scan the dump, print the numbers, store nothing. */
  probe?: boolean;
  /** Copy the finished set here instead of the Drive folder (tests, rehearsal). */
  outDir?: string;
  now?: Date;
}

export interface RunResult {
  stamp: string;
  counts: Record<string, number>;
  files: string[];
}

export async function runBackup(cfg: BackupConfig, opts: RunOptions): Promise<RunResult> {
  if (!opts.probe) assertKeyConfirmed(cfg);
  checkFreeSpace(cfg);
  const dest = opts.outDir ?? cfg.driveFolder;
  if (!opts.probe && !(existsSync(dest) && statSync(dest).isDirectory())) {
    throw new Error(`the backup folder ${dest} is not there - is Google Drive for desktop running and signed in?`);
  }
  await ensureDocker(cfg);

  // 1. the data
  const stamp = stampOf(opts.now ?? new Date());
  const scanner = new DumpScanner();
  const dataTmp = join(cfg.spoolDir, backupFileName(stamp, "data") + ".tmp");
  mkdirSync(cfg.spoolDir, { recursive: true });
  const running: Array<{ abort: () => void }> = [];
  const cleanup = () => {
    for (const c of running) c.abort(); // a dump nobody reads would sit blocked on its pipe
    for (const k of ["data", "schema", "manifest"] as BackupKind[]) rmSync(join(cfg.spoolDir, backupFileName(stamp, k) + ".tmp"), { force: true });
  };
  try {
    const data = cli(buildDataDumpArgs(opts.source));
    running.push(data);
    if (opts.probe) {
      await pipeline(data.stdout, new Transform({ transform: (c: Buffer, _e, cb) => (scanner.feed(c), cb()) }));
      await data.done;
    } else {
      await encryptStream(cfg, data.stdout, dataTmp, (c) => scanner.feed(c));
      await data.done;
    }
    const scan = scanner.finish();
    const problems = evaluateScan(scan);
    log(cfg, `data dump: ${Object.keys(scan.counts).length} tables, ${Object.values(scan.counts).reduce((a, b) => a + b, 0)} rows`);
    if (problems.length > 0) throw new Error(`the data dump is not good enough to keep: ${problems.join("; ")}`);
    if (opts.probe) return { stamp, counts: scan.counts, files: [] };

    // 2. the schema (reference; the migrations are the source of truth for public)
    const schemaTmp = join(cfg.spoolDir, backupFileName(stamp, "schema") + ".tmp");
    let createTables = 0;
    const schema = cli(["db", "dump", `--${opts.source}`]);
    running.push(schema);
    await encryptStream(cfg, schema.stdout, schemaTmp, (c) => (createTables += (c.toString("utf8").match(/CREATE TABLE/g) ?? []).length));
    await schema.done;
    if (createTables === 0) throw new Error("the schema dump holds no tables");

    // 3. the manifest - what a restore must find (encrypted too)
    const manifestTmp = join(cfg.spoolDir, backupFileName(stamp, "manifest") + ".tmp");
    const manifest = {
      format: 1,
      createdAtUtc: new Date().toISOString(),
      source: opts.source,
      gitCommit: gitCommit(),
      migrations: migrationVersions(),
      supabaseCli: (JSON.parse(readFileSync(join(REPO, "node_modules", "supabase", "package.json"), "utf8")) as { version: string }).version,
      counts: scan.counts,
      schemaTables: createTables,
      files: {
        data: { bytes: statSync(dataTmp).size, sha256: await sha256(dataTmp) },
        schema: { bytes: statSync(schemaTmp).size, sha256: await sha256(schemaTmp) },
      },
    };
    await encryptStream(cfg, Readable.from([JSON.stringify(manifest, null, 2)]), manifestTmp);

    // 4. all three really are encrypted to the owner's key, then become final in the local spool
    const kinds: BackupKind[] = ["data", "schema", "manifest"];
    for (const [k, tmp] of [["data", dataTmp], ["schema", schemaTmp], ["manifest", manifestTmp]] as const) {
      verifyEncrypted(cfg, tmp);
      renameSync(tmp, join(cfg.spoolDir, backupFileName(stamp, k)));
    }

    // 5. to the destination, a temporary name first so Drive never uploads half a file; the manifest goes last
    const names = kinds.map((k) => backupFileName(stamp, k));
    for (const name of names) {
      const from = join(cfg.spoolDir, name);
      const to = join(dest, name);
      copyFileSync(from, to + ".tmp");
      renameSync(to + ".tmp", to);
      if ((await sha256(from)) !== (await sha256(to))) throw new Error(`${name}: the copy in ${dest} does not match`);
    }
    log(cfg, `backup ${stamp} written to ${dest} (${names.length} files)`);

    // 6. retention - the Drive folder (14 daily + 3 monthly) and the local spool (the last few)
    applyRetention(dest, DEFAULT_RETENTION, cfg, "destination");
    applyRetention(cfg.spoolDir, { daily: LOCAL_SPOOL_KEEP, monthly: 0 }, cfg, "local spool");

    writeFileSync(lastSuccessFile(cfg), JSON.stringify({ atUtc: new Date().toISOString(), stamp, source: opts.source, rows: Object.values(scan.counts).reduce((a, b) => a + b, 0) }));
    return { stamp, counts: scan.counts, files: names };
  } catch (e) {
    cleanup();
    throw e;
  }
}

// ------------------------------------------------------------------------------------------------ main

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const alerts = !argv.includes("--no-alert");
  const cfg = (() => {
    try {
      return loadConfig();
    } catch (e) {
      const msg = (e as Error).message;
      console.error(redact(msg));
      alert("KiranaBill backup is not set up", msg, alerts);
      process.exit(1);
    }
  })();

  try {
    if (argv.includes("--check-stale")) {
      const last = lastSuccess(cfg);
      if (isStale(last, new Date())) {
        const msg = last ? `The last successful KiranaBill backup was at ${last}. Open the backup log (${join(cfg.stateDir, "backup.log")}) or run: npm run backup` : "There is no successful KiranaBill backup on record. Run: npm run backup";
        log(cfg, `STALE: ${msg}`);
        alert("KiranaBill backup is out of date", msg, alerts);
        process.exitCode = 1;
      } else log(cfg, "backup check: fresh");
      return;
    }
    if (argv.includes("--if-stale") && !isStale(lastSuccess(cfg), new Date(), FRESH_HOURS)) {
      log(cfg, `a backup is less than ${FRESH_HOURS} hours old - nothing to do`);
      return;
    }
    const source = (arg("--source", argv) ?? "linked") as "linked" | "local";
    const probe = argv.includes("--probe");
    const r = await runBackup(cfg, { source, probe, outDir: arg("--out", argv) });
    if (probe) {
      for (const [t, n] of Object.entries(r.counts).sort()) console.log(`${t.padEnd(36)} ${n}`);
      log(cfg, "probe ok: the dump holds what a restore needs");
    } else log(cfg, `backup ok: ${r.stamp}`);
  } catch (e) {
    const msg = (e as Error).message;
    log(cfg, `BACKUP FAILED: ${msg}`);
    alert("KiranaBill backup FAILED", msg, alerts);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
