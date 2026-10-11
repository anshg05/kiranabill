import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Client } from "pg";
import { backupFileName, compareCounts, parseBackupName, redact, type BackupKind } from "./backupCore";
import { gpgPath } from "./backup";

/**
 * KB-407 (D75): proves a backup restores - into a SCRATCH database on the local stack, never the real one.
 * It follows the real emergency procedure (docs/22-BACKUP-AND-RESTORE.md):
 *   1. a scratch database that stands in for "a fresh Supabase project": the auth + storage + extensions
 *      structure is copied from the local stack (a new hosted project comes with them);
 *   2. the repo's migrations recreate `public` (tables, RLS, functions, the storage bucket and its policies);
 *   3. the backup's data file is decrypted and loaded (it switches triggers off first, so finalised bills load);
 *   4. every table's row count is compared with the manifest inside the backup.
 * The private key is only ever used here, by whoever holds it: with --interactive gpg asks for the passphrase.
 *
 * Usage: tsx scripts/backup/rehearseRestore.ts --backup-dir DIR --gnupg-home DIR [--interactive] [--compare-live] [--keep]
 */

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PG_URL = "postgresql://postgres:postgres@127.0.0.1:54322";
const CONTAINER = "supabase_db_Voice";
const SCRATCH = "restore_rehearsal";

export interface RehearseOptions {
  backupDir: string;
  /** the keyring that holds the PRIVATE key (the owner's, or a throwaway one in tests) */
  gnupgHome: string;
  gpgExe: string;
  /** no --batch: gpg may ask for the passphrase (the real key is passphrase-protected) */
  interactive?: boolean;
  /** also compare with the live local database (only exact when the backup was taken from it moments ago) */
  compareLive?: boolean;
  keep?: boolean;
  log?: (line: string) => void;
}

export interface RehearseResult {
  stamp: string;
  tables: number;
  rows: number;
  mismatches: string[];
  liveMismatches: string[];
}

/** docker exec -i psql ... with `input` piped to stdin; rejects on a non-zero exit (unless tolerant). */
function psql(db: string, input: NodeJS.ReadableStream | string | null, args: string[] = [], opts: { stopOnError: boolean } = { stopOnError: true }): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-q", "-v", `ON_ERROR_STOP=${opts.stopOnError ? 1 : 0}`, ...args], { stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout!.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr!.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", rej);
    child.on("close", (code) => {
      if (code === 0 || !opts.stopOnError) res(out + err);
      else rej(new Error(`psql (${db}) failed (exit ${code}): ${redact(err).split("\n").filter(Boolean).slice(0, 3).join(" | ").slice(0, 400)}`));
    });
    if (input !== null) {
      if (typeof input === "string") child.stdin!.end(input);
      else void pipeline(input, child.stdin!).catch(() => child.kill());
    }
  });
}

function dockerOut(args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", rej);
    child.on("close", (c) => (c === 0 ? res(out) : rej(new Error(`docker ${args[0]} failed: ${redact(err).slice(0, 300)}`))));
  });
}

/** gpg --decrypt FILE | gunzip, as a readable stream */
function decrypt(o: RehearseOptions, file: string) {
  const args = ["--homedir", gpgPath(o, o.gnupgHome), ...(o.interactive ? [] : ["--batch", "--no-tty"]), "--decrypt", gpgPath(o, file)];
  const child = spawn(o.gpgExe, args, { stdio: ["inherit", "pipe", o.interactive ? "inherit" : "pipe"], windowsHide: true });
  let err = "";
  child.stderr?.on("data", (d: Buffer) => (err += d.toString("utf8")));
  const done = new Promise<void>((res, rej) => {
    child.on("error", rej);
    child.on("close", (c) => (c === 0 ? res() : rej(new Error(`gpg --decrypt failed (exit ${c}): ${redact(err).slice(0, 300)}`))));
  });
  done.catch(() => undefined);
  const gunzip = createGunzip();
  child.stdout!.pipe(gunzip);
  return { stream: gunzip, done };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let s = "";
  for await (const c of stream) s += c.toString();
  return s;
}

async function countsOf(url: string, tables: string[]): Promise<Record<string, number>> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const out: Record<string, number> = {};
    for (const t of tables) {
      const [schema, table] = t.split(".");
      try {
        const r = await c.query(`select count(*)::int as n from "${schema}"."${table}"`);
        out[t] = r.rows[0].n as number;
      } catch {
        /* a table that is not there is simply absent: compareCounts reports it */
      }
    }
    return out;
  } finally {
    await c.end();
  }
}

