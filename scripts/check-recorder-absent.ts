// KB-364 (owner, 30 Oct 2026): the acceptance-order recorder is for DRAFT builds only. This proves a build has none of it: no file in
// dist/ contains the recorder's markers. Run after `npm run build` and before every release marker (docs/23-ACCEPTANCE.md):
//     npm run check:recorder            -> expects a build WITHOUT the recorder (production)
//     npm run check:recorder -- --present   -> expects the recorder (a draft built with VITE_ACCEPTANCE=1)
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MARKERS = ["kb-acceptance-recorder", "kb-acceptance-session", "Acceptance session"] as const;

export function filesWithMarkers(dir: string): { file: string; marker: string }[] {
  const hits: { file: string; marker: string }[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|css|html|map|webmanifest|json)$/.test(name)) {
        const text = readFileSync(p, "utf8");
        for (const marker of MARKERS) if (text.includes(marker)) hits.push({ file: path.relative(dir, p), marker });
      }
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && /check-recorder-absent/.test(process.argv[1])) {
  const expectPresent = process.argv.includes("--present");
  const hits = filesWithMarkers("dist");
  if (expectPresent) {
    if (hits.length === 0) {
      console.error("check:recorder --present: the recorder is NOT in dist/ (was the build made with VITE_ACCEPTANCE=1?)");
      process.exit(1);
    }
    console.log(`check:recorder --present: the recorder is in dist/ (${[...new Set(hits.map((h) => h.file))].join(", ")})`);
  } else {
    if (hits.length > 0) {
      console.error("check:recorder: the acceptance recorder is in this build - NOT for production:");
      for (const h of hits) console.error(`  ${h.file}  (${h.marker})`);
      process.exit(1);
    }
    console.log("check:recorder: no acceptance recorder in dist/ - safe for production");
  }
}
