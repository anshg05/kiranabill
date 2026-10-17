import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGES, MESSAGES, render, translateEnglish, type MessageId } from "./messages";

// KB-332 (D84): the shopkeeper's screen in English / हिन्दी / Hinglish. One catalog, three languages, {placeholders}. The
// owner's three rules (17 Oct 2026): a respectful tone (-एं) everywhere; "Bill Banao", "Theek hai" and "Cash" stay exactly as
// they are in every language; English mode is fully English. Domain sentences stay English at the source (no ripple through
// domain tests, nothing language-specific in a saved draft) and are translated at the screen by their English text.

const ids = Object.keys(MESSAGES) as MessageId[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
const DEVANAGARI = /[ऀ-ॿ]/;

describe("the catalog is whole", () => {
  it("every message has all three languages, none empty", () => {
    for (const id of ids) for (const l of LANGUAGES) expect(MESSAGES[id][l].trim(), `${id}.${l}`).not.toBe("");
  });
  it("every language keeps the same {placeholders} as the English", () => {
    for (const id of ids) {
      expect(placeholders(MESSAGES[id].hi), `${id}.hi`).toEqual(placeholders(MESSAGES[id].en));
      expect(placeholders(MESSAGES[id].hl), `${id}.hl`).toEqual(placeholders(MESSAGES[id].en));
    }
  });
  it("no two messages share an English text (the screen translates domain sentences by it)", () => {
    const seen = new Map<string, string>();
    for (const id of ids) {
      expect(seen.get(MESSAGES[id].en), `${id} repeats ${seen.get(MESSAGES[id].en)}`).toBeUndefined();
      seen.set(MESSAGES[id].en, id);
    }
  });
  it("Hinglish is written in Roman letters; Hindi in Devanagari - except words that stay as they are", () => {
    const KEEP = new Set<string>(ids.filter((id) => !/[A-Za-z]{3}/.test(MESSAGES[id].en.replace(/\{\w+\}/g, "")) || /^(WhatsApp|PDF|SMS|Bill Banao|✓ Theek hai|Theek hai)/.test(MESSAGES[id].en)));
    for (const id of ids) {
      const { en, hi, hl } = MESSAGES[id];
      if (!KEEP.has(id) && en !== hi) expect(DEVANAGARI.test(hi), `${id}.hi should be Devanagari`).toBe(true);
      if (en !== hl && !/चीनी/.test(hl)) expect(DEVANAGARI.test(hl), `${id}.hl should be Roman`).toBe(false);
    }
  });
});

describe("what never changes (owner, 17 Oct 2026)", () => {
  it("'Bill Banao' and 'Theek hai' are exactly the same in every language", () => {
    for (const l of LANGUAGES) {
      expect(render("bill.finalise", {}, l)).toBe("Bill Banao");
      expect(render("flag.ok", {}, l)).toBe("✓ Theek hai");
      expect(render("flag.okButton", {}, l)).toBe("Theek hai");
    }
  });
  it("'Cash' is never translated: no message in any language replaces it, and the customer default is the English word", () => {
    for (const id of ids) for (const l of LANGUAGES) expect(MESSAGES[id][l], `${id}.${l}`).not.toMatch(/नकद/);
  });
  it("English mode is fully English - including the mic button and the recording text", () => {
    expect(render("mic.idle", {}, "en")).toBe("Tap to speak");
    expect(render("voice.listening", {}, "en")).toBe("Listening…");
    expect(render("mic.stop", {}, "en")).toBe("Stop");
    for (const id of ids) expect(DEVANAGARI.test(MESSAGES[id].en.replace(/चीनी/g, "")), `${id}.en has Devanagari`).toBe(false);
  });
  it("the current Hindi mic wording is the हिन्दी mode's text", () => {
    expect(render("mic.idle", {}, "hi")).toBe("बोलने के लिए दबाएं");
    expect(render("voice.listening", {}, "hi")).toBe("सुन रहे हैं…");
    expect(render("mic.stop", {}, "hi")).toBe("रोकें");
  });
  it("the KB-325 / KB-335 wording the owner named is in the catalog", () => {
    expect(render("history.cancelled", {}, "hi")).toBe("रद्द");
    expect(render("signin.refused", {}, "en")).toBe("This account isn't set up for the pilot");
    expect(render("signin.unfinished", {}, "en")).toBe("Sign-in didn't finish — tap Sign in with Google again");
    expect(MESSAGES["signin.refused"].hi).toMatch(DEVANAGARI);
    expect(MESSAGES["signin.unfinished"].hl).not.toMatch(DEVANAGARI);
  });
  it("respectful tone: none of the friendly (-ओ) command forms appear in Hindi", () => {
    const FRIENDLY = /बोलो|दबाओ|करो|जाओ|डालो|चुनो|हटाओ|रखो|देखो|जोड़ो|बदलो|खोलो|रुको/;
    for (const id of ids) expect(MESSAGES[id].hi, id).not.toMatch(FRIENDLY);
  });
});

describe("render", () => {
  it("fills the placeholders, in the chosen language", () => {
    expect(render("undo.removed", { name: "Chini" }, "en")).toBe("Chini removed");
    expect(render("undo.removed", { name: "Chini" }, "hi")).toContain("Chini");
    expect(render("checks.many", { n: 3 }, "hl")).toContain("3");
  });
  it("a missing placeholder is a bug, not a blank", () => {
    expect(() => render("undo.removed", {}, "en")).toThrow(/name/);
  });
  it("an unknown id is a bug, not a blank", () => {
    expect(() => render("nope.nothing" as MessageId, {}, "en")).toThrow();
  });
  it("numbers and amounts pass through untouched in every language", () => {
    for (const l of LANGUAGES) expect(render("flag.rateFar", { rate: "₹5", unit: "kg", usual: "₹45" }, l)).toMatch(/₹5[\s\S]*kg[\s\S]*₹45/);
  });
});

describe("translateEnglish - the sentences the domain builds, said in the chosen language", () => {
  it("English stays as it is; an unknown sentence stays as it is", () => {
    expect(translateEnglish("Price needed", "en")).toBe("Price needed");
    expect(translateEnglish("Some sentence nobody wrote", "hi")).toBe("Some sentence nobody wrote");
  });
  it("an exact sentence", () => {
    expect(translateEnglish("Price needed", "hi")).toBe(MESSAGES["need.price"].hi);
    expect(translateEnglish("Price needed", "hl")).toBe(MESSAGES["need.price"].hl);
  });
  it("a sentence with parts: the parts come through exactly as they were (names, numbers, ₹)", () => {
    const en = `"parle jee" isn't in your catalog yet — added anyway.`;
    expect(translateEnglish(en, "hi")).toContain("parle jee");
    expect(translateEnglish(en, "hi")).not.toBe(en);
    expect(translateEnglish("Rate ₹5/kg — usually ₹45. Check?", "hl")).toMatch(/₹5\/kg[\s\S]*₹45/);
  });
});

describe("every sentence the domain can build has a translation (drift guard - read from the source)", () => {
  const src = (f: string) => readFileSync(join(__dirname, f), "utf8");
  const sample = (s: string) => s.replace(/\$\{[^}]*\}/g, "X").replace(/\\"/g, '"');
  const literals = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => sample((m[1] ?? m[2])!));

  const sentences = [
    ...literals(src("reviewFlags.ts"), /"(?:HIGH|MEDIUM|LOW)",\s*(?:`([^`]*)`|"([^"]*)")/g),
    ...literals(src("billEdit.ts"), /error:\s*(?:`([^`]*)`|"([^"]*)")/g),
    ...literals(src("customer.ts"), /export const [A-Z_]+ = (?:`([^`]*)`|"([^"]*)")/g),
    ...literals(src("shopSettings.ts"), /export const [A-Z_]+ = (?:`([^`]*)`|"([^"]*)")/g),
    // What the hooks build: the voice failures, the capture failures, the offline reason, the parse and save failures.
    ...literals(readFileSync(join(__dirname, "..", "ui", "useVoiceBilling.ts"), "utf8"), /return "([^"]{8,})";|OFFLINE_REASON = "([^"]+)"/g),
    ...literals(readFileSync(join(__dirname, "..", "ui", "useVoiceCapture.ts"), "utf8").split("permission:")[1]!.split("interrupted:")[0]!.replace(/^/, "permission:") + "interrupted:", /: "([^"]{8,})",/g),
    ...literals(readFileSync(join(__dirname, "..", "ui", "useBillLines.ts"), "utf8"), /PARSE_FAILED = "([^"]+)"/g),
    ...literals(readFileSync(join(__dirname, "..", "ui", "useOrderResolver.ts"), "utf8"), /"(Couldn't read the items[^"]*)"/g),
    ...literals(readFileSync(join(__dirname, "..", "data", "finalise.ts"), "utf8"), /SAVE_FAILED = "([^"]+)"/g),
  ].filter((s) => s.length > 8);

  it("found the sentences to check (the scan itself works)", () => {
    expect(sentences.length).toBeGreaterThan(45);
  });
  it("each one is found in the catalog and says something different in Hindi and in Hinglish", () => {
    const missing = sentences.filter((s) => translateEnglish(s, "hi") === s || translateEnglish(s, "hl") === s);
    expect(missing).toEqual([]);
  });
});
