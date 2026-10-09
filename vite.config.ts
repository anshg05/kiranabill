import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { computeBuildId, resolveSwMode, serviceWorkerPlugin } from "./scripts/pwa-build";

const AUDIO_EXTENSIONS: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/wav": "wav" };
const MAX_SAVE_BYTES = 20 * 1024 * 1024;

/**
 * KB-317, DEV SERVER ONLY (`apply: "serve"` - never part of `npm run build`):
 * POST /__dev/save-recording, used by the app's `?save=1`
 * (src/ui/useVoiceBilling.ts). Writes the owner's recording and its
 * transcript/timings to eval/real-audio/<timestamp>.<ext> + .json - a folder
 * that is gitignored (the owner's voice). File names are generated here, never
 * taken from the request.
 */
function devSaveRecording(): Plugin {
  return {
    name: "kiranabill-dev-save-recording",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/save-recording", (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return reply(405, { error: "POST only" });
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= MAX_SAVE_BYTES) chunks.push(c);
        });
        req.on("end", () => {
          try {
            if (size > MAX_SAVE_BYTES) return reply(413, { error: "too large" });
            const { audioBase64, mime, meta } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              audioBase64?: unknown;
              mime?: unknown;
              meta?: unknown;
            };
            if (typeof audioBase64 !== "string" || typeof mime !== "string") return reply(400, { error: "audioBase64 and mime required" });
            const ext = AUDIO_EXTENSIONS[mime.split(";")[0]!.trim().toLowerCase()] ?? "bin";
            const dir = path.resolve(process.cwd(), "eval", "real-audio");
            mkdirSync(dir, { recursive: true });
            const name = new Date().toISOString().replace(/[:.]/g, "-");
            writeFileSync(path.join(dir, `${name}.${ext}`), Buffer.from(audioBase64, "base64"));
            writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ audioFile: `${name}.${ext}`, mime, ...(meta as object) }, null, 2));
            reply(200, { saved: `eval/real-audio/${name}.${ext}` });
          } catch (err) {
            reply(400, { error: String(err) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devSaveRecording(), serviceWorkerPlugin()],
  // KB-401: which build a page is (shown in Settings); the worker is built after the app (scripts/pwa-build.ts).
  // A kill build (src/sw/mode.txt) never registers a worker - see src/pwa/register.ts.
  define: {
    __BUILD_ID__: JSON.stringify(computeBuildId(process.env, new Date())),
    __KB_SW_KILL__: JSON.stringify(resolveSwMode(process.cwd(), process.env) === "kill"),
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  test: {
    globals: true,
    environment: "node",
    // docs/07-DECISIONS.md D35: perf tests run alone, after every other test
    // file. sequence.groupOrder runs groups one after another (each awaited
    // in turn), so "perf" never shares the CPU with "unit" - and it still
    // runs when "unit" has failures (failures are reported, not thrown).
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...configDefaults.exclude, "**/*.perf.test.ts", "**/*.e2e.test.ts"],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "perf",
          include: ["**/*.perf.test.ts"],
          sequence: { groupOrder: 1 },
        },
      },
      // KB-110b: real local-Docker-stack tests (D21, D32 - call the shipped
      // code path). NOT part of `npm test` (which runs only unit + perf, so it
      // never needs Docker); run with `npm run test:e2e`. Required for any
      // sync or schema ticket. Only VITE_-prefixed values are loaded, and each
      // e2e file refuses to run against anything but 127.0.0.1/localhost.
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["**/*.e2e.test.ts"],
          env: loadEnv("test", process.cwd(), "VITE_"),
          testTimeout: 60_000,
          hookTimeout: 60_000,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
