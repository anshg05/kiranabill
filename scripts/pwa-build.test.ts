import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSwConfig, computeBuildId, parseSwMode, resolveSwMode } from "./pwa-build";

// KB-401 (D67): the build step that turns dist/ into the worker's precache list. The cache name is derived from the
// CONTENT of every precached file, so two different builds can never share a cache.
const bytes = (s: string) => new TextEncoder().encode(s);
const FILES = [
  { path: "index.html", bytes: bytes("<html>shell</html>") },
  { path: "assets/index-AAA.js", bytes: bytes("console.log(1)") },
  { path: "assets/index-AAA.css", bytes: bytes("body{}") },
  { path: "assets/index-AAA.js.map", bytes: bytes("{}") },
  { path: "assets/mukta-latin-400-normal-X.woff", bytes: bytes("font") },
  { path: "manifest.webmanifest", bytes: bytes("{}") },
];

describe("buildSwConfig", () => {
  it("lists the precached files with a content revision, in URL order, and leaves the rest out", () => {
    const cfg = buildSwConfig(FILES, "normal");
    expect(cfg.entries.map((e) => e.url)).toEqual(["/", "/assets/index-AAA.css", "/assets/index-AAA.js", "/manifest.webmanifest"]);
    expect(cfg.entries.every((e) => /^[0-9a-f]{12}$/.test(e.rev))).toBe(true);
    expect(cfg.mode).toBe("normal");
  });

  it("is deterministic", () => {
    expect(buildSwConfig(FILES, "normal")).toEqual(buildSwConfig([...FILES].reverse(), "normal"));
  });

  it("a changed byte anywhere in a precached file is a new cache name; a changed .map is not", () => {
    const name = buildSwConfig(FILES, "normal").cacheName;
    expect(name).toMatch(/^kb-[0-9a-f]{12}$/);
    const html = FILES.map((f) => (f.path === "index.html" ? { ...f, bytes: bytes("<html>shell 2</html>") } : f));
    expect(buildSwConfig(html, "normal").cacheName).not.toBe(name);
    const map = FILES.map((f) => (f.path.endsWith(".map") ? { ...f, bytes: bytes("{changed}") } : f));
    expect(buildSwConfig(map, "normal").cacheName).toBe(name);
  });

  it("refuses an unsafe list (assertSafePrecache runs)", () => {
    expect(() => buildSwConfig(FILES.filter((f) => f.path !== "index.html"), "normal")).toThrow(/shell/i);
  });

  it("refuses a precache that has grown past the size budget (a forgotten font family)", () => {
    const big = [...FILES, { path: "assets/huge.png", bytes: new Uint8Array(3 * 1024 * 1024) }];
    expect(() => buildSwConfig(big, "normal")).toThrow(/budget/i);
  });

  it("kill mode precaches nothing", () => {
    const cfg = buildSwConfig(FILES, "kill");
    expect(cfg.entries).toEqual([]);
    expect(cfg.mode).toBe("kill");
  });
});

describe("parseSwMode", () => {
  it("defaults to normal and accepts only the three modes", () => {
    expect(parseSwMode(undefined)).toBe("normal");
    expect(parseSwMode("")).toBe("normal");
    expect(parseSwMode("normal")).toBe("normal");
    expect(parseSwMode("force")).toBe("force");
    expect(parseSwMode("kill")).toBe("kill");
    expect(() => parseSwMode("Force!")).toThrow(/KB_SW_MODE/);
  });
});

describe("computeBuildId", () => {
  const at = new Date("2026-10-09T15:30:45Z");
  it("is the UTC minute, plus the short commit when Netlify supplies one", () => {
    expect(computeBuildId({}, at)).toBe("20261009-1530");
    expect(computeBuildId({ COMMIT_REF: "2e61d70abcdef" }, at)).toBe("20261009-1530-2e61d70");
  });
  it("KB_BUILD_ID overrides (the update proof builds two versions inside one minute)", () => {
    expect(computeBuildId({ KB_BUILD_ID: "v2", COMMIT_REF: "2e61d70" }, at)).toBe("v2");
  });
});

describe("resolveSwMode", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kb-mode-"));
  mkdirSync(path.join(dir, "src", "sw"), { recursive: true });
  const write = (text: string) => writeFileSync(path.join(dir, "src", "sw", "mode.txt"), text);
  it("reads src/sw/mode.txt - the mode is a committed, reviewed file, not a Netlify setting", () => {
    write("normal\n");
    expect(resolveSwMode(dir, {})).toBe("normal");
    write("kill\n");
    expect(resolveSwMode(dir, {})).toBe("kill");
  });
  it("KB_SW_MODE overrides it (local proofs)", () => {
    write("normal\n");
    expect(resolveSwMode(dir, { KB_SW_MODE: "force" })).toBe("force");
  });
  it("a missing file is normal; a bad value fails the build", () => {
    expect(resolveSwMode(path.join(dir, "nowhere"), {})).toBe("normal");
    write("bogus\n");
    expect(() => resolveSwMode(dir, {})).toThrow(/mode/);
    rmSync(dir, { recursive: true, force: true });
  });
});