export async function rehearse(o: RehearseOptions): Promise<RehearseResult> {
  const say = o.log ?? ((l: string) => console.log(l));

  // the newest COMPLETE set in the folder
  const sets = new Map<string, Set<BackupKind>>();
  for (const n of readdirSync(o.backupDir)) {
    const p = parseBackupName(n);
    if (p && !p.tmp) sets.set(p.stamp, (sets.get(p.stamp) ?? new Set()).add(p.kind));
  }
  const stamp = [...sets.entries()].filter(([, k]) => k.size === 3).map(([s]) => s).sort().pop();
  if (!stamp) throw new Error(`no complete backup set (data + schema + manifest) in ${o.backupDir}`);
  say(`rehearsing backup ${stamp}`);

  const manifestDec = decrypt(o, join(o.backupDir, backupFileName(stamp, "manifest")));
  let manifestText: string;
  try {
    manifestText = await readAll(manifestDec.stream);
  } catch (e) {
    await manifestDec.done; // a wrong key makes gpg fail first: say THAT, not "unexpected end of file"
    throw e;
  }
  await manifestDec.done;
  const manifest = JSON.parse(manifestText) as { counts: Record<string, number>; migrations: string[]; gitCommit: string };
  const tables = Object.keys(manifest.counts);
  say(`manifest: ${tables.length} tables, ${Object.values(manifest.counts).reduce((a, b) => a + b, 0)} rows, ${manifest.migrations.length} migrations, commit ${manifest.gitCommit.slice(0, 8)}`);

  // 1. a scratch database standing in for "a fresh Supabase project"
  const admin = new Client({ connectionString: `${PG_URL}/postgres` });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${SCRATCH} with (force)`);
    await admin.query(`create database ${SCRATCH}`);
  } finally {
    await admin.end();
  }
  try {
    await psql(SCRATCH, "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions; create extension if not exists btree_gist with schema extensions;");
    const structure = await dockerOut(["exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner", "--no-privileges", "--schema=auth", "--schema=storage"]);
    const noise = await psql(SCRATCH, structure, [], { stopOnError: false });
    const real = noise.split("\n").filter((l) => /ERROR/.test(l) && !/is_shop_member/.test(l));
    if (real.length > 0) throw new Error(`copying the auth + storage structure failed: ${redact(real[0]!)}`);
    // the structure copy carries this project's own storage policies (and they need public.*): the migrations recreate them
    await psql(SCRATCH, ["select", "insert", "update", "delete"].map((p) => `drop policy if exists shop_logos_${p} on storage.objects;`).join(" "));
    say("scratch database ready (auth + storage structure copied)");

    // 2. the migrations
    const files = readdirSync(join(REPO, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) await psql(SCRATCH, readFileSync(join(REPO, "supabase", "migrations", f), "utf8"));
    say(`${files.length} migrations applied`);

    // 3. the data. The migrations seeded one thing the backup carries too (the ready catalog): clear exactly that,
    //    so the load meets an otherwise EMPTY project (anything else already there is a
    //    primary-key collision and stops the load - by design, a restore must never merge into live data).
    await psql(SCRATCH, "delete from public.base_products;");
    const dataDec = decrypt(o, join(o.backupDir, backupFileName(stamp, "data")));
    try {
      await psql(SCRATCH, dataDec.stream);
    } catch (e) {
      await dataDec.done;
      throw e;
    }
    await dataDec.done;
    say("data loaded");

    // 4. row counts, table by table
    const restored = await countsOf(`${PG_URL}/${SCRATCH}`, tables);
    const mismatches = compareCounts(manifest.counts, restored);
    for (const t of tables.sort()) say(`  ${t.padEnd(36)} backup ${String(manifest.counts[t]).padStart(7)}   restored ${String(restored[t] ?? "-").padStart(7)}${restored[t] === manifest.counts[t] ? "" : "   <-- DIFFERENT"}`);
    let liveMismatches: string[] = [];
    if (o.compareLive) {
      const live = await countsOf(`${PG_URL}/postgres`, tables);
      liveMismatches = compareCounts(live, restored).map((m) => m.replace("backup has", "live database has"));
      say(liveMismatches.length === 0 ? "the restored database matches the live local database" : `live comparison: ${liveMismatches.join("; ")}`);
    }
    return { stamp, tables: tables.length, rows: Object.values(restored).reduce((a, b) => a + b, 0), mismatches, liveMismatches };
  } finally {
    if (!o.keep) {
      const a = new Client({ connectionString: `${PG_URL}/postgres` });
      await a.connect();
      await a.query(`drop database if exists ${SCRATCH} with (force)`);
      await a.end();
    }
  }
}

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const backupDir = arg("--backup-dir", argv);
  const gnupgHome = arg("--gnupg-home", argv);
  if (!backupDir || !gnupgHome) {
    console.error("usage: rehearseRestore.ts --backup-dir DIR --gnupg-home DIR [--interactive] [--compare-live] [--keep]");
    process.exit(2);
  }
  const gpgExe = arg("--gpg", argv) ?? "C:\\Program Files\\Git\\usr\\bin\\gpg.exe";
  try {
    const r = await rehearse({ backupDir, gnupgHome, gpgExe, interactive: argv.includes("--interactive"), compareLive: argv.includes("--compare-live"), keep: argv.includes("--keep") });
    if (r.mismatches.length > 0 || r.liveMismatches.length > 0) {
      console.error(`REHEARSAL FAILED:\n  ${[...r.mismatches, ...r.liveMismatches].join("\n  ")}`);
      process.exitCode = 1;
    } else console.log(`REHEARSAL OK: backup ${r.stamp} restored; ${r.tables} tables, ${r.rows} rows, every count equal`);
  } catch (e) {
    console.error(`REHEARSAL FAILED: ${redact((e as Error).message)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
