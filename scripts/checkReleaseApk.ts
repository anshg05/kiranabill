// D117 (owner, 19 Nov 2026): a release APK's checks before it reaches any phone (docs/23 item 4f). Prints each problem and the
// certificate's SHA-256 (public, not secret); exits 1 on any problem.
//   npx tsx scripts/checkReleaseApk.ts <apk> --flavor prod --version-code 2 --build-id app-v2 \
//     --voice-run-url https://kiranavoicebill-api.netlify.app/voice-run [--cert <sha256 recorded in D117>]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface ApkFacts {
  /** aapt2 dump badging */
  badging: string;
  /** apksigner verify --print-certs -v */
  signer: string;
  /** assets/capacitor.config.json */
  capConfig: string;
  /** every assets/public/assets/*.js */
  bundles: string[];
}

export interface ApkExpect {
  flavor: "prod" | "kvbtest";
  versionCode: number;
  buildId: string;
  voiceRunUrl: string;
  /** the release certificate's SHA-256, once recorded (D117) */
  certSha256?: string;
}

/** Strings only the test app or a draft may carry - never the real app's production bundle. */
const NOT_IN_PRODUCTION = ["77636ea8-8058-44ef-9762-76dfc47e5502", "f7c9ac31-ab78-4367-9aa1-49dd5f2e57d4", "Use the TEST Google account", "com.kiranavoicebill.app.test", "fn-draft--kiranavoicebill-api", "release-draft--kiranabilling"];

export function checkApk(f: ApkFacts, e: ApkExpect): { problems: string[]; certSha256: string | null } {
  const problems: string[] = [];
  const certSha256 = /certificate SHA-256 digest: ([0-9a-f]{64})/.exec(f.signer)?.[1] ?? null;
  if (!/Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(f.signer) && !/Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(f.signer)) problems.push("not signed with APK Signature Scheme v2 or v3");
  if (/certificate DN: .*CN=Android Debug/.test(f.signer)) problems.push("signed with the DEBUG certificate");
  if (!certSha256) problems.push("no certificate SHA-256 found");
  else if (e.certSha256 && certSha256 !== e.certSha256.toLowerCase()) problems.push(`certificate SHA-256 ${certSha256} is not the recorded ${e.certSha256}`);

  if (/^application-debuggable/m.test(f.badging)) problems.push("the APK is debuggable");
  const pkg = /package: name='([^']+)'/.exec(f.badging)?.[1];
  const wantPkg = e.flavor === "prod" ? "com.kiranavoicebill.app" : "com.kiranavoicebill.app.test";
  if (pkg !== wantPkg) problems.push(`package ${pkg}, expected ${wantPkg}`);
  const code = Number(/versionCode='(\d+)'/.exec(f.badging)?.[1]);
  if (code !== e.versionCode) problems.push(`versionCode ${code}, expected ${e.versionCode}`);

  let cap: { server?: { url?: unknown }; android?: { webContentsDebuggingEnabled?: unknown } } = {};
  try {
    cap = JSON.parse(f.capConfig) as typeof cap;
  } catch {
    problems.push("capacitor.config.json is missing or not JSON");
  }
  if (cap.server?.url) problems.push("capacitor.config.json has server.url - the screens would not come from the APK");
  if (cap.android?.webContentsDebuggingEnabled === true) problems.push("capacitor.config.json turns WebView debugging on");

  const js = f.bundles.join("\n");
  if (!js.includes(e.voiceRunUrl)) problems.push(`the bundle lacks ${e.voiceRunUrl}`);
  if (!js.includes(e.buildId)) problems.push(`the bundle lacks the build id ${e.buildId}`);
  if (e.flavor === "prod") for (const s of NOT_IN_PRODUCTION) if (js.includes(s)) problems.push(`the bundle contains "${s}"`);
  return { problems, certSha256 };
}

const BUILD_TOOLS = "E:/Android/Sdk/build-tools/36.0.0";
const JAR = "E:/Android/jdk-21/bin/jar.exe";

function factsOf(apk: string): ApkFacts {
  const badging = execFileSync(`${BUILD_TOOLS}/aapt2.exe`, ["dump", "badging", apk], { encoding: "utf8" });
  const signer = execFileSync("cmd", ["/c", `${BUILD_TOOLS}/apksigner.bat`.replace(/\//g, "\\"), "verify", "--print-certs", "-v", apk], { encoding: "utf8" });
  const dir = mkdtempSync(path.join(tmpdir(), "kb-apk-"));
  try {
    const entries = execFileSync(JAR, ["tf", path.resolve(apk)], { encoding: "utf8" }).split(/\r?\n/).filter((n) => n === "assets/capacitor.config.json" || /^assets\/public\/assets\/[^/]+\.js$/.test(n));
    execFileSync(JAR, ["xf", path.resolve(apk), ...entries], { cwd: dir });
    const jsDir = path.join(dir, "assets", "public", "assets");
    let capConfig = "";
    try {
      capConfig = readFileSync(path.join(dir, "assets", "capacitor.config.json"), "utf8");
    } catch {
      // reported by checkApk
    }
    const bundles = readdirSync(jsDir).filter((n) => n.endsWith(".js")).map((n) => readFileSync(path.join(jsDir, n), "utf8"));
    return { badging, signer, capConfig, bundles };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && /checkReleaseApk/.test(process.argv[1])) {
  const [apk, ...rest] = process.argv.slice(2);
  const arg = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const flavor = arg("flavor");
  if (!apk || (flavor !== "prod" && flavor !== "kvbtest") || !arg("version-code") || !arg("build-id") || !arg("voice-run-url")) {
    console.error("usage: checkReleaseApk.ts <apk> --flavor prod|kvbtest --version-code N --build-id ID --voice-run-url URL [--cert SHA256]");
    process.exit(2);
  }
  const r = checkApk(factsOf(apk), { flavor, versionCode: Number(arg("version-code")), buildId: arg("build-id")!, voiceRunUrl: arg("voice-run-url")!, certSha256: arg("cert") });
  console.log(`certificate SHA-256: ${r.certSha256 ?? "none"}`);
  for (const p of r.problems) console.log(`PROBLEM: ${p}`);
  console.log(r.problems.length === 0 ? "release APK checks: all passed" : `release APK checks: ${r.problems.length} problem(s)`);
  process.exitCode = r.problems.length === 0 ? 0 : 1;
}
