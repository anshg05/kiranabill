// D116 (owner, 19 Nov 2026): before an app release, `npm run check:version` - the versionCode in app-version.json must be above the
// last released one. Each app release is tagged app-v<versionCode> (docs/23 item 4e). Prints one line; exits 1 when it did not go up.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function checkVersionBump(current: number, tags: readonly string[]): { ok: boolean; message: string } {
  const released = tags.map((t) => /^app-v(\d+)$/.exec(t)?.[1]).filter((n): n is string => n !== undefined).map(Number);
  if (released.length === 0) return { ok: true, message: `versionCode ${current} - no app release tagged yet (app-vN)` };
  const last = Math.max(...released);
  return current > last
    ? { ok: true, message: `versionCode ${current} is above the last release app-v${last}` }
    : { ok: false, message: `versionCode ${current} is not above the last release app-v${last} - raise it in app-version.json` };
}

if (process.argv[1] && /checkVersionBump/.test(process.argv[1])) {
  const { versionCode } = JSON.parse(readFileSync("app-version.json", "utf8")) as { versionCode: number };
  const tags = execSync("git tag --list app-v*", { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const r = checkVersionBump(versionCode, tags);
  console.log(r.message);
  process.exitCode = r.ok ? 0 : 1;
}
