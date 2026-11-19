import { describe, expect, it } from "vitest";
import { releaseWebEnv } from "./buildReleaseWeb";

// D117 (owner, 19 Nov 2026): the web build that goes into a release APK. The real app: the PRODUCTION functions site, build id
// app-v<versionCode>, no test setting. The release-signed test app: the functions-site DRAFT, the test setting, its own test-vN id.

describe("releaseWebEnv", () => {
  it("the real app: production functions site, app-v<versionCode>, never the test setting", () => {
    expect(releaseWebEnv("prod", 2)).toEqual({ VITE_VOICE_RUN_URL: "https://kiranavoicebill-api.netlify.app/voice-run", KB_BUILD_ID: "app-v2" });
  });
  it("the test app: the draft, VITE_APP_VARIANT=test, its own id", () => {
    expect(releaseWebEnv("kvbtest", 2, "test-v3")).toEqual({ VITE_VOICE_RUN_URL: "https://fn-draft--kiranavoicebill-api.netlify.app/voice-run", KB_BUILD_ID: "test-v3", VITE_APP_VARIANT: "test" });
  });
  it("refuses a test build without a test-vN id, and a real build given one", () => {
    expect(() => releaseWebEnv("kvbtest", 2)).toThrow(/test-vN/);
    expect(() => releaseWebEnv("prod", 2, "test-v3")).toThrow(/prod/);
  });
});
