import { StringDecoder } from "node:string_decoder";

// KB-407 (D75): the pure parts of the encrypted backup - no files, no network, no child processes - so they can
// be tested properly. backup.ts does the I/O; rehearseRestore.ts proves a backup restores.

export type BackupKind = "data" | "schema" | "manifest";

/** Daily copies (newest of each of the last N days) and monthly copies (oldest of each of the last N months). */
export const DEFAULT_RETENTION = { daily: 14, monthly: 3 } as const;
/** A backup newer than this is "fresh": the logon trigger and the 13:00 trigger do not run it twice a day. */
export const FRESH_HOURS = 20;
/** A last success older than this makes the staleness check pop up. */
export const STALE_HOURS = 36;
/** How many encrypted sets also stay on this machine, in case Drive is down. */
export const LOCAL_SPOOL_KEEP = 3;
/**
 * Free space required on the system drive before a run (owner, 11 Oct 2026). The backup itself is tens of
 * megabytes, but Google Drive for desktop caches a file on C: before it uploads, and a full C: has already
 * cost the app its stored data once (KI-68: Chrome evicts a best-effort origin under disk pressure).
 */
export const MIN_FREE_BYTES = 2 * 1024 ** 3;

/** Every table the migrations create in `public`. A test keeps this equal to supabase/migrations. */
export const EXPECTED_PUBLIC_TABLES = [
  "public.base_products",
  "public.bill_cancellations",
  "public.bill_items",
  "public.bills",
  "public.learned_aliases",
  "public.learning_events",
  "public.price_observations",
  "public.provisional_products",
  "public.receipt_number_blocks",
  "public.shop_members",
  "public.shop_products",
  "public.shops",
];

/**
 * Created by a migration that may not be on PRODUCTION yet (the owner's `db push` comes after the code). A backup taken
 * before the push has no such table and must still pass; once it is pushed, move the name into EXPECTED_PUBLIC_TABLES
 * (a dump then missing it is a real fault). The data dump takes every public table - this list only decides what is checked.
 */
export const PENDING_PUBLIC_TABLES: string[] = ["public.bill_metrics"]; // KB-404; moves to EXPECTED after the owner's db push (bill_cancellations moved on 16 Oct 2026)

/** The only `auth` tables a backup keeps: who the users are, and which Google account each one is. */
export const ALLOWED_AUTH_TABLES = ["auth.users", "auth.identities", "auth.instances"];

/** Tables that must hold rows, or a restore would orphan every shop. */
export const REQUIRED_NONEMPTY = ["public.shops", "public.shop_members", "auth.users", "auth.identities"];

/**
 * `auth` tables that hold live credentials or sessions - a refresh token is a login. Never stored; people sign
 * in with Google again after a restore. (The scanner ALSO fails on any auth table not on the allow-list, so a
 * table added by a platform upgrade is noticed instead of silently stored.)
 */
export const AUTH_EXCLUDE = [
  "auth.audit_log_entries",
  "auth.custom_oauth_providers",
  "auth.flow_state",
  "auth.mfa_amr_claims",
  "auth.mfa_challenges",
  "auth.mfa_factors",
  "auth.mfa_recovery_code_sets",
  "auth.mfa_recovery_codes",
  "auth.oauth_authorizations",
  "auth.oauth_client_states",
  "auth.oauth_clients",
  "auth.oauth_consents",
  "auth.one_time_tokens",
  "auth.refresh_tokens",
  "auth.saml_providers",
  "auth.saml_relay_states",
  "auth.scim_tokens",
  "auth.scim_users",
  "auth.sessions",
  "auth.sso_domains",
  "auth.sso_providers",
  "auth.webauthn_challenges",
  "auth.webauthn_credentials",
];

/**
 * Storage's own bookkeeping tables. Platform-managed and version-specific (the hosted project had a
 * `buckets.lifecycle_configuration` column the local stack did not - a COPY with that column list could not load
 * there), the bucket itself is recreated by a migration, and no files are used yet. Only `storage.objects` is kept:
 * its rows are what proves Storage holds no files that the backup would miss.
 */
export const STORAGE_EXCLUDE = [
  "storage.buckets",
  "storage.buckets_analytics",
  "storage.buckets_vectors",
  "storage.iceberg_namespaces",
  "storage.iceberg_tables",
  "storage.s3_multipart_uploads",
  "storage.s3_multipart_uploads_parts",
  "storage.vector_indexes",
];

/** The only `storage` table a backup keeps. */
export const ALLOWED_STORAGE_TABLES = ["storage.objects"];

// ---------------------------------------------------------------------------------------------- file names

