import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MUST_ACCEPT, MUST_REFUSE, verdicts } from "./checkRedirects";

// KB-335 / D122: the production redirect check's own logic - accepted means Supabase stored EXACTLY the address asked for.

describe("check:redirects", () => {
  it("an exact entry stored as asked = accepted; a lookalike stored as the Site URL = refused", () => {
    const v = verdicts(
      [
        { url: MUST_ACCEPT[0], state: "a" },
        { url: MUST_REFUSE[0], state: "b" },
      ],
      { a: MUST_ACCEPT[0], b: "https://kiranabilling.netlify.app" },
    );
    expect(v.map((x) => [x.got, x.ok])).toEqual([["accepted", true], ["refused", true]]);
  });

  it("a lookalike Supabase accepts fails the check; so does a needed address it refuses", () => {
    const v = verdicts(
      [
        { url: "https://evil--kiranabilling.netlify.app/", state: "a" },
        { url: "com.kiranavoicebill.app://auth-callback", state: "b" },
      ],
      { a: "https://evil--kiranabilling.netlify.app/", b: "https://kiranabilling.netlify.app" },
    );
    expect(v.map((x) => x.ok)).toEqual([false, false]);
  });

  it("no state or no row = unknown = a failure, never a pass", () => {
    expect(verdicts([{ url: MUST_ACCEPT[0], state: null }, { url: MUST_REFUSE[0], state: "z" }], {}).map((x) => [x.got, x.ok])).toEqual([["unknown", false], ["unknown", false]]);
  });

  it("the check's list is the one written in docs/17 M-54 (\"Now\")", () => {
    const row = readFileSync(join(__dirname, "..", "docs", "17-MANUAL-TASKS.md"), "utf8").split("\n").find((l) => l.startsWith("| M-54 |"))!;
    const now = row.split("Redirect URLs exactly:**")[1]!.split("**Before")[0]!;
    expect([...now.matchAll(/`([^`]+)`/g)].map((m) => m[1])).toEqual([...MUST_ACCEPT]);
  });

  it("the exact list: the website, release-draft, the real app, KVB Test - no wildcard anywhere", () => {
    expect([...MUST_ACCEPT]).toEqual(["https://kiranabilling.netlify.app/", "https://release-draft--kiranabilling.netlify.app/", "com.kiranavoicebill.app://auth-callback", "com.kiranavoicebill.app.test://auth-callback"]);
    for (const u of MUST_ACCEPT) expect(u).not.toContain("*");
    for (const u of MUST_REFUSE) expect(MUST_ACCEPT as readonly string[]).not.toContain(u);
    // the lookalikes that matter stay judged: another site's name in front of ours, and a path under release-draft
    expect(MUST_REFUSE).toContain("https://evil--kiranabilling.netlify.app/");
    expect(MUST_REFUSE).toContain("https://release-draft--kiranabilling.netlify.app/x");
  });
});
