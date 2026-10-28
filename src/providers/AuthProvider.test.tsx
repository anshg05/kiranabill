// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { SupabaseClient, Session, User } from "@supabase/supabase-js";
import { AuthRetryableFetchError, AuthApiError } from "@supabase/supabase-js";
import { AuthProvider, AUTH_WAIT_MS, useAuth } from "./AuthProvider";
import { DeviceDB, getActiveUserId, setActiveUserId } from "@/data/device";

function makeSession(overrides: Partial<User> = {}): Session {
  const user = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "shopkeeper@example.com",
    ...overrides,
  } as User;
  return {
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user,
  } as Session;
}

interface MockClient {
  client: SupabaseClient;
  emitAuthChange: (session: Session | null) => void;
  getSessionResult: { data: { session: Session | null } };
  signInWithOAuth: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function makeMockClient(initialSession: Session | null): MockClient {
  let authChangeCallback: ((event: string, session: Session | null) => void) | null = null;
  const unsubscribe = vi.fn();
  const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
  const signOut = vi.fn().mockResolvedValue({ error: null });

  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: initialSession } }),
      onAuthStateChange: vi.fn((callback: (event: string, session: Session | null) => void) => {
        authChangeCallback = callback;
        return { data: { subscription: { unsubscribe } } };
      }),
      signInWithOAuth,
      signOut,
    },
  } as unknown as SupabaseClient;

  return {
    client,
    emitAuthChange: (session) => {
      act(() => {
        // Faithful to auth-js: a session arrives as SIGNED_IN, its loss as
        // SIGNED_OUT (KB-315 - AuthProvider now distinguishes the two).
        authChangeCallback?.(session ? "SIGNED_IN" : "SIGNED_OUT", session);
      });
    },
    getSessionResult: { data: { session: initialSession } },
    signInWithOAuth,
    signOut,
    unsubscribe,
  };
}

describe("AuthProvider / useAuth", () => {
  it("starts loading, then resolves to signed-out when there is no session", async () => {
    const mock = makeMockClient(null);
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={mock.client}>{children}</AuthProvider>,
    });

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it("resolves to signed-in when getSession returns an existing session", async () => {
    const session = makeSession();
    const mock = makeMockClient(session);
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={mock.client}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.email).toBe("shopkeeper@example.com");
  });

  it("updates to signed-in when onAuthStateChange fires with a session", async () => {
    const mock = makeMockClient(null);
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={mock.client}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();

    mock.emitAuthChange(makeSession());

    await waitFor(() => expect(result.current.user?.email).toBe("shopkeeper@example.com"));
  });

  it("updates to signed-out when onAuthStateChange fires with null", async () => {
    const mock = makeMockClient(makeSession());
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={mock.client}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(result.current.user).not.toBeNull());

    mock.emitAuthChange(null);

    await waitFor(() => expect(result.current.user).toBeNull());
  });

  it("signInWithGoogle calls signInWithOAuth with the google provider, returning to THIS origin (KB-309: draft deploys)", async () => {
    const mock = makeMockClient(null);
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={mock.client}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signInWithGoogle();
    });

    // Without redirectTo, Supabase returns to the Site URL - the live site - from a draft deploy too.
    expect(mock.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: `${window.location.origin}/` } });
  });

  it("signInWithGoogle throws if the client reports an error", async () => {
    const mock = makeMockClient(null);
    mock.signInWithOAuth.mockResolvedValueOnce({ error: new Error("oauth boom") });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={mock.client}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.signInWithGoogle()).rejects.toThrow("oauth boom");
  });

  it("signOut calls the client's signOut", async () => {
    const mock = makeMockClient(makeSession());
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={mock.client}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.signOut();
    });

    expect(mock.signOut).toHaveBeenCalled();
  });

  it("unsubscribes the auth-state listener on unmount", async () => {
    const mock = makeMockClient(null);
    const { result, unmount } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={mock.client}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();

    expect(mock.unsubscribe).toHaveBeenCalled();
  });

  it("useAuth throws when used outside an AuthProvider", () => {
    const { result } = renderHook(() => {
      try {
        return useAuth();
      } catch (err) {
        return err;
      }
    });

    expect(result.current).toBeInstanceOf(Error);
  });
});


