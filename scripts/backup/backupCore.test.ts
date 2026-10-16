import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_AUTH_TABLES,
  AUTH_EXCLUDE,
  DumpScanner,
  EXPECTED_PUBLIC_TABLES,
  PENDING_PUBLIC_TABLES,
  MIN_FREE_BYTES,
  assertSafeArgs,
  backupFileName,
  buildDataDumpArgs,
  compareCounts,
  evaluateScan,
  freeSpaceVerdict,
  isStale,
  parseBackupName,
  redact,
  selectRetention,
  stampOf,
} from "./backupCore";

// KB-407: the pure parts of the encrypted backup - what a dump must contain, which copies to keep, when a
// backup is too old, and what never reaches a log. The pipeline itself is backupPipeline.e2e.test.ts.

const KINDS = ["data.sql.gz.gpg", "schema.sql.gz.gpg", "manifest.json.gz.gpg"];
/** A complete set of files for a UTC moment, e.g. set("2026-10-11T07:30:00Z"). */
const set = (iso: string) => KINDS.map((k) => `kb-backup-${stampOf(new Date(iso))}-${k}`);

describe("file names", () => {
  it("a stamp is UTC, sortable, and round-trips", () => {
    expect(stampOf(new Date("2026-10-11T07:30:05Z"))).toBe("20261011T073005Z");
    expect(backupFileName("20261011T073005Z", "data")).toBe("kb-backup-20261011T073005Z-data.sql.gz.gpg");
    expect(parseBackupName("kb-backup-20261011T073005Z-manifest.json.gz.gpg")).toMatchObject({ stamp: "20261011T073005Z", kind: "manifest", tmp: false });
    expect(parseBackupName("kb-backup-20261011T073005Z-schema.sql.gz.gpg")?.date.toISOString()).toBe("2026-10-11T07:30:05.000Z");
  });

  it("a half-written copy (.tmp) is recognised, anything else is not ours", () => {
    expect(parseBackupName("kb-backup-20261011T073005Z-data.sql.gz.gpg.tmp")).toMatchObject({ kind: "data", tmp: true });
    for (const foreign of ["resume.docx", "kb-backup-latest.txt", "kb-backup-2026-10-11-data.sql.gz.gpg", "kb-backup-20261011T073005Z-other.bin", ""]) {
      expect(parseBackupName(foreign)).toBeNull();
    }
  });
});

