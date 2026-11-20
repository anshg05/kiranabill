import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * KB-335 / D122 (owner, 20 Nov 2026): which sign-in return addresses does PRODUCTION's Supabase Auth accept? Read-only:
 *   1. start a Google sign-in (PKCE) for each address - the public key from the live website's bundle (never printed);
 *      Supabase answers with a redirect to Google whose `state` is the id of its auth.flow_state row;
 *   2. read ONLY that row's `referrer` (`npx supabase db query --linked`, the owner's CLI login): the address Supabase will
 *      return to - the one asked for when the Redirect URLs allow it, else the Site URL.
 * Nobody signs in; the unfinished rows are discarded by Supabase. Exit 1 when the answer differs from the list below.
 *   npm run check:redirects
 */

/** The exact Redirect URLs (docs/17 M-54): the website, release-draft, the real app, KVB Test. */
export const MUST_ACCEPT = [
  "https://kiranabilling.netlify.app/",
  "https://release-draft--kiranabilling.netlify.app/",
  "com.kiranavoicebill.app://auth-callback",
  "com.kiranavoicebill.app.test://auth-callback",
] as const;

/** Lookalikes and leftovers that must fall back to the Site URL. */
export const MUST_REFUSE = [
  "https://evil--kiranabilling.netlify.app/",
  "https://release-draft--kiranabilling.netlify.app/x",
  "https://kiranabilling.netlify.app.evil.example/",
  "http://kiranabilling.netlify.app/",
  "https://KIRANABILLING.netlify.app/",
  "com.kiranavoicebill.app://other",
  "com.kiranavoicebill.app.test://auth-callback/x",
  "http://localhost:5173/",
  "https://evil.example/",
] as const;

/**
 * Not checked either way: another page on the Site URL's own address (https://kiranabilling.netlify.app/anything) stayed accepted after
 * the wildcard entries were removed (20 Nov 2026) - Supabase Auth appears to trust every page of its Site URL whatever the list says.
 * Those pages are our own site, so it is no lookalike; it is reported, not judged.
 */
export const SITE_OWN_PAGE = "https://kiranabilling.netlify.app/anything/deeper";

export interface Verdict {
  url: string;
  want: "accept" | "refuse";
  got: "accepted" | "refused" | "unknown";
  ok: boolean;
}

/** referrers: flow-state id -> the address Supabase stored. A probe is accepted only when the stored address is exactly the one asked for. */
export function verdicts(probes: { url: string; state: string | null }[], referrers: Record<string, string>): Verdict[] {
  return probes.map(({ url, state }) => {
    const want = (MUST_ACCEPT as readonly string[]).includes(url) ? "accept" : "refuse";
    const ref = state ? referrers[state] : undefined;
    const got = ref === undefined ? "unknown" : ref === url ? "accepted" : "refused";
    return { url, want, got, ok: got !== "unknown" && (got === "accepted") === (want === "accept") };
  });
}

const SITE = "https://kiranabilling.netlify.app";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function publicConfig(): Promise<{ url: string; key: string }> {
  const html = await (await fetch(`${SITE}/`)).text();
  let url: string | undefined;
  let key: string | undefined;
  for (const m of html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)) {
    const js = await (await fetch(SITE + m[1])).text();
    url ??= /https:\/\/[a-z0-9]{20}\.supabase\.co/.exec(js)?.[0];
    key ??= /(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_[\w-]+)/.exec(js)?.[0];
  }
  if (!url || !key) throw new Error("the project URL or the public key was not found in the live bundle");
  return { url, key };
}

async function main(): Promise<void> {
  const { url, key } = await publicConfig();
  const probes: { url: string; state: string | null }[] = [];
  for (const target of [...MUST_ACCEPT, ...MUST_REFUSE, SITE_OWN_PAGE]) {
    const q = new URLSearchParams({ provider: "google", redirect_to: target, code_challenge: "x".repeat(43), code_challenge_method: "s256" });
    const res = await fetch(`${url}/auth/v1/authorize?${q}`, { redirect: "manual", headers: { apikey: key } });
    const state = new URL(res.headers.get("location") ?? "http://x/").searchParams.get("state");
    probes.push({ url: target, state: state && UUID.test(state) ? state : null });
  }
  const ids = probes.flatMap((p) => (p.state ? [`'${p.state}'`] : []));
  const sqlFile = join(mkdtempSync(join(tmpdir(), "kvb-redirects-")), "q.sql");
  writeFileSync(sqlFile, `select id::text as id, referrer from auth.flow_state where id::text in (${ids.join(",")})`);
  const out = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["supabase", "db", "query", "--linked", "-f", sqlFile], { encoding: "utf8", shell: process.platform === "win32" });
  const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { rows: { id: string; referrer: string }[] };
  const referrers = Object.fromEntries(json.rows.map((r) => [r.id, r.referrer]));
  const own = probes.find((p) => p.url === SITE_OWN_PAGE)!;
  const v = verdicts(probes.filter((p) => p !== own), referrers);
  for (const x of v) console.log(`${x.ok ? "OK  " : "FAIL"}  ${x.got.padEnd(8)}  (must ${x.want})  ${x.url}`);
  console.log(`info  ${own.state && referrers[own.state] === SITE_OWN_PAGE ? "accepted" : "refused "}  (our own site, reported only)  ${SITE_OWN_PAGE}`);
  const bad = v.filter((x) => !x.ok).length;
  console.log(bad ? `\n${bad} of ${v.length} differ from the exact list.` : `\nAll ${v.length} as the exact list says.`);
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
