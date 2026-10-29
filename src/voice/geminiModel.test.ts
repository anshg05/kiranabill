import { describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_MODEL, resolveGeminiModel } from "./geminiModel";

// KB-360 (owner, 29 Oct 2026): gemini-2.5-flash-lite is gone for new projects. The model is a Netlify variable (GEMINI_MODEL) so the next
// change needs no code - but only an EXACT, pinned name is ever used: a "-latest" alias can change underneath a tested prompt.

describe("DEFAULT_GEMINI_MODEL", () => {
  it("is the model the owner picked after measuring (29 Oct 2026), exactly, never an alias", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
    expect(DEFAULT_GEMINI_MODEL).not.toMatch(/latest/);
  });
});

describe("resolveGeminiModel", () => {
  it("nothing set (or only blanks) -> the default, nothing to complain about", () => {
    for (const raw of [undefined, "", "   "]) expect(resolveGeminiModel(raw)).toEqual({ model: DEFAULT_GEMINI_MODEL, ignored: false });
  });
  it("an exact model name is used as it is (trimmed)", () => {
    expect(resolveGeminiModel("gemini-3.6-flash")).toEqual({ model: "gemini-3.6-flash", ignored: false });
    expect(resolveGeminiModel(" gemini-3.5-flash-lite ")).toEqual({ model: "gemini-3.5-flash-lite", ignored: false });
    expect(resolveGeminiModel("gemini-3.1-flash-lite").model).toBe("gemini-3.1-flash-lite");
  });
  it("a '-latest' alias is NEVER used (it can change underneath a tested prompt): the default, and the caller is told", () => {
    for (const raw of ["gemini-flash-latest", "gemini-3.5-flash-lite-latest", "gemini-flash-lite-latest", "GEMINI-FLASH-LATEST"]) {
      expect(resolveGeminiModel(raw), raw).toEqual({ model: DEFAULT_GEMINI_MODEL, ignored: true });
    }
  });
  it("anything that is not shaped like a model name is ignored, never put in a URL", () => {
    for (const raw of ["../../etc", "gemini 3.5", "models/gemini-3.5-flash-lite", "gemini-3.5?key=x", "a", "gemini/3.5", "x".repeat(80), "Gemini-3.5-Flash"]) {
      expect(resolveGeminiModel(raw), raw).toEqual({ model: DEFAULT_GEMINI_MODEL, ignored: true });
    }
  });
});
