import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filesWithMarkers } from "./check-recorder-absent";

// KB-364: the check that keeps the draft-only recorder out of production.

const dist = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kb-dist-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
};

describe("filesWithMarkers", () => {
  it("finds a marker in any text asset, nested, and names the file", () => {
    const dir = dist({ "index.html": "<html>", "assets/index-a1.js": "x", "assets/Recorder-b2.js": 'data-testid="kb-acceptance-recorder"' });
    expect(filesWithMarkers(dir)).toEqual([{ file: path.join("assets", "Recorder-b2.js"), marker: "kb-acceptance-recorder" }]);
  });
  it("finds the page title and the database name too", () => {
    const dir = dist({ "assets/a.js": 'h1("Acceptance session") new Dexie("kb-acceptance-session")' });
    expect(filesWithMarkers(dir).map((h) => h.marker).sort()).toEqual(["Acceptance session", "kb-acceptance-session"]);
  });
  it("a clean build has none", () => {
    expect(filesWithMarkers(dist({ "index.html": "<html>", "assets/index.js": "billing" }))).toEqual([]);
  });
});
