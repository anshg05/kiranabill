import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D120 (owner, 20 Nov 2026): docs/27-PLAY-DATA-SAFETY.md is what the owner types into Play Console's Data safety form; /privacy is what
// users read. They must say the same thing: every data type the form declares is described on the privacy page (in English), the URLs
// are the pages that exist, and nothing is declared shared.

const root = join(__dirname, "..", "..");
const doc = readFileSync(join(root, "docs", "27-PLAY-DATA-SAFETY.md"), "utf8");
const privacy = readFileSync(join(root, "public", "privacy.html"), "utf8");
const english = privacy.slice(privacy.indexOf('id="english"'), privacy.indexOf('id="hindi"'));

/** each declared Play data type -> the privacy page's own words for it */
const POLICY_WORDS: Record<string, string> = {
  Name: "your name",
  "Email address": "your email address",
  "User IDs": "your Google account id",
  "Phone number": "name and phone number",
  "Purchase history": "Your bills:",
  "Voice or sound recordings": "Voice recordings",
  "App interactions": "Usage numbers for each bill",
  "Other user-generated content": "the products and prices you add",
  Diagnostics: "Diagnostics",
  "Device or other IDs": "A device id",
};

const declared = () => {
  const rows = doc.split("## 2. Data types")[1]!.split("**Not collected")[0]!.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Play category") && !l.startsWith("|---"));
  return rows.map((r) => {
    const c = r.split(" | ").map((x) => x.replace(/^\|\s*/, "").replace(/\*\*/g, "").trim());
    return { type: c[1]!, collected: c[2]!, shared: c[3]! };
  });
};

describe("the Play Data safety form (docs/27) and /privacy say the same thing", () => {
  it("declares exactly these types - every one collected, none shared", () => {
    const d = declared();
    expect(d.map((x) => x.type).sort()).toEqual(Object.keys(POLICY_WORDS).sort());
    for (const x of d) expect([x.type, x.collected, x.shared]).toEqual([x.type, "Yes", "No"]);
  });

  it("every declared type is described on the privacy page", () => {
    for (const [type, words] of Object.entries(POLICY_WORDS)) expect(english, type).toContain(words);
  });

  it("the URLs are the real pages; deletion, encryption and no ads are answered", () => {
    expect(doc).toContain("`https://kiranabilling.netlify.app/delete-account`");
    expect(doc).toContain("`https://kiranabilling.netlify.app/privacy`");
    expect(doc).toMatch(/Is all of the user data collected by your app encrypted in transit\? \| \*\*Yes\*\*/);
    expect(doc).toMatch(/Do you provide a way for users to request that their data is deleted\? \| \*\*Yes\*\*/);
    expect(doc).toMatch(/Ads: does your app contain ads\? \| \*\*No\*\*/);
    expect(english).toContain("no advertising or tracking tools");
  });

  it("location is not declared as collected - and the privacy page says the app never reads it", () => {
    expect(declared().some((x) => /location/i.test(x.type))).toBe(false);
    expect(english).toContain("never reads your location");
  });
});
