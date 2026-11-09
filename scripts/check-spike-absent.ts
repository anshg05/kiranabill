// KB-384 (owner, 9 Nov 2026): the time-limit spike is TEMPORARY. Before any [deploy] commit its function and test are deleted and
// KB384_SPIKE_KEY is removed from Netlify (all contexts). Production's build command runs this first (netlify.toml), so a release
// that still has any of it FAILS its build. Also on the release checklist (docs/23-ACCEPTANCE.md).
//     npm run check:spike
import { existsSync } from "node:fs";

const SPIKE_FILES = ["netlify/functions/voice-spike.mts", "netlify/functions/_shared/voiceSpike.test.ts"] as const;

export function spikeLeftovers(exists: (file: string) => boolean, env: Record<string, string | undefined>): string[] {
  return [
    ...SPIKE_FILES.filter(exists).map((f) => `${f} still exists`),
    ...(env.KB384_SPIKE_KEY ? ["KB384_SPIKE_KEY is still set in this build's environment"] : []),
  ];
}

if (process.argv[1] && /check-spike-absent/.test(process.argv[1])) {
  const problems = spikeLeftovers(existsSync, process.env);
  if (problems.length) {
    console.error("check:spike: the KB-384 spike is still here - NOT releasable:");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log("check:spike: no KB-384 spike left - releasable");
}
