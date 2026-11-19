import { describe, expect, it } from "vitest";
import { checkApk, type ApkFacts } from "./checkReleaseApk";

// D117 (owner, 19 Nov 2026): the checks a release APK must pass before it reaches a phone - signed with the release key (v2/v3, not the
// debug certificate; its SHA-256 recorded), not debuggable, WebView debugging not forced on, no server.url, and a PRODUCTION bundle:
// the production functions address and build id present; no test account, test hint, test package, draft or release-draft address.

const SHA = "ab".repeat(32);
const GOOD: ApkFacts = {
  badging: "package: name='com.kiranavoicebill.app' versionCode='2' versionName='1.1'\napplication-label:'Kirana Voice Bill'",
  signer: [
    "Verified using v1 scheme (JAR signing): false",
    "Verified using v2 scheme (APK Signature Scheme v2): true",
    "Verified using v3 scheme (APK Signature Scheme v3): true",
    "Signer #1 certificate DN: CN=Kirana Voice Bill, C=IN",
    `Signer #1 certificate SHA-256 digest: ${SHA}`,
  ].join("\n"),
  capConfig: JSON.stringify({ appId: "com.kiranavoicebill.app", server: { androidScheme: "https", hostname: "localhost" } }),
  bundles: ['const a="https://kiranavoicebill-api.netlify.app/voice-run";const b="app-v2";const p="com.kiranavoicebill.app";'],
};
const PROD = { flavor: "prod" as const, versionCode: 2, buildId: "app-v2", voiceRunUrl: "https://kiranavoicebill-api.netlify.app/voice-run" };
const run = (over: Partial<ApkFacts>, exp: Partial<typeof PROD> & { certSha256?: string } = {}) => checkApk({ ...GOOD, ...over }, { ...PROD, ...exp });

describe("checkReleaseApk", () => {
  it("a good production APK passes and reports its certificate's SHA-256", () => {
    expect(run({})).toEqual({ problems: [], certSha256: SHA });
    expect(run({}, { certSha256: SHA }).problems).toEqual([]);
  });

  it("signing: unsigned v2/v3, the debug certificate, or another certificate than the recorded one fail", () => {
    expect(run({ signer: GOOD.signer.replace(/: true/g, ": false") }).problems).toContain("not signed with APK Signature Scheme v2 or v3");
    expect(run({ signer: GOOD.signer.replace("CN=Kirana Voice Bill, C=IN", "C=US, O=Android, CN=Android Debug") }).problems).toContain("signed with the DEBUG certificate");
    expect(run({}, { certSha256: "cd".repeat(32) }).problems[0]).toMatch(/^certificate SHA-256 .* is not the recorded/);
  });

  it("a debuggable APK fails", () => {
    expect(run({ badging: GOOD.badging + "\napplication-debuggable" }).problems).toContain("the APK is debuggable");
  });

  it("the package and versionCode must be the release's", () => {
    expect(run({ badging: GOOD.badging.replace("versionCode='2'", "versionCode='1'") }).problems).toContain("versionCode 1, expected 2");
    expect(run({ badging: GOOD.badging.replace("'com.kiranavoicebill.app'", "'com.kiranavoicebill.app.test'") }).problems).toContain("package com.kiranavoicebill.app.test, expected com.kiranavoicebill.app");
  });

  it("the Capacitor config: no server.url, WebView debugging not forced on", () => {
    expect(run({ capConfig: JSON.stringify({ server: { url: "https://release-draft--kiranabilling.netlify.app" } }) }).problems).toContain("capacitor.config.json has server.url - the screens would not come from the APK");
    expect(run({ capConfig: JSON.stringify({ android: { webContentsDebuggingEnabled: true } }) }).problems).toContain("capacitor.config.json turns WebView debugging on");
  });

  it("a production bundle: the production address and build id present; nothing of the test app or a draft", () => {
    expect(run({ bundles: ['const b="app-v2";'] }).problems).toContain("the bundle lacks https://kiranavoicebill-api.netlify.app/voice-run");
    expect(run({ bundles: ['const a="https://kiranavoicebill-api.netlify.app/voice-run";'] }).problems).toContain("the bundle lacks the build id app-v2");
    for (const bad of ["77636ea8-8058-44ef-9762-76dfc47e5502", "Use the TEST Google account", "com.kiranavoicebill.app.test", "fn-draft--kiranavoicebill-api", "release-draft--kiranabilling"])
      expect(run({ bundles: [...GOOD.bundles, `x="${bad}"`] }).problems, bad).toContain(`the bundle contains "${bad}"`);
  });

  it("the release-signed TEST app (kvbtest) is checked for signing and release only - its test strings are expected", () => {
    const test: ApkFacts = { ...GOOD, badging: GOOD.badging.replace("'com.kiranavoicebill.app'", "'com.kiranavoicebill.app.test'"), bundles: ['x="https://fn-draft--kiranavoicebill-api.netlify.app/voice-run";y="test-v3";z="77636ea8-8058-44ef-9762-76dfc47e5502"'] };
    expect(checkApk(test, { flavor: "kvbtest", versionCode: 2, buildId: "test-v3", voiceRunUrl: "https://fn-draft--kiranavoicebill-api.netlify.app/voice-run" }).problems).toEqual([]);
  });
});
