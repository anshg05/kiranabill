import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { build, type Plugin } from "vite";
import type { SwConfig, SwMode } from "../src/sw/core";
import { assertSafePrecache, selectPrecache } from "../src/sw/precache";

// KB-401 (docs/07-DECISIONS.md D67): after the app is built, turn dist/ into the service worker. No dependency -
// the worker (src/sw) is bundled by Vite itself (a second, tiny build) with the precache list injected.

/** The precache holds the app, not a gallery: a forgotten font family or image must fail the build, not the data plan. */
export const PRECACHE_BUDGET_BYTES = 2 * 1024 * 1024;

export function parseSwMode(value: string | undefined): SwMode {
  const v = (value ?? "").trim();
  if (v === "") return "normal";
  if (v === "normal" || v === "force" || v === "kill") return v;
  throw new Error(`service worker mode (KB_SW_MODE or src/sw/mode.txt) must be normal, force or kill - got "${v}"`);
}

/** The mode: KB_SW_MODE (local proofs) over the committed src/sw/mode.txt - a release decision, reviewed in git. */
export function resolveSwMode(root: string, env: Record<string, string | undefined>): SwMode {
  const file = path.join(root, "src", "sw", "mode.txt");
  return parseSwMode(env.KB_SW_MODE ?? (existsSync(file) ? readFileSync(file, "utf8") : undefined));
}

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export interface DistFile {
  /** Relative to dist/, forward slashes. */
  path: string;
  bytes: Uint8Array;
}

export function buildSwConfig(files: readonly DistFile[], mode: SwMode): SwConfig {
  if (mode === "kill") return { cacheName: "kb-kill", mode, entries: [] };
  const urls = selectPrecache(files.map((f) => f.path));
  assertSafePrecache(urls);
  const byUrl = new Map(files.map((f) => [f.path === "index.html" ? "/" : `/${f.path}`, f]));
  const entries = urls.map((url) => ({ url, rev: sha(byUrl.get(url)!.bytes).slice(0, 12) }));
  const total = urls.reduce((sum, url) => sum + byUrl.get(url)!.bytes.length, 0);
  if (total > PRECACHE_BUDGET_BYTES) throw new Error(`service worker precache is ${total} bytes - over the ${PRECACHE_BUDGET_BYTES} byte budget`);
  return { cacheName: `kb-${sha(entries.map((e) => `${e.url}@${e.rev}`).join("\n")).slice(0, 12)}`, mode, entries };
}

/** "20261009-1530", plus the short commit when Netlify supplies one. KB_BUILD_ID overrides (tests, the update proof). */
export function computeBuildId(env: Record<string, string | undefined>, now: Date): string {
  if (env.KB_BUILD_ID) return env.KB_BUILD_ID;
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  const commit = (env.COMMIT_REF ?? "").slice(0, 7);
  return commit ? `${stamp}-${commit}` : stamp;
}

function listFiles(dir: string, prefix = ""): DistFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : [{ path: `${prefix}${entry.name}`, bytes: readFileSync(path.join(dir, entry.name)) }],
  );
}

export function serviceWorkerPlugin(): Plugin {
  let root = process.cwd();
  let outDir = path.resolve(root, "dist");
  return {
    name: "kiranabill-service-worker",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      if (!existsSync(path.join(outDir, "index.html"))) return; // the app build failed: say nothing more
      const mode = resolveSwMode(root, process.env);
      const files = listFiles(outDir).filter((f) => f.path !== "sw.js");
      const config = buildSwConfig(files, mode);
      await build({
        configFile: false,
        root,
        logLevel: "warn",
        define: { __KB_SW__: JSON.stringify(config) },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: true,
          target: "es2020",
          lib: { entry: path.resolve(root, "src", "sw", "sw.ts"), formats: ["iife"], name: "kbSw", fileName: () => "sw.js" },
        },
      });
      const sizeOf = new Map(files.map((f) => [f.path === "index.html" ? "/" : `/${f.path}`, f.bytes.length]));
      const bytes = config.entries.reduce((sum, e) => sum + (sizeOf.get(e.url) ?? 0), 0);
      console.log(`service worker: mode ${mode}, ${config.entries.length} files precached (${(bytes / 1024).toFixed(0)} KB), cache ${config.cacheName}`);
    },
  };
}
