// KB-360 follow-up (owner, 29 Oct 2026): the LIVE smoke test for Layer 2. The eval harness alone let draft-v9 ship with every Layer-2 call failing
// (Google answered 402 and no test ever called the real function). This runs the SHIPPED path end to end: the app's own parseTranscript ->
// the real netlify/functions/voice.mts (auth, shop lookup, rate limit, GEMINI_MODEL, the provider) -> the real Gemini, with a throwaway user
// on the local Supabase stack. Run it before every draft and release that touches Layer 2:
//     npm run smoke:voice
// It spends 11 Gemini calls (declared below; they share production's quota if the key is the same - count them against D99 item 11's daily rule) and starts/stops
// `netlify functions:serve` itself. Needs the local Docker stack (npx supabase start) and GEMINI_API_KEY / GEMINI_MODEL / GROQ_API_KEY in .env.local.
// It proves the key in .env.local - NOT the key in Netlify; the owner's first signed-in call on the deployed draft proves that one.
import { parseTranscript, VoiceApiError } from "../src/data/voiceApi.js";
import type { CatalogEntry } from "../src/domain/catalog.js";
import type { ParsedItem } from "../src/domain/grammar.js";
import { startLocalVoice } from "./localVoice.js";

const entry = (id: string, displayName: string, unit: string, rupees: number): CatalogEntry => ({
  id, displayName, sourceCategory: "dal", guardCategory: "dal", unit, suggestedPricePaise: rupees * 100, aliases: [], isActive: true,
});
const slice = [entry("1", "मूंग दाल", "kg", 120), entry("2", "बरबटी दाल", "kg", 100), entry("3", "उड़द मोगर", "kg", 130), entry("4", "चीनी", "kg", 48), entry("335", "Ruchi Gold Oil", "liter", 130), entry("200", "Lizol", "piece", 80), entry("609", "फुटाना", "kg", 90)];

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
  { label: "'एक सो दस' is 110 (the owner's phone test, 29 Oct)", say: "एक किलो मुंग मोगर एक सो दस रुपए किलो", check: (i) => (i.length === 1 && i[0]!.qty === 1 && i[0]!.rate === 11000 ? null : `read as ${JSON.stringify(i.map((x) => [x.qty, x.rate]))}`) },
  { label: "KB-366 (A40): a DIFFERENT brand is not the catalog product and takes no catalog price", say: "एक लीटर टोटल गोल्ड तेल",
    check: (i) => (i.some((x) => x.catalogId === "335") ? "matched Ruchi Gold Oil" : i.some((x) => (x.total ?? 0) > 0) ? `a price was invented: ${i.map((x) => x.total).join(",")}` : i.length < 1 ? "no line" : null) },
  { label: "KB-366 (A47/A49): a price only - no quantity is invented", say: "लाइजॉल 110 रुपए",
    check: (i) => (i.length === 1 && i[0]!.qty === null && i[0]!.total === 11000 ? null : `read as ${JSON.stringify(i.map((x) => [x.qty, x.unit, x.total]))}`) },
  { label: "KB-366 (owner ruling): a per-kilo price with no quantity is 1 kg", say: "फुटाने 110 रुपए किलो",
    check: (i) => (i.length === 1 && i[0]!.qty === 1 && i[0]!.unit === "kg" && i[0]!.total === 11000 ? null : `read as ${JSON.stringify(i.map((x) => [x.qty, x.unit, x.rate, x.total]))}`) },
  { label: "KB-366 (A42): '30 60 वाला' for an unknown product - the 30 is not a quantity (it billed Rs 1,800)", say: "दन्त कान 30 60 वाला",
    check: (i) => (i.length === 1 && i[0]!.catalogId === null && i[0]!.qty === null ? null : `read as ${JSON.stringify(i.map((x) => [x.catalogId, x.qty, x.unit, x.rate, x.total]))}`) },
  { label: "a total, not a rate", say: "5 किलो चीनी 225 रुपए", check: (i) => (i.length === 1 && i[0]!.qty === 5 && i[0]!.total === 22500 ? null : `read as ${JSON.stringify(i.map((x) => [x.qty, x.rate, x.total]))}`) },
];

let failed = 0;
const voice = await startLocalVoice();
try {
  console.log(`smoke:voice - ${cases.length} live Gemini calls, model ${process.env.GEMINI_MODEL ?? "(default)"}`);
  for (const c of cases) {
    const t = Date.now();
    try {
      const items = await parseTranscript(c.say, { accessToken: voice.accessToken, endpoint: voice.endpoint, catalogSlice: slice });
      const problem = c.check(items);
      console.log(`${problem ? "FAIL" : "ok  "} ${Date.now() - t} ms  ${c.label}: ${items.map((x) => `${x.spokenName} ${x.qty}${x.unit} rate=${x.rate} total=${x.total} ${x.priceType}`).join(" | ")}${problem ? `  <- ${problem}` : ""}`);
      if (problem) failed++;
    } catch (e) {
      failed++;
      console.log(`FAIL ${Date.now() - t} ms  ${c.label}: ${e instanceof VoiceApiError ? `${e.kind} ${e.status ?? ""} reason=${e.reason ?? "-"}` : String(e)}`);
    }
  }
} finally {
  voice.stop();
}
console.log(failed === 0 ? "smoke:voice PASSED" : `smoke:voice FAILED (${failed})`);
process.exit(failed === 0 ? 0 : 1);