describe("retention: 14 daily + 3 monthly (D75)", () => {
  const NOW = new Date("2026-10-11T12:00:00Z");

  it("keeps everything while there are few copies", () => {
    const files = [...set("2026-10-10T08:00:00Z"), ...set("2026-10-11T08:00:00Z")];
    const r = selectRetention(files, NOW);
    expect(r.remove).toEqual([]);
    expect(r.keep.length).toBe(6);
  });

  it("keeps the 14 most recent days (the newest copy of each day) and removes older daily copies", () => {
    const files: string[] = [];
    for (let d = 0; d < 20; d++) files.push(...set(new Date(Date.UTC(2026, 9, 11 - d, 8)).toISOString())); // 11 Oct back to 22 Sep
    const r = selectRetention(files, NOW);
    const keptDays = new Set(r.keep.map((f) => parseBackupName(f)!.stamp.slice(0, 8)));
    for (let d = 0; d < 14; d++) expect(keptDays.has(stampOf(new Date(Date.UTC(2026, 9, 11 - d, 8))).slice(0, 8))).toBe(true);
    // 22-27 Sep are older than 14 days; the oldest copy of September (22 Sep, monthly) stays, the rest go
    expect(r.remove.some((f) => f.includes("20260923T"))).toBe(true);
    expect(r.keep.some((f) => f.includes("20260922T"))).toBe(true);
  });

  it("two copies on one day: the newest of the day is the daily copy", () => {
    const files = [...set("2026-10-11T06:00:00Z"), ...set("2026-10-11T11:00:00Z"), ...set("2026-10-10T08:00:00Z")];
    // squeeze the policy so the day rule decides: 1 daily, 0 monthly
    const r = selectRetention(files, NOW, { daily: 1, monthly: 0 });
    expect(r.keep.every((f) => f.includes("20261011T110000Z"))).toBe(true);
    expect(r.remove.some((f) => f.includes("20261011T060000Z"))).toBe(true);
    expect(r.remove.some((f) => f.includes("20261010T"))).toBe(true);
  });

  it("monthly: the OLDEST copy of each of the 3 most recent months is kept, older months go", () => {
    const files: string[] = [];
    for (const iso of ["2026-06-03T08:00:00Z", "2026-06-20T08:00:00Z", "2026-07-02T08:00:00Z", "2026-07-25T08:00:00Z", "2026-08-05T08:00:00Z", "2026-09-04T08:00:00Z", "2026-09-28T08:00:00Z", "2026-10-02T08:00:00Z"]) files.push(...set(iso));
    const r = selectRetention(files, NOW, { daily: 1, monthly: 3 });
    const kept = new Set(r.keep.map((f) => parseBackupName(f)!.stamp));
    expect(kept.has("20261002T080000Z")).toBe(true); // October: also the newest copy
    expect(kept.has("20260904T080000Z")).toBe(true); // September: its oldest
    expect(kept.has("20260805T080000Z")).toBe(true); // August: its only copy
    expect(kept.has("20260928T080000Z")).toBe(false);
    expect(kept.has("20260702T080000Z")).toBe(false); // July is the 4th month back
    expect(kept.has("20260603T080000Z")).toBe(false);
  });

  it("the newest complete set is never removed, even with a hostile policy", () => {
    const files = [...set("2026-10-11T08:00:00Z"), ...set("2026-09-01T08:00:00Z")];
    const r = selectRetention(files, NOW, { daily: 0, monthly: 0 });
    expect(r.keep).toEqual(expect.arrayContaining(set("2026-10-11T08:00:00Z")));
  });

  it("files are kept and removed as whole sets, never one by one", () => {
    const files = [...set("2026-10-11T08:00:00Z"), ...set("2026-09-01T08:00:00Z"), ...set("2026-08-01T08:00:00Z"), ...set("2026-07-01T08:00:00Z"), ...set("2026-06-01T08:00:00Z")];
    const r = selectRetention(files, NOW, { daily: 1, monthly: 1 });
    for (const stamp of new Set(files.map((f) => parseBackupName(f)!.stamp))) {
      const inKeep = r.keep.filter((f) => f.includes(stamp)).length;
      const inRemove = r.remove.filter((f) => f.includes(stamp)).length;
      expect(inKeep === 3 || inRemove === 3, stamp).toBe(true);
    }
  });

  it("never touches a file that is not ours", () => {
    const files = [...set("2026-10-11T08:00:00Z"), "Resume.pdf", "kb-backup-notes.txt", "photo.jpg"];
    const r = selectRetention(files, NOW, { daily: 0, monthly: 0 });
    expect([...r.keep, ...r.remove]).not.toContain("Resume.pdf");
    expect([...r.keep, ...r.remove]).not.toContain("kb-backup-notes.txt");
    expect([...r.keep, ...r.remove]).not.toContain("photo.jpg");
  });

  it("an incomplete set older than 2 days is garbage; a young one may still be being written", () => {
    const old = set("2026-10-05T08:00:00Z").slice(0, 2);
    const young = set("2026-10-11T11:30:00Z").slice(0, 2);
    const good = set("2026-10-10T08:00:00Z");
    const r = selectRetention([...old, ...young, ...good], NOW);
    expect(r.remove).toEqual(expect.arrayContaining(old));
    for (const f of young) expect(r.remove).not.toContain(f);
    expect(r.keep).toEqual(expect.arrayContaining(good));
    // an incomplete newer set never counts as "the newest copy": the good one stays kept
  });

  it("old half-written .tmp files are removed, fresh ones left alone", () => {
    const oldTmp = `kb-backup-${stampOf(new Date("2026-10-05T08:00:00Z"))}-data.sql.gz.gpg.tmp`;
    const freshTmp = `kb-backup-${stampOf(new Date("2026-10-11T11:55:00Z"))}-data.sql.gz.gpg.tmp`;
    const r = selectRetention([...set("2026-10-10T08:00:00Z"), oldTmp, freshTmp], NOW);
    expect(r.remove).toContain(oldTmp);
    expect(r.remove).not.toContain(freshTmp);
  });
});

