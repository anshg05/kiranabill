// KB-364: the REAL /voice (netlify/functions/voice.mts) served locally with a throwaway signed-in user on the local Supabase stack -
// shared by `npm run smoke:voice` and `npm run accept:live`. Needs the local Docker stack and GEMINI_API_KEY / GROQ_API_KEY /
// VITE_SUPABASE_* in .env.local (read here, never printed).
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createShop } from "../src/data/shops.js";

export interface LocalVoice {
  readonly endpoint: string;
  readonly accessToken: string;
  stop: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startLocalVoice(port = 9977): Promise<LocalVoice> {
  process.loadEnvFile(".env.local");
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: host "${host}" is not local.`);
  for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY"]) if (!process.env[name]) throw new Error(`${name} not set (.env.local)`);

  const endpoint = `http://localhost:${port}/voice`; // the function defines its own path, as in production
  const server = spawn("npx", ["netlify", "functions:serve", "--port", String(port)], { shell: true, stdio: "ignore", env: { ...process.env, NETLIFY_SITE_ID: "" } });
  const stop = () => void spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const up = await fetch(endpoint).then((r) => r.status === 405, () => false);
      if (up) break;
      if (Date.now() > deadline) throw new Error("netlify functions:serve did not come up in 90 s");
      await sleep(1000);
    }
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.signUp({ email: `local-${crypto.randomUUID()}@smoke.local`, password: crypto.randomUUID() });
    if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
    await createShop(client, { ownerUserId: data.user.id, name: "Local Kirana", phone: null, catalogMode: "custom_only" });
    return { endpoint, accessToken: data.session.access_token, stop };
  } catch (e) {
    stop();
    throw e;
  }
}
