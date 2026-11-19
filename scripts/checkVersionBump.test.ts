import { describe, expect, it } from "vitest";
import { checkVersionBump } from "./checkVersionBump";

// D116 (owner, 19 Nov 2026): every app release raises versionCode (app-version.json). A release is tagged app-v<versionCode>; the
// check compares the file with the highest such tag. The minimum-version gate depends on it: an app whose code did not go up could
// never be told to update.

describe("checkVersionBump", () => {
  it("no release tagged yet: passes, and says so", () => {
    expect(checkVersionBump(1, [])).toEqual({ ok: true, message: "versionCode 1 - no app release tagged yet (app-vN)" });
  });
  it("above the last released code: passes", () => {
    expect(checkVersionBump(3, ["app-v1", "app-v2"]).ok).toBe(true);
  });
  it("equal to, or below, the last released code: fails and names both", () => {
    expect(checkVersionBump(2, ["app-v2", "app-v1"])).toEqual({ ok: false, message: "versionCode 2 is not above the last release app-v2 - raise it in app-version.json" });
    expect(checkVersionBump(1, ["app-v2"]).ok).toBe(false);
  });
  it("compares numbers, not text (app-v10 is above app-v9); other tags are ignored", () => {
    expect(checkVersionBump(10, ["app-v9", "app-v10", "pre-old-voice-removal", "app-vx"]).ok).toBe(false);
    expect(checkVersionBump(11, ["app-v9", "app-v10"]).ok).toBe(true);
  });
});