describe("staleness", () => {
  const NOW = new Date("2026-10-11T12:00:00Z");
  it("no success on record is stale", () => expect(isStale(null, NOW)).toBe(true));
  it("35 hours old is fine, 37 hours is stale (36 h limit)", () => {
    expect(isStale(new Date(NOW.getTime() - 35 * 3600_000).toISOString(), NOW)).toBe(false);
    expect(isStale(new Date(NOW.getTime() - 37 * 3600_000).toISOString(), NOW)).toBe(true);
  });
  it("the limit can be tightened (the 20-hour guard that skips a fresh backup)", () => {
    expect(isStale(new Date(NOW.getTime() - 21 * 3600_000).toISOString(), NOW, 20)).toBe(true);
    expect(isStale(new Date(NOW.getTime() - 19 * 3600_000).toISOString(), NOW, 20)).toBe(false);
  });
  it("a timestamp that cannot be read is stale, never 'fine'", () => expect(isStale("garbage", NOW)).toBe(true));
});

describe("free space (C: also holds Drive's cache - KI-68)", () => {
  it("fails below the margin and says why and how much", () => {
    const v = freeSpaceVerdict(MIN_FREE_BYTES - 1, "C:");
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/C:/);
    expect(v.message).toMatch(/free/i);
  });
  it("passes at the margin", () => expect(freeSpaceVerdict(MIN_FREE_BYTES, "C:").ok).toBe(true));
  it("the margin is 2 GiB", () => expect(MIN_FREE_BYTES).toBe(2 * 1024 ** 3));
});

describe("the data dump: which commands, never dry-run or debug", () => {
  it("asks for data only, COPY format, the three schemas, and excludes every auth credential table", () => {
    const args = buildDataDumpArgs("linked");
    expect(args.slice(0, 3)).toEqual(["db", "dump", "--linked"]);
    expect(args).toEqual(expect.arrayContaining(["--data-only", "--use-copy", "--schema", "public,auth,storage"]));
    const x = args[args.indexOf("-x") + 1]!;
    for (const t of ["auth.refresh_tokens", "auth.sessions", "auth.one_time_tokens", "auth.flow_state", "auth.mfa_factors", "auth.audit_log_entries"]) expect(x.split(",")).toContain(t);
    for (const t of ["storage.buckets", "storage.iceberg_tables", "storage.s3_multipart_uploads"]) expect(x.split(",")).toContain(t);
    expect(x.split(",")).not.toContain("storage.objects");
    expect(x.split(",")).not.toContain("auth.users");
    expect(x.split(",")).not.toContain("auth.identities");
  });
  it("--local is for the rehearsal", () => expect(buildDataDumpArgs("local")[2]).toBe("--local"));
  it("--dry-run prints the temporary database password, --debug prints more: both are refused", () => {
    expect(() => assertSafeArgs(["db", "dump", "--linked", "--dry-run"])).toThrow(/dry-run/);
    expect(() => assertSafeArgs(["db", "dump", "--debug"])).toThrow(/debug/);
    expect(() => assertSafeArgs(["db", "dump", "--log-level", "debug"])).toThrow(/log-level/);
    expect(() => assertSafeArgs(["db", "dump", "--linked"])).not.toThrow();
  });
  it("the excluded tables never overlap the allowed ones", () => {
    for (const t of ALLOWED_AUTH_TABLES) expect(AUTH_EXCLUDE).not.toContain(t);
  });
});

