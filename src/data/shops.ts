import type { SupabaseClient } from "@supabase/supabase-js";

export type CatalogMode = "base_imported" | "custom_only";

export interface Shop {
  id: string;
  ownerUserId: string;
  name: string;
  phone: string | null;
  catalogMode: CatalogMode;
}

interface ShopRow {
  id: string;
  owner_user_id: string;
  name: string;
  phone: string | null;
  catalog_mode: CatalogMode;
}

function fromRow(row: ShopRow): Shop {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    phone: row.phone,
    catalogMode: row.catalog_mode,
  };
}

/**
 * Finds a shop the given user owns, whether or not their shop_members row
 * exists yet - relies on shops_select's owner_user_id clause (D20) to see
 * an orphaned shop from a previously-interrupted bootstrap.
 */
export async function findOwnShop(client: SupabaseClient, userId: string): Promise<Shop | null> {
  const { data, error } = await client
    .from("shops")
    .select("id, owner_user_id, name, phone, catalog_mode")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ? fromRow(data as ShopRow) : null;
}

/** True once the given user has an owner-role shop_members row for this shop. */
export async function hasOwnerMembership(
  client: SupabaseClient,
  shopId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("shop_members")
    .select("shop_id")
    .eq("shop_id", shopId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export interface CreateShopParams {
  ownerUserId: string;
  name: string;
  phone: string | null;
  catalogMode: CatalogMode;
}

/**
 * Creates a shop and its owner membership row, in that order, awaited
 * sequentially - never in parallel. KB-104's own smoke test proved this
 * ordering is load-bearing: the membership insert's bootstrap check
 * (owns_shop()) requires the shops row to already exist, so reversing or
 * parallelising these two awaits makes the bootstrap fail outright, not
 * just race.
 *
 * Resumable: if a shop already exists for this user (from a previous
 * attempt that failed between the two inserts), reuses that shop's id
 * instead of creating a second, orphaned shop, and only performs the
 * membership insert it's missing.
 */
export async function createShop(client: SupabaseClient, params: CreateShopParams): Promise<Shop> {
  const existing = await findOwnShop(client, params.ownerUserId);

  const shop =
    existing ??
    (await (async () => {
      const { data, error } = await client
        .from("shops")
        .insert({
          owner_user_id: params.ownerUserId,
          name: params.name,
          phone: params.phone,
          catalog_mode: params.catalogMode,
        })
        .select("id, owner_user_id, name, phone, catalog_mode")
        .single();

      if (error) throw error;
      return fromRow(data as ShopRow);
    })());

  const alreadyMember = await hasOwnerMembership(client, shop.id, params.ownerUserId);
  if (!alreadyMember) {
    const { error } = await client
      .from("shop_members")
      .insert({ shop_id: shop.id, user_id: params.ownerUserId, role: "owner" });
    if (error) throw error;
  }

  return shop;
}

/** Backs the "Ready catalog" S2 choice (16-APP-FLOW.md section 2). */
export async function copyBaseCatalog(client: SupabaseClient, shopId: string, deviceId: string): Promise<void> {
  const { error } = await client.rpc("copy_base_catalog", { p_shop_id: shopId, p_device_id: deviceId });
  if (error) throw error;
}