// KB-315 (docs/07-DECISIONS.md D38): the offline-session rule, through the
// real provider with a mocked client and a real (fake-indexeddb) device DB.
describe("AuthProvider - offline session (KB-315)", () => {
  function clientWithGetSession(result: unknown) {
    return {
      auth: {
        getSession: vi.fn().mockResolvedValue(result),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    } as unknown as SupabaseClient;
  }

  it("a network (retryable) refresh failure + a remembered user -> offline mode for that user", async () => {
    const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
    await setActiveUserId(deviceDb, "user-offline");
    const client = clientWithGetSession({ data: { session: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={client} deviceDb={deviceDb}>{children}</AuthProvider>,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe("offline");
    expect(result.current.userId).toBe("user-offline");
    expect(result.current.session).toBeNull(); // no live session - nothing may sync
  });

  it("a retryable failure with NO remembered user -> signed out", async () => {
    const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
    const client = clientWithGetSession({ data: { session: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={client} deviceDb={deviceDb}>{children}</AuthProvider>,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe("signedOut");
  });

  it("a NON-retryable failure (refresh token rejected) -> signed out, even with a remembered user", async () => {
    const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
    await setActiveUserId(deviceDb, "user-offline");
    const client = clientWithGetSession({ data: { session: null }, error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found") });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={client} deviceDb={deviceDb}>{children}</AuthProvider>,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe("signedOut");
  });

  it("a live session is remembered as the device's active user; an explicit signOut forgets it", async () => {
    const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
    const client = clientWithGetSession({ data: { session: makeSession() }, error: null });
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider client={client} deviceDb={deviceDb}>{children}</AuthProvider>,
    });
    await waitFor(() => expect(result.current.mode).toBe("online"));
    await waitFor(async () => expect(await getActiveUserId(deviceDb)).toBe("11111111-1111-1111-1111-111111111111"));
    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.mode).toBe("signedOut");
    expect(await getActiveUserId(deviceDb)).toBeNull();
  });
});

// KB-352 (owner, 28 Oct 2026): app cold start was 3.4 s median and 28 s at p95 (budget 2 s). getSession() refreshes an EXPIRED access token
// (they last an hour) over the network, with no deadline - a slow mobile network kept the app on "Loading…". A remembered user now gets the
// offline-session path after a short wait (billing works from local data) and is upgraded to online the moment the refresh arrives.
describe("AuthProvider - the cold start does not wait for the network (KB-352)", () => {
  afterEach(() => vi.useRealTimers());

  function slowClient() {
    let resolveSession: (v: unknown) => void = () => {};
    const getSession = vi.fn(() => new Promise((resolve) => void (resolveSession = resolve)));
    const client = {
      auth: {
        getSession,
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    } as unknown as SupabaseClient;
    return { client, resolveSession: (v: unknown) => resolveSession(v) };
  }
  const wrapperFor = (client: SupabaseClient, deviceDb: DeviceDB) => ({ children }: { children: React.ReactNode }) => <AuthProvider client={client} deviceDb={deviceDb}>{children}</AuthProvider>;

  it("a refresh that is slow + a remembered user: after the wait the app opens in offline mode for that user", async () => {
    const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
    await setActiveUserId(deviceDb, "user-remembered");
    const { client } = slowClient();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(client, deviceDb) });
    await act(async () => void (await vi.advanceTimersByTimeAsync(AUTH_WAIT_MS - 100)));
    expect(result.current.loading).toBe(true); // not before the wait is over
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    expect(result.current.loading).toBe(false);
    expect(result.current).toMatchObject({ mode: "offline", userId: "user-remembered", session: null });
  });

  it("...and the moment the refresh arrives with a session, it is online again (voice, sync) - real timers: the device DB write needs them", async () => {
    vi.useRealTimers();
    const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
    await setActiveUserId(deviceDb, "user-remembered");
    const { client, resolveSession } = slowClient();
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(client, deviceDb) });
    await waitFor(() => expect(result.current.mode).toBe("offline"), { timeout: AUTH_WAIT_MS + 1500 });
    const session = makeSession({ id: "user-remembered" });
    await act(async () => resolveSession({ data: { session } }));
    await waitFor(() => expect(result.current.mode).toBe("online"));
    expect(result.current.session?.access_token).toBe("fake-access-token");
  });

  it("...a refresh that finally FAILS for good (token rejected) signs out; a network failure stays offline", async () => {
    for (const [error, expected] of [[new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"), "signedOut"], [new AuthRetryableFetchError("Failed to fetch", 0), "offline"]] as const) {
      const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
      await setActiveUserId(deviceDb, "user-remembered");
      const { client, resolveSession } = slowClient();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const { result, unmount } = renderHook(() => useAuth(), { wrapper: wrapperFor(client, deviceDb) });
      await act(async () => void (await vi.advanceTimersByTimeAsync(AUTH_WAIT_MS + 100)));
      await act(async () => {
        resolveSession({ data: { session: null }, error });
        await vi.advanceTimersByTimeAsync(500); // fake-indexeddb needs a few ticks
      });
      expect(result.current.mode).toBe(expected);
      unmount();
      vi.useRealTimers();
    }
  });

  it("no remembered user (the very first sign-in): there is nothing local to open - it keeps waiting, never invents a user", async () => {
    const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
    const { client } = slowClient();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(client, deviceDb) });
    await act(async () => void (await vi.advanceTimersByTimeAsync(AUTH_WAIT_MS * 10)));
    expect(result.current.loading).toBe(true);
    expect(result.current.userId).toBeNull();
  });

  it("a fast answer is used as before - no offline detour", async () => {
    const deviceDb = new DeviceDB("dev-" + crypto.randomUUID());
    await setActiveUserId(deviceDb, "user-remembered");
    const mock = makeMockClient(makeSession({ id: "user-remembered" }));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapperFor(mock.client, deviceDb) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mode).toBe("online");
  });
});