/** UTC, sortable: 20261011T073005Z */
export function stampOf(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const SUFFIX: Record<BackupKind, string> = { data: "data.sql", schema: "schema.sql", manifest: "manifest.json" };

export function backupFileName(stamp: string, kind: BackupKind): string {
  return `kb-backup-${stamp}-${SUFFIX[kind]}.gz.gpg`;
}

const NAME = /^kb-backup-(\d{8}T\d{6}Z)-(data\.sql|schema\.sql|manifest\.json)\.gz\.gpg(\.tmp)?$/;

export function parseBackupName(name: string): { stamp: string; kind: BackupKind; tmp: boolean; date: Date } | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const s = m[1]!;
  const date = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
  const kind = (Object.keys(SUFFIX) as BackupKind[]).find((k) => SUFFIX[k] === m[2])!;
  return { stamp: s, kind, tmp: m[3] !== undefined, date, };
}

// ---------------------------------------------------------------------------------------------- retention

const DAY_MS = 86_400_000;

/**
 * Which backup files to keep and which to delete. Works on file NAMES only; a file that is not ours is never
 * mentioned. A "set" is the three files of one run (data, schema, manifest) and is kept or removed whole.
 *  - the newest complete set of each of the last `daily` days that have one;
 *  - the OLDEST complete set of each of the last `monthly` months that have one;
 *  - the newest complete set always (even with a policy of 0);
 *  - everything else complete goes; an incomplete set, or a .tmp, older than 2 days is garbage.
 */
export function selectRetention(
  names: string[],
  now: Date,
  policy: { daily: number; monthly: number } = DEFAULT_RETENTION,
): { keep: string[]; remove: string[] } {
  const sets = new Map<string, { kinds: Set<BackupKind>; files: string[] }>();
  const tmps: Array<{ name: string; date: Date }> = [];
  for (const name of names) {
    const p = parseBackupName(name);
    if (!p) continue;
    if (p.tmp) {
      tmps.push({ name, date: p.date });
      continue;
    }
    const s = sets.get(p.stamp) ?? { kinds: new Set<BackupKind>(), files: [] };
    s.kinds.add(p.kind);
    s.files.push(name);
    sets.set(p.stamp, s);
  }

  const complete = [...sets.entries()].filter(([, s]) => s.kinds.size === 3).map(([stamp]) => stamp).sort().reverse(); // newest first
  const keepStamps = new Set<string>();
  if (complete[0]) keepStamps.add(complete[0]);

  const days = new Set<string>();
  for (const stamp of complete) {
    const day = stamp.slice(0, 8);
    if (days.size >= policy.daily) break;
    if (!days.has(day)) {
      days.add(day);
      keepStamps.add(stamp); // newest of that day (newest-first order)
    }
  }

  const months = new Map<string, string>(); // month -> oldest stamp of the month (iterating newest first, last write wins)
  for (const stamp of complete) months.set(stamp.slice(0, 6), stamp);
  for (const month of [...months.keys()].sort().reverse().slice(0, policy.monthly)) keepStamps.add(months.get(month)!);

  const keep: string[] = [];
  const remove: string[] = [];
  const garbageBefore = now.getTime() - 2 * DAY_MS;
  for (const [stamp, s] of sets) {
    if (s.kinds.size === 3) (keepStamps.has(stamp) ? keep : remove).push(...s.files);
    else if (parseBackupName(s.files[0]!)!.date.getTime() < garbageBefore) remove.push(...s.files);
  }
  for (const t of tmps) if (t.date.getTime() < garbageBefore) remove.push(t.name);
  return { keep, remove };
}

// ---------------------------------------------------------------------------------------------- freshness, space

export function isStale(lastSuccessIso: string | null, now: Date, hours: number = STALE_HOURS): boolean {
  if (!lastSuccessIso) return true;
  const t = Date.parse(lastSuccessIso);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > hours * 3_600_000;
}

export function freeSpaceVerdict(freeBytes: number, drive: string): { ok: boolean; message: string } {
  const gib = (n: number) => (n / 1024 ** 3).toFixed(1);
  if (freeBytes >= MIN_FREE_BYTES) return { ok: true, message: `${drive} has ${gib(freeBytes)} GiB free` };
  return {
    ok: false,
    message:
      `${drive} has only ${gib(freeBytes)} GiB free; the backup needs at least ${gib(MIN_FREE_BYTES)} GiB free on it. ` +
      `Google Drive keeps a cache on ${drive} before it uploads, and a full ${drive} can make Chrome erase the app's stored bills. Free some space.`,
  };
}

// ---------------------------------------------------------------------------------------------- the dump

/** The CLI arguments for the data dump. Never --dry-run or --debug: they print the temporary database password. */
export function buildDataDumpArgs(source: "linked" | "local"): string[] {
  return ["db", "dump", `--${source}`, "--data-only", "--use-copy", "--schema", "public,auth,storage", "-x", [...AUTH_EXCLUDE, ...STORAGE_EXCLUDE].join(",")];
}

