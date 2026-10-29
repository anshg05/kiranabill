// KB-360 follow-up (owner, 29 Oct 2026): the LIVE smoke test for Layer 2. The eval harness alone let draft-v9 ship with every Layer-2 call failing
// (Google answered 402 and no test ever called the real function). This runs the SHIPPED path end to end: the app's own parseTranscript ->
// the real netlify/functions/voice.mts (auth, shop lookup, rate limit, GEMINI_MODEL, the provider) -> the real Gemini, with a throwaway user
// on the local Supabase stack. Run it before every draft and release that touches Layer 2:
//     npm run smoke:voice
// It spends 6 Gemini calls (declared below; they share production's quota if the key is the same - keep it <= 10) and starts/stops
// `netlify functions:serve` itself. Needs the local Docker stack (npx supabase start) and GEMINI_API_KEY / GEMINI_MODEL / GROQ_API_KEY in .env.local.
// It proves the key in .env.local - NOT the key in Netlify; the owner's first signed-in call on the deployed draft proves that one.
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createShop } from "../src/data/shops.js";
import { parseTranscript, VoiceApiError } from "../src/data/voiceApi.js";
import type { CatalogEntry } from "../src/domain/catalog.js";
import type { ParsedItem } from "../src/domain/grammar.js";

process.loadEnvFile(".env.local");
const url = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set (.env.local)");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Refusing to run: host "${host}" is not local.`);
for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY"]) if (!process.env[name]) throw new Error(`${name} not set (.env.local)`);

const PORT = 9977;
const ENDPOINT = `http://localhost:${PORT}/voice`; // the function defines its own path, as in production
const entry = (id: string, displayName: string, unit: string, rupees: number): CatalogEntry => ({
  id, displayName, sourceCategory: "dal", guardCategory: "dal", unit, suggestedPricePaise: rupees * 100, aliases: [], isActive: true,
});
const slice = [entry("1", "मूंग दाल", "kg", 120), entry("2", "बरबटी दाल", "kg", 100), entry("3", "उड़द मोगर", "kg", 130), entry("4", "चीनी", "kg", 48)];

interface Case { label: string; say: string; check: (items: ParsedItem[]) => string | null }
const cases: Case[] = [
  { label: "the owner's 4:37 PM order (price per kilo with no rupees word)", say: "1 किलो मूंग दाल 96 किलो 1 किलो बर्बटी दाल 88 किलो 1 किलो उडद मोगर 130 किलो 1 किलो मूंग मोगर 110 किलो",
    check: (i) => (i.some((x) => x.qty === 96 || x.qty === 88 || x.qty === 130 || x.qty === 110) ? "a price became a quantity" : i.length < 3 ? `only ${i.length} lines` : null) },
  { label: "a price with no quantity", say: "मुंग मोगर 110 रुपई किलो", check: (i) => (i.length < 1 ? "no line" : null) },
  { label: "the price-less sentence", say: "बरबटी दाल एक किलो मुंग दाल दो किलो हरा बटाना एक किलो",
    check: (i) => (i.map((x) => x.qty).join(",") === "1,2,1" ? null : `quantities were ${i.map((x) => x.qty).join(",")}`) },
  { label: "an unreadable price is never invented", say: "एक किलो मुँगडाल चैन रुपए किलो",
    check: (i) => (i.length < 1 ? "no line" : i.some((x) => x.priceType !== "unknown" && (x.rate ?? 0) > 0 && x.matchStatus !== "matched") ? "invented a price" : null) },
  { label: "a plain priced line", say: "2 किलो चीनी 45 रुपए किलो", check: (i) => (i.length === 1 && i[0]!.qty === 2 && i[0]!.rate === 4500 ? null : `read as ${JSON.stringify(i.map((x) => [x.qty, x.rate]))}`) },
  { label: "a total, not a rate", say: "5 किलो चीनी 225 रुपए", check: (i) => (i.length === 1 && i[0]!.qty === 5 && i[0]!.total === 22500 ? null : `read as ${JSON.stringify(i.map((x) => [x.qty, x.rate, x.total]))}`) },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const server = spawn("npx", ["netlify", "functions:serve", "--port", String(PORT)], { shell: true, stdio: "ignore", env: { ...process.env, NETLIFY_SITE_ID: "" } });
const stop = () => void spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
let failed = 0;
try {
  const deadline = Date.now() + 90_000;
  for (;;) {
    const up = await fetch(ENDPOINT).then((r) => r.status === 405, () => false);
    if (up) break;
    if (Date.now() > deadline) throw new Error("netlify functions:serve did not come up in 90 s");
    await sleep(1000);
  }
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({ email: `smoke-${crypto.randomUUID()}@smoke.local`, password: crypto.randomUUID() });
  if (error || !data.user || !data.session) throw new Error(`local signUp failed: ${error?.message ?? "no session"}`);
  await createShop(client, { ownerUserId: data.user.id, name: "Smoke Kirana", phone: null, catalogMode: "custom_only" });

  console.log(`smoke:voice - ${cases.length} live Gemini calls, model ${process.env.GEMINI_MODEL ?? "(default)"}`);
  for (const c of cases) {
    const t = Date.now();
    try {
      const items = await parseTranscript(c.say, { accessToken: data.session.access_token, endpoint: ENDPOINT, catalogSlice: slice });
      const problem = c.check(items);
      console.log(`${problem ? "FAIL" : "ok  "} ${Date.now() - t} ms  ${c.label}: ${items.map((x) => `${x.spokenName} ${x.qty}${x.unit} rate=${x.rate} total=${x.total} ${x.priceType}`).join(" | ")}${problem ? `  <- ${problem}` : ""}`);
      if (problem) failed++;
    } catch (e) {
      failed++;
      console.log(`FAIL ${Date.now() - t} ms  ${c.label}: ${e instanceof VoiceApiError ? `${e.kind} ${e.status ?? ""} reason=${e.reason ?? "-"}` : String(e)}`);
    }
  }
} finally {
  stop();
}
console.log(failed === 0 ? "smoke:voice PASSED" : `smoke:voice FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
