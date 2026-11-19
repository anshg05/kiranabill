// D117 (owner, 19 Nov 2026): the web build for a release APK (docs/23 item 4f). The production VITE values come from Netlify and are
// passed straight to `npm run build` as process variables - only their names and LENGTHS are printed, nothing is written to disk.
//   npx tsx scripts/buildReleaseWeb.ts prod              -> the real app (app-v<versionCode>, the production functions site)
//   npx tsx scripts/buildReleaseWeb.ts kvbtest test-v3   -> the release-signed test app (the functions-site draft)
// Then `npx cap sync android` and scripts/release-apk.ps1 with the same flavour.
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function releaseWebEnv(flavor: "prod" | "kvbtest", versionCode: number, testId?: string): Record<string, string> {
  if (flavor === "prod") {
    if (testId) throw new Error("a prod build takes no test id");
    return { VITE_VOICE_RUN_URL: "https://kiranavoicebill-api.netlify.app/voice-run", KB_BUILD_ID: `app-v${versionCode}` };
  }
  if (!testId || !/^test-v\d+$/.test(testId)) throw new Error("a kvbtest build needs its id: test-vN");
  return { VITE_VOICE_RUN_URL: "https://fn-draft--kiranavoicebill-api.netlify.app/voice-run", KB_BUILD_ID: testId, VITE_APP_VARIANT: "test" };
}

if (process.argv[1] && /buildReleaseWeb/.test(process.argv[1])) {
  const [flavor, testId] = process.argv.slice(2);
  if (flavor !== "prod" && flavor !== "kvbtest") throw new Error("usage: buildReleaseWeb.ts prod | kvbtest test-vN");
  const { versionCode } = JSON.parse(readFileSync("app-version.json", "utf8")) as { versionCode: number };
  const extra = releaseWebEnv(flavor, versionCode, testId);
  const all = JSON.parse(execSync("npx netlify env:list --site kiranabilling --context production --scope builds --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as Record<string, string>;
  const pick: Record<string, string> = {};
  for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
    const v = all[name];
    if (typeof v !== "string" || !v) throw new Error(`${name}: missing on Netlify`);
    pick[name] = v;
    console.log(`${name}: set, ${v.length} chars`);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, ...pick, ...extra };
  if (flavor === "prod") delete env.VITE_APP_VARIANT;
  delete env.VITE_ACCEPTANCE;
  console.log(`build: ${flavor}, ${extra.KB_BUILD_ID}, voice server ${extra.VITE_VOICE_RUN_URL}`);
  const r = spawnSync("npm run build", { env, shell: true, encoding: "utf8" });
  console.log((r.stdout ?? "").split("\n").slice(-4).join("\n"));
  if (r.status !== 0) {
    console.log((r.stderr ?? "").split("\n").slice(-15).join("\n"));
    process.exit(r.status ?? 1);
  }
}
