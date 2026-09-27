import { isAuthRetryableFetchError, type AuthError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { setActiveUserId, type DeviceDB } from "@/data/device";
import { stopSyncLoop } from "@/data/sync";

// KB-315 (docs/07-DECISIONS.md D38): who is using the app, when the network
// may be down.
//
// Real behaviour of @supabase/auth-js 2.116 (GoTrueClient __loadSession): an
// EXPIRED access token is refreshed; if that refresh fails with a network
// (retryable) error, getSession() returns session:null + the error - but the
// stored session is kept, and auth-js refreshes it once the network is back.
// Access tokens last ~1 hour, so without this rule a shopkeeper opening the
// app offline an hour after the last refresh would be sent to sign-in, which
// can't work offline (proven against the real library in bootstrap.e2e.test.ts).
//
// Rule: session present -> "online". session null with a RETRYABLE error and
// a remembered activeUserId -> "offline" (billing runs from that user's local
// database). Anything else (no remembered user, or a non-retryable error such
// as a rejected refresh token while online) -> "signedOut".
//
// Offline mode can run INDEFINITELY on the last sign-in. Nothing reaches the
// server until a real session exists: syncNow() skips every cycle without one
// (sync.ts), so an offline-created bill can never be pushed as anon and
// mis-marked a permanent 42501 conflict.

export type AuthMode =
  | { kind: "online"; userId: string; session: Session }
  | { kind: "offline"; userId: string }
  | { kind: "signedOut" };

export function resolveAuthMode(
  result: { data: { session: Session | null }; error?: AuthError | null },
  activeUserId: string | null,
): AuthMode {
  const session = result.data.session;
  if (session) return { kind: "online", userId: session.user.id, session };
  if (activeUserId && result.error && isAuthRetryableFetchError(result.error)) {
    return { kind: "offline", userId: activeUserId };
  }
  return { kind: "signedOut" };
}

/**
 * Explicit sign-out: stop the sync loop, forget the active user (so an
 * offline restart can't resume as them), then end the Supabase session.
 * Local data is NOT deleted (D38) - the same user signing back in continues,
 * unsynced bills included. The UI must warn with the count of unsynced bills
 * before calling this (KB-312 / KB-313 - 16-APP-FLOW.md "Sign-out").
 */
export async function signOutDevice(client: SupabaseClient, deviceDb: DeviceDB): Promise<void> {
  stopSyncLoop();
  await setActiveUserId(deviceDb, null);
  const { error } = await client.auth.signOut();
  if (error) throw error;
}
