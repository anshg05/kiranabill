import { describe, expect, it } from "vitest";
import { matchCommand } from "./commands";
import { catalog } from "./catalog";

describe("matchCommand - finalize", () => {
  it.each(["bas", "ho gaya", "hogaya", "bill bana", "bill banao", "total", "done", "complete", "khatam", "finish"])(
    "%s finalises",
    (text) => {
      expect(matchCommand(text)).toBe("finalize");
    },
  );

  it("बस (Devanagari) finalises", () => {
    expect(matchCommand("बस")).toBe("finalize");
  });

  it("हो गया (Devanagari) finalises", () => {
    expect(matchCommand("हो गया")).toBe("finalize");
  });

  it("a command word among fillers still finalises - 'theek hai bas'", () => {
    expect(matchCommand("theek hai bas")).toBe("finalize");
  });

  it("a command word among known fillers still finalises - 'bas bhai'", () => {
    expect(matchCommand("bas bhai")).toBe("finalize");
  });
});

describe("matchCommand - removeLast", () => {
  it.each(["hatao", "hata do", "last hatao", "pichla hatao", "remove", "undo", "wapas", "delete"])(
    "%s removes the last line",
    (text) => {
      expect(matchCommand(text)).toBe("removeLast");
    },
  );

  it("हटाओ (Devanagari) removes the last line", () => {
    expect(matchCommand("हटाओ")).toBe("removeLast");
  });
});

describe("matchCommand - clearAll", () => {
  it.each(["sab hatao", "clear karo", "sab delete"])("%s clears everything", (text) => {
    expect(matchCommand(text)).toBe("clearAll");
  });

  it("सब हटाओ (Devanagari) clears everything", () => {
    expect(matchCommand("सब हटाओ")).toBe("clearAll");
  });

  it("longest match wins - 'sab hatao' is clearAll, not removeLast, even though it contains the token 'hatao'", () => {
    expect(matchCommand("sab hatao")).toBe("clearAll");
  });
});

describe("matchCommand - KI-02 regression (docs/14-LEGACY-REFERENCE.md section 11)", () => {
  it("a bare product name is never a command - 'basmati'", () => {
    expect(matchCommand("basmati")).toBeNull();
  });

  it("a bare product alias is never a command - 'basmati chawal'", () => {
    expect(matchCommand("basmati chawal")).toBeNull();
  });

  it("a product line with a digit is never a command - '2 kilo basmati'", () => {
    expect(matchCommand("2 kilo basmati")).toBeNull();
  });

  it("a command word with a price attached is never a command - 'bas 5'", () => {
    expect(matchCommand("bas 5")).toBeNull();
  });

  it("too many tokens is never a command, even containing a command word", () => {
    expect(matchCommand("ek do teen char paanch che bas")).toBeNull();
  });
});

describe("matchCommand - non-commands", () => {
  it("empty text is not a command", () => {
    expect(matchCommand("")).toBeNull();
  });

  it("an ordinary bill line is not a command", () => {
    expect(matchCommand("2 kilo chini 90 rupay")).toBeNull();
  });

  it("a lone filler word is not a command", () => {
    expect(matchCommand("haan")).toBeNull();
  });
});

describe("matchCommand - full catalog sweep (docs/18-AGENT-CONTRACT.md section 8: all 482 aliases, zero trigger a command)", () => {
  it("no catalog alias, of any of the 482 products, ever matches a command", () => {
    const falsePositives: string[] = [];
    for (const entry of catalog) {
      for (const alias of entry.aliases) {
        if (matchCommand(alias) !== null) {
          falsePositives.push(`${entry.id} "${alias}" -> ${matchCommand(alias)}`);
        }
      }
    }
    expect(falsePositives).toEqual([]);
  });
});
