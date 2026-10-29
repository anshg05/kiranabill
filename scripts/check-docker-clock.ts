import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// KB-360 (owner, 29 Oct 2026): the e2e suite failed twice with "JWT issued at future": the local auth container's clock was ahead of the clock
// that checks the token. That is not a code bug and must not look like one - `npm run test:e2e` runs this first, and the suite does not start
// until the Supabase containers' clocks agree with this PC's.

export interface ContainerClock {
  readonly name: string;
  readonly epochS: number;
}

/** A container may differ by this many whole seconds (the time `docker exec` itself takes shows up as one). */
const TOLERANCE_S = 1;

/** `host` is the PC's epoch seconds taken just before and just after the containers were asked. Pure. */
export function judgeClocks(host: { before: number; after: number }, containers: readonly ContainerClock[]): { ok: boolean; message: string } {
  if (containers.length === 0) {
    return { ok: true, message: "no local Supabase containers found - nothing to compare (start them with `npx supabase start`)" };
  }
  const off = containers
    .map((c) => ({ c, skew: c.epochS > host.after + TOLERANCE_S ? c.epochS - host.after : c.epochS < host.before - TOLERANCE_S ? c.epochS - host.before : 0 }))
    .filter((x) => x.skew !== 0);
  if (off.length === 0) return { ok: true, message: `the ${containers.length} local Supabase containers' clocks agree with this PC's` };
  const lines = off.map(({ c, skew }) => `  ${c.name}: ${skew > 0 ? "+" : ""}${skew} s`).join("\n");
  return {
    ok: false,
    message:
      `The local Supabase containers' clock is off this PC's:\n${lines}\n` +
      `A token is then issued "in the future" and the e2e suite fails with "JWT issued at future" - not a code bug.\n` +
      `Resync the Docker clock: close Docker Desktop, run \`wsl --shutdown\`, start Docker Desktop again (if the PC's own clock is off, run \`w32tm /resync\` in an administrator terminal first), then \`npx supabase start\`. See docs/19-MACHINE-SETUP.md.`,
  };
}

function main(): void {
  let names: string[];
  try {
    names = execFileSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((n) => /^supabase_(auth|rest|db)_/.test(n));
  } catch {
    console.log("clock check skipped: docker is not reachable");
    return;
  }
  const before = Math.floor(Date.now() / 1000);
  const containers: ContainerClock[] = [];
  for (const name of names) {
    try {
      // some images (PostgREST's) have no `date`: they are skipped - the auth and database containers are the ones that matter
      containers.push({ name, epochS: Number(execFileSync("docker", ["exec", name, "date", "+%s"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) });
    } catch {
      /* no date command in this container */
    }
  }
  const after = Math.floor(Date.now() / 1000);
  const verdict = judgeClocks({ before, after }, containers);
  console.log(`clock check: ${verdict.message}`);
  if (!verdict.ok) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