describe("DumpScanner: proves the file holds rows, not just structure (KI-25 note 3)", () => {
  const dump = (blocks: Record<string, string[]>, replica = true) =>
    (replica ? 'SET session_replication_role = replica;\n\n' : "") +
    Object.entries(blocks)
      .map(([t, rows]) => {
        const [s, n] = t.split(".");
        return `COPY "${s}"."${n}" ("id", "name") FROM stdin;\n${rows.map((r) => r + "\n").join("")}\\.\n`;
      })
      .join("\n");
  const everything = (over: Record<string, string[]> = {}) => {
    const blocks: Record<string, string[]> = {};
    for (const t of EXPECTED_PUBLIC_TABLES) blocks[t] = ["1\tx"];
    blocks["auth.users"] = ["u1\ta@b.c"];
    blocks["auth.identities"] = ["i1\tgoogle"];
    return { ...blocks, ...over };
  };

  it("counts the rows of every COPY block", () => {
    const s = new DumpScanner();
    s.feed(dump(everything({ "public.bills": ["1\ta", "2\tb", "3\tc"] })));
    const r = s.finish();
    expect(r.counts["public.bills"]).toBe(3);
    expect(r.counts["public.shops"]).toBe(1);
    expect(r.counts["auth.users"]).toBe(1);
    expect(r.sawReplicaRole).toBe(true);
  });

  it("an empty table is counted as 0 (its COPY header is there, no rows)", () => {
    const s = new DumpScanner();
    s.feed(dump(everything({ "public.learning_events": [] })));
    expect(s.finish().counts["public.learning_events"]).toBe(0);
  });

  it("a stream cut at any byte position gives the same counts (chunk boundaries)", () => {
    const text = dump(everything({ "public.bills": ["1\ta", "2\tb"] }));
    const whole = new DumpScanner();
    whole.feed(text);
    const expected = whole.finish().counts;
    for (const size of [1, 2, 3, 7, 13, 64]) {
      const s = new DumpScanner();
      for (let i = 0; i < text.length; i += size) s.feed(Buffer.from(text.slice(i, i + size)));
      expect(s.finish().counts, `chunk size ${size}`).toEqual(expected);
    }
  });

  it("a row whose text is the two characters backslash-dot inside a value is not a terminator", () => {
    const s = new DumpScanner();
    s.feed('COPY "public"."shops" ("id", "name") FROM stdin;\n1\tShop \\\\.\n2\tother\n\\.\n');
    expect(s.finish().counts["public.shops"]).toBe(2);
  });

  it("a healthy dump has no problems", () => {
    const s = new DumpScanner();
    s.feed(dump(everything()));
    expect(evaluateScan(s.finish())).toEqual([]);
  });

  it("fails when the file has structure but no rows at all", () => {
    const s = new DumpScanner();
    s.feed(dump({}));
    expect(evaluateScan(s.finish()).join(" ")).toMatch(/no rows|empty/i);
  });

  it("fails when an auth CREDENTIAL table slipped in (a refresh token is a live login)", () => {
    const s = new DumpScanner();
    s.feed(dump(everything({ "auth.refresh_tokens": ["t"] })));
    expect(evaluateScan(s.finish()).join(" ")).toMatch(/auth\.refresh_tokens/);
  });

  it("fails when a platform upgrade adds an auth table nobody has judged", () => {
    const s = new DumpScanner();
    s.feed(dump(everything({ "auth.brand_new_table": ["x"] })));
    expect(evaluateScan(s.finish()).join(" ")).toMatch(/auth\.brand_new_table/);
  });

  it("fails when a public table is missing", () => {
    const blocks = everything();
    delete blocks["public.bill_items"];
    const s = new DumpScanner();
    s.feed(dump(blocks));
    expect(evaluateScan(s.finish()).join(" ")).toMatch(/public\.bill_items/);
  });

  it("fails when the shops or the users they depend on are missing: a restore would orphan every shop", () => {
    for (const t of ["public.shops", "public.shop_members", "auth.users", "auth.identities"]) {
      const s = new DumpScanner();
      s.feed(dump(everything({ [t]: [] })));
      expect(evaluateScan(s.finish()).join(" "), t).toMatch(new RegExp(t.replace(".", "\\.")));
    }
  });

  it("fails loudly when Storage has files: the dump only holds their metadata", () => {
    const s = new DumpScanner();
    s.feed(dump(everything({ "storage.objects": ["o1\tlogo.png"] })));
    expect(evaluateScan(s.finish()).join(" ")).toMatch(/storage/i);
  });

  it("fails when a storage table nobody has judged appears (the bucket table differs between platform versions)", () => {
    const s = new DumpScanner();
    s.feed(dump(everything({ "storage.buckets": ["shop-logos"] })));
    expect(evaluateScan(s.finish()).join(" ")).toMatch(/storage\.buckets/);
  });

  it("an empty storage.objects is fine", () => {
    const s = new DumpScanner();
    s.feed(dump(everything({ "storage.objects": [] })));
    expect(evaluateScan(s.finish())).toEqual([]);
  });

  it("fails when the dump does not start by switching triggers off (bills would not load)", () => {
    const s = new DumpScanner();
    s.feed(dump(everything(), false));
    expect(evaluateScan(s.finish()).join(" ")).toMatch(/session_replication_role/);
  });

  it("an unknown schema is a problem", () => {
    const s = new DumpScanner();
    s.feed(dump(everything({ "weird.table": ["x"] })));
    expect(evaluateScan(s.finish()).join(" ")).toMatch(/weird\.table/);
  });
});

