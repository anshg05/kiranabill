import { createClient } from "@supabase/supabase-js";

// KB-353 (D94): the token itself is verified in jwt.ts. What is left is the one question the token cannot answer - which shop does
// this verified user belong to? - asked with the CALLER's own JWT, so RLS stays the real boundary (hard rule 4; never a
// service-role client). A confirmed answer is remembered per user for 5 minutes (in this function container's memory); a "no" is
// never remembered. A signed-in user who belongs to no shop is capped per USER, not per shop.

export const SHOP_CACHE_MS = 300_000;
export const UNCONFIRMED_PER_MINUTE = 3;
const SHOP_CACHE_MAX = 1000;

const shops = new Map<string, { shopId: string; until: number }>();
const strikes = new Map<string, { windowStart: number; count: number }>();

export function resetAuthState(): void {
  shops.clear();
  strikes.clear();
}

export function cachedShop(userId: string): string | null {
  const e = shops.get(userId);
  if (!e) return null;
  if (Date.now() >= e.until) {
    shops.delete(userId);
    return null;
  }
  return e.shopId;
}

/** The caller's shop (RLS-protected query with their own JWT), or null. Never throws. */
export async function lookupShop(authHeader: string, supabaseUrl: string, supabaseAnonKey: string, userId: string): Promise<string | null> {
  try {
    const client = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data, error } = await client.from("shop_members").select("shop_id, user_id").limit(1);
    if (error || !data || data.length === 0) return null;
    const row = data[0]!;
    if (row.user_id !== userId) return null;
    const shopId = row.shop_id as string;
    if (shops.size >= SHOP_CACHE_MAX) shops.delete(shops.keys().next().value as string); // oldest first
    shops.set(userId, { shopId, until: Date.now() + SHOP_CACHE_MS });
    return shopId;
  } catch {
    return null;
  }
}

/** May this user's audio go to Groq BEFORE their membership is confirmed? Not once they have been found to be no member. */
export function mayRunUnconfirmed(userId: string): boolean {
  const e = strikes.get(userId);
  return !e || Date.now() - e.windowStart >= 60_000 || e.count < UNCONFIRMED_PER_MINUTE;
}

export function noteUnconfirmed(userId: string): void {
  const now = Date.now();
  if (strikes.size >= SHOP_CACHE_MAX) for (const [k, v] of strikes) if (now - v.windowStart >= 60_000) strikes.delete(k);
  const e = strikes.get(userId);
  if (!e || now - e.windowStart >= 60_000) strikes.set(userId, { windowStart: now, count: 1 });
  else e.count++;
}