export function assertSafeArgs(args: string[]): void {
  if (args.includes("--dry-run")) throw new Error("refusing --dry-run: it prints the temporary database password");
  if (args.includes("--debug")) throw new Error("refusing --debug: it prints connection details");
  const i = args.indexOf("--log-level");
  if (i >= 0 && ["debug", "trace", "all"].includes(args[i + 1] ?? "")) throw new Error("refusing --log-level debug: it prints connection details");
}

export interface ScanResult {
  /** "schema.table" -> rows in its COPY block */
  counts: Record<string, number>;
  /** the dump switched triggers off first (`SET session_replication_role = replica`) */
  sawReplicaRole: boolean;
}

/** Reads a data-only COPY dump as a stream and counts the rows of every table. Never keeps a row. */
export class DumpScanner {
  private readonly decoder = new StringDecoder("utf8");
  private rest = "";
  private table: string | null = null;
  private readonly counts: Record<string, number> = {};
  private replica = false;

  feed(chunk: string | Buffer): void {
    const text = this.rest + (typeof chunk === "string" ? chunk : this.decoder.write(chunk));
    const lines = text.split("\n");
    this.rest = lines.pop() ?? "";
    for (const line of lines) this.line(line);
  }

  finish(): ScanResult {
    this.rest += this.decoder.end();
    if (this.rest !== "") this.line(this.rest);
    this.rest = "";
    return { counts: { ...this.counts }, sawReplicaRole: this.replica };
  }

  private line(line: string): void {
    if (this.table !== null) {
      if (line === "\\.") this.table = null;
      else this.counts[this.table] = (this.counts[this.table] ?? 0) + 1;
      return;
    }
    if (line.startsWith("SET session_replication_role = replica")) this.replica = true;
    const m = /^COPY "([^"]+)"\."([^"]+)"/.exec(line);
    if (m) {
      this.table = `${m[1]}.${m[2]}`;
      this.counts[this.table] = 0;
    }
  }
}

/** Everything wrong with a scanned data dump. Empty = it holds what a restore needs, and nothing it must not. */
export function evaluateScan(result: ScanResult): string[] {
  const problems: string[] = [];
  const { counts } = result;
  const keys = Object.keys(counts);
  if (!result.sawReplicaRole) problems.push("the dump does not start with SET session_replication_role = replica, so finalised bills would not load");
  if (keys.reduce((n, k) => n + counts[k]!, 0) === 0) problems.push("the dump holds no rows at all (structure only?)");
  for (const k of keys) {
    const schema = k.split(".")[0];
    if (schema === "auth") {
      if (!ALLOWED_AUTH_TABLES.includes(k)) problems.push(`${k} is not on the allow-list of auth tables (it may hold credentials) - judge it, then add it to the list or to the exclusions`);
    } else if (schema === "storage") {
      if (!ALLOWED_STORAGE_TABLES.includes(k)) problems.push(`${k} is not on the allow-list of storage tables - judge it, then add it to the list or to the exclusions`);
      else if (counts[k]! > 0) problems.push(`Storage holds ${counts[k]} file(s); the dump has only their metadata, so the files themselves are NOT backed up`);
    } else if (schema !== "public") {
      problems.push(`${k}: a schema the backup does not expect`);
    }
  }
  for (const t of EXPECTED_PUBLIC_TABLES) if (!(t in counts)) problems.push(`${t} is missing from the dump`);
  for (const t of REQUIRED_NONEMPTY) if (!counts[t]) problems.push(`${t} has no rows - a restore would orphan every shop`);
  return problems;
}

/** The restore rehearsal: one line per table whose restored count differs from the backup's. */
export function compareCounts(backup: Record<string, number>, restored: Record<string, number>): string[] {
  const out: string[] = [];
  for (const t of Object.keys(backup).sort()) {
    if (!(t in restored)) out.push(`${t}: backup has ${backup[t]}, restored database has no such table`);
    else if (restored[t] !== backup[t]) out.push(`${t}: backup has ${backup[t]}, restored database has ${restored[t]}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- logs

/** Nothing secret may reach a log or a message box. Applied to every line that is ever written. */
export function redact(text: string): string {
  return text
    .replace(/(PGPASSWORD\s*=\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1<redacted>")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, "$1<redacted>@")
    .replace(/(password\s*[=:]\s*)\S+/gi, "$1<redacted>")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "<jwt>")
    .replace(/sbp_[A-Za-z0-9]{20,}/g, "<token>")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/g, "<key>")
    .replace(/gh[opsu]_[A-Za-z0-9]{20,}/g, "<token>")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "<key>")
    .replace(/gsk_[A-Za-z0-9]{20,}/g, "<key>");
}