describe("public tables the backup insists on (KB-325: bill_cancellations is expected since the db push)", () => {
  const counts: Record<string, number> = { "auth.users": 1, "auth.identities": 1, ...Object.fromEntries(EXPECTED_PUBLIC_TABLES.map((t) => [t, 1])) };
  const ok = { counts, sawReplicaRole: true };
  it("every expected table present: passes; bill_cancellations is among them", () => {
    expect(EXPECTED_PUBLIC_TABLES).toContain("public.bill_cancellations");
    expect(evaluateScan(ok as never)).toEqual([]);
  });
  it("a dump missing bill_cancellations (or any expected table) is a fault", () => {
    const { "public.bill_cancellations": _gone, ...rest } = counts;
    expect(evaluateScan({ ...ok, counts: rest } as never).join(" ")).toMatch(/public\.bill_cancellations is missing/);
  });
});

describe("the list of public tables cannot drift from the migrations", () => {
  it("EXPECTED_PUBLIC_TABLES + PENDING_PUBLIC_TABLES equal every `create table` in supabase/migrations", () => {
    const dir = join(__dirname, "..", "..", "supabase", "migrations");
    const created = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, f), "utf8");
      for (const m of sql.matchAll(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_]+)"?\s*\(/gim)) created.add(`public.${m[1]}`);
    }
    expect([...EXPECTED_PUBLIC_TABLES, ...PENDING_PUBLIC_TABLES].sort()).toEqual([...created].sort());
  });
});

describe("compareCounts (the restore rehearsal)", () => {
  it("equal counts: no mismatch", () => expect(compareCounts({ "public.bills": 5, "auth.users": 2 }, { "public.bills": 5, "auth.users": 2 })).toEqual([]));
  it("names every table that differs, with both numbers", () => {
    const m = compareCounts({ "public.bills": 5, "auth.users": 2 }, { "public.bills": 4, "auth.users": 2 });
    expect(m).toEqual(["public.bills: backup has 5, restored database has 4"]);
  });
  it("a table missing from the restored database is a mismatch, not a pass", () => {
    expect(compareCounts({ "public.bills": 5 }, {}).join(" ")).toMatch(/public\.bills/);
  });
});

describe("redact: nothing secret reaches a log", () => {
  it("masks a Postgres password in every common shape", () => {
    expect(redact('export PGPASSWORD="Abc123xyz"')).not.toMatch(/Abc123xyz/);
    expect(redact("postgresql://postgres:s3cretpw@db.example.co:5432/postgres")).not.toMatch(/s3cretpw/);
    expect(redact("password=hunter2 other")).not.toMatch(/hunter2/);
    expect(redact("PASSWORD: hunter2")).not.toMatch(/hunter2/);
  });
  it("masks tokens: JWTs, Supabase access tokens and secret keys, GitHub tokens", () => {
    // Built from pieces on purpose: a token-SHAPED literal in the source would trip GitHub's push protection.
    const jwt = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dBjftJeZ4CVPmB92K27uhbUJU1p1rWx"].join(".");
    const fakes = [jwt, "sb" + "p_" + "0123456789abcdef0123456789abcdef01234567", "sb_" + "secret_" + "abcdefghijklmnopqrstuvwxyz", "gh" + "o_" + "abcdefghijklmnopqrstuvwxyz0123456789"];
    for (const t of fakes) {
      expect(redact(`token ${t} end`)).not.toContain(t);
    }
  });
  it("leaves ordinary lines alone", () => expect(redact("backup ok: 11 tables, 2 users")).toBe("backup ok: 11 tables, 2 users"));
});
