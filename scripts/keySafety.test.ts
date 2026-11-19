import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// D117 (owner, 19 Nov 2026): the release key never enters the repo, and no password or key path is written in it. The key file lives
// OUTSIDE the repo (C:\Users\ANSH\KVB-keys); Gradle reads its path and password only from environment variables that
// scripts/release-apk.ps1 sets for one build after a hidden prompt.

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const ignored = (rel: string) => {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", rel], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

describe("the release key stays out of the repo", () => {
  it("git ignores key files and key settings anywhere in the repo", () => {
    const names = ["release.jks", "release.keystore", "release.p12", "release.pfx", "keystore.properties"];
    const dirs = ["", "android/", "android/app/", "deep/folder/"];
    const notIgnored = dirs.flatMap((d) => names.map((n) => `${d}${n}`)).filter((p) => !ignored(p));
    expect(notIgnored).toEqual([]);
  });

  it("build.gradle holds no password and no key path - only the environment variables", () => {
    const gradle = read("android/app/build.gradle");
    expect(gradle).not.toMatch(/(store|key)Password\s*['"=(]?\s*['"]/);
    expect(gradle).not.toMatch(/\.(jks|keystore|p12|pfx)\b/i);
    expect(gradle).toMatch(/storeFile file\(System\.getenv\("KVB_RELEASE_KEYSTORE"\)\)/);
    expect(gradle).toMatch(/storePassword System\.getenv\("KVB_RELEASE_STORE_PASSWORD"\)/);
    expect(gradle).toMatch(/keyAlias "kvb-release"/);
    expect(gradle).toMatch(/release \{[^}]*signingConfig signingConfigs\.release/);
    expect(gradle).toMatch(/throw new GradleException\("A release build needs the release key/); // never an unsigned release
  });

  it("the release script asks for the password hidden, sets it for one build only, and clears it", () => {
    const ps = read("scripts/release-apk.ps1");
    expect(ps).toMatch(/Read-Host -AsSecureString/);
    expect(ps).toMatch(/Remove-Item Env:KVB_RELEASE_STORE_PASSWORD/);
    expect(ps).toMatch(/gradlew\.bat --stop/); // the daemon held the password in memory
    expect(ps).not.toMatch(/Write-(Host|Output)[^\n]*\$plain/);
  });
});
