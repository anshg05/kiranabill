import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthedRequest {
  userId: string;
  shopId: string;
  client: SupabaseClient;
}

/**
 * Verifies the request carries a real, currently-valid Supabase session and
 * resolves the caller's shop_id - with a single RLS-protected query, not a
 * separate upfront /auth/v1/user round trip. An invalid/expired/missing
 * token can't pass shop_members' own RLS policy, so a failed or empty
 * result here already means "not really authenticated" - no second network
 * call needed on this hot path. RLS stays the real boundary (hard rule 4):
 * every query after this point uses the caller's own JWT, never a
 * service-role client.
 */
export async function resolveAuthedRequest(
  req: Request,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<AuthedRequest | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await client
    .from("shop_members")
    .select("shop_id, user_id")
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const row = data[0]!;
  return { userId: row.user_id as string, shopId: row.shop_id as string, client };
}
