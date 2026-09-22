import { getStore } from "@netlify/blobs";

// docs/02-ARCHITECTURE.md section 6: "per-shop quota, prevents quota drain
// from a leaked URL" - this exists to stop abuse, never real billing
// (hard rule 5's spirit extended to infra). Netlify's own built-in
// rateLimit config can only aggregate by ip/domain on the free tier, not
// a custom identifier like shop_id - checked against real docs, not
// assumed - so this is an application-level fixed-window counter in
// Netlify Blobs instead, reusing the same storage mechanism already used
// for LEARNING_BLOB_STORE.
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
// Inferred, not doc-specified - flagged in the KB-206 handoff. Chosen to
// sit well above any realistic real-shop volume (100+ bills/day * 2.5
// utterances/bill is ~250/day, ~30/hour at a busy peak) so this can never
// block real billing, only an actual leaked-URL abuse pattern.
const MAX_REQUESTS_PER_WINDOW = 300;

export async function checkRateLimit(shopId: string): Promise<boolean> {
  const store = getStore("voice-rate-limit");
  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  const key = `${shopId}:${windowStart}`;

  const current = await store.get(key, { type: "json" });
  const count = typeof current === "number" ? current : 0;

  if (count >= MAX_REQUESTS_PER_WINDOW) return false;

  await store.setJSON(key, count + 1);
  return true;
}
