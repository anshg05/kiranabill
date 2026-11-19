import Dexie from "dexie";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KiranaBillDB } from "./db";
import { shopDbName } from "./db";
import { setActiveUserId, type DeviceDB } from "./device";
import { stopSyncLoop } from "./sync";
import { fetchFailed } from "./voiceJob";

// KB-430 (D119, owner 20 Nov 2026): "Delete my account" - the phone's side. The SERVER deletes everything in one transaction
// (delete_my_account(): the shops, every row, the login - or nothing). The phone first removes the shop's logo files (members may;
// recording files are the daily clean-up's), then asks the server, and only after the server's "deleted" does it delete this user's
// database, forget the active user and sign out LOCALLY (the login no longer exists, so a server sign-out would fail).

export type DeleteOutcome =
  | { kind: "deleted"; counts: Record<string, number> | null }
  | { kind: "offline" }
  | { kind: "shared_shop" }
  | { kind: "failed"; reason: "logos" | "server" };

export interface DeleteDeps {
  client: SupabaseClient;
  userId: string;
  shopIds: readonly string[];
  localDb: KiranaBillDB | null;
  deviceDb: DeviceDB;
  isOnline?: () => boolean;
}

export async function deleteMyAccount(d: DeleteDeps): Promise<DeleteOutcome> {
  const online = d.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  if (!online()) return { kind: "offline" };

  for (const shopId of d.shopIds) {
    const logos = d.client.storage.from("shop-logos");
    const listed = await logos.list(shopId);
    if (listed.error) return { kind: "failed", reason: "logos" };
    const paths = (listed.data ?? []).map((f) => `${shopId}/${f.name}`);
    if (paths.length && (await logos.remove(paths)).error) return { kind: "failed", reason: "logos" };
  }

  const { data, error } = await d.client.rpc("delete_my_account");
  if (error) {
    if ((error as { hint?: string }).hint === "shared_shop") return { kind: "shared_shop" };
    // The answer was lost: the server either did all of it or none of it - the login tells which.
    if (!(fetchFailed(error) && (await loginGone(d.client)))) return { kind: "failed", reason: "server" };
  }

  stopSyncLoop();
  d.localDb?.close();
  await Dexie.delete(shopDbName(d.userId));
  await setActiveUserId(d.deviceDb, null);
  await d.client.auth.signOut({ scope: "local" });
  return { kind: "deleted", counts: error ? null : (data as Record<string, number>) };
}

async function loginGone(client: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await client.auth.getUser();
    return !data.user && error !== null && !fetchFailed(error);
  } catch {
    return false;
  }
}
