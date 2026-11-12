// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

// KB-409 (D111): inside the Android app sign-in goes through nativeSignIn; a return link is listened for ONLY on the
// sign-in screen (signed out, auth settled) - so no app on the phone can make a signed-in app reload mid-bill.

const native = vi.hoisted(() => ({
  isNative: true,
  start: vi.fn((_client: unknown) => Promise.resolve("returned" as const)),
  stop: vi.fn(),
  watch: vi.fn(),
}));
vi.mock("@/data/nativeSignIn", () => ({
  isNativeApp: () => native.isNative,
  startNativeSignIn: native.start,
  watchNativeReturn: () => {
    native.watch();
    return native.stop;
  },
}));

import { AuthProvider, useAuth } from "./AuthProvider";
import { DeviceDB } from "@/data/device";

const session = { access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "bearer", user: { id: "11111111-1111-1111-1111-111111111111" } } as Session;

function setup(initial: Session | null) {
  let onChange: ((event: string, s: Session | null) => void) | null = null;
  const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: "x" }, error: null });
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: initial }, error: null }),
      onAuthStateChange: vi.fn((cb: (event: string, s: Session | null) => void) => {
        onChange = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithOAuth,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  } as unknown as SupabaseClient;
  const deviceDb = new DeviceDB(`native-auth-${Math.random()}`);
  const hook = renderHook(() => useAuth(), { wrapper: ({ children }) => <AuthProvider client={client} deviceDb={deviceDb}>{children}</AuthProvider> });
  return { hook, client, signInWithOAuth, emit: (event: string, s: Session | null) => act(() => onChange?.(event, s)) };
}

afterEach(() => {
  cleanup();
  native.isNative = true;
  native.start.mockClear();
  native.stop.mockClear();
  native.watch.mockClear();
});

describe("AuthProvider inside the Android app (KB-409)", () => {
  it("signInWithGoogle uses the native sign-in, never the page redirect, and says when it is over", async () => {
    const { hook, client, signInWithOAuth } = setup(null);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    let answer: unknown;
    await act(async () => {
      answer = await hook.result.current.signInWithGoogle();
    });
    expect(native.start).toHaveBeenCalledExactlyOnceWith(client);
    expect(signInWithOAuth).not.toHaveBeenCalled(); // the provider itself never starts a second flow
    expect(answer).toBe("returned");
  });

  it("listens for the return link on the sign-in screen - only once auth has settled", async () => {
    const { hook } = setup(null);
    expect(native.watch).not.toHaveBeenCalled(); // still loading: a remembered session may yet appear
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(native.watch).toHaveBeenCalledTimes(1);
  });

  it("does NOT listen while signed in, and stops listening when a sign-in completes", async () => {
    const signedIn = setup(session);
    await waitFor(() => expect(signedIn.hook.result.current.mode).toBe("online"));
    expect(native.watch).not.toHaveBeenCalled();
    cleanup();
    native.stop.mockClear();

    const signedOut = setup(null);
    await waitFor(() => expect(native.watch).toHaveBeenCalledTimes(1));
    signedOut.emit("SIGNED_IN", session);
    await waitFor(() => expect(native.stop).toHaveBeenCalledTimes(1));
  });

  it("listens again after a sign-out", async () => {
    const { hook } = setup(session);
    await waitFor(() => expect(hook.result.current.mode).toBe("online"));
    await act(async () => {
      await hook.result.current.signOut();
    });
    await waitFor(() => expect(native.watch).toHaveBeenCalledTimes(1));
  });
});

describe("AuthProvider in a browser or the PWA - unchanged (KB-409)", () => {
  it("never touches the native sign-in or the link listener; the page redirect is as before", async () => {
    native.isNative = false;
    const { hook, signInWithOAuth } = setup(null);
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    let answer: unknown = "unset";
    await act(async () => {
      answer = await hook.result.current.signInWithGoogle();
    });
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: `${window.location.origin}/` } });
    expect(native.start).not.toHaveBeenCalled();
    expect(native.watch).not.toHaveBeenCalled();
    expect(answer).toBeUndefined(); // the page is leaving for Google: the button must stay busy (KB-342)
  });
});
