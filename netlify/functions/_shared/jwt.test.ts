import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEEWAY_S, resetKeyCache, verifyAccessToken } from "./jwt";

// KB-353 (owner, 28 Oct 2026): /voice's sign-in check was 786 ms of a 2.4 s wait (a fresh connection from Ohio to the
// Mumbai database on every call). The access token is now verified HERE, against the project's published ES256 key,
// with no network call per request. The check is never weaker than before: signature, algorithm, expiry, issuer,
// audience and subject are all enforced, and anything unexpected is a "no".

const URL_ = "https://abc.supabase.co";
const ISS = `${URL_}/auth/v1`;
const NOW = 1_800_000_000; // seconds
const enc = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

async function newKey(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "ES256", use: "sig", key_ops: ["verify"] };
  return { priv: pair.privateKey, jwk, kid };
}

async function sign(key: { priv: CryptoKey; kid: string }, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const head = enc({ alg: "ES256", typ: "JWT", kid: key.kid, ...header });
  const body = enc(claims);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.priv, Buffer.from(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}

const good = (over: Record<string, unknown> = {}) => ({ sub: "user-1", aud: "authenticated", role: "authenticated", iss: ISS, exp: NOW + 3600, iat: NOW - 10, ...over });

let key: Awaited<ReturnType<typeof newKey>>;
let fetchJwks: ReturnType<typeof vi.fn>;
const verify = (token: string, over: { now?: number } = {}) =>
  verifyAccessToken(`Bearer ${token}`, URL_, { fetchJwks: fetchJwks as never, nowS: () => over.now ?? NOW });

beforeEach(async () => {
  resetKeyCache();
  key = await newKey("k1");
  fetchJwks = vi.fn(async () => ({ keys: [key.jwk] }));
});

describe("verifyAccessToken", () => {
  it("a genuine token: the user id (sub) comes back", async () => {
    expect(await verify(await sign(key, good()))).toEqual({ userId: "user-1" });
  });

  it("no header / not Bearer / not three parts -> null, and the key list is never fetched", async () => {
    expect(await verifyAccessToken(null, URL_, { fetchJwks: fetchJwks as never, nowS: () => NOW })).toBeNull();
    expect(await verifyAccessToken("Basic abc", URL_, { fetchJwks: fetchJwks as never, nowS: () => NOW })).toBeNull();
    expect(await verify("a.b")).toBeNull();
    expect(await verify("not-a-token")).toBeNull();
    expect(fetchJwks).not.toHaveBeenCalled();
  });

  it("FORGED: a token signed by some other key (same kid) is rejected", async () => {
    const other = await newKey("k1");
    expect(await verify(await sign(other, good()))).toBeNull();
  });

  it("FORGED: a payload edited after signing is rejected", async () => {
    const t = (await sign(key, good())).split(".");
    t[1] = enc(good({ sub: "someone-else" }));
    expect(await verify(t.join("."))).toBeNull();
  });

  it("EXPIRED: past exp + 60 s leeway -> null; inside the leeway -> accepted", async () => {
    expect(LEEWAY_S).toBe(60);
    expect(await verify(await sign(key, good({ exp: NOW - 61 })))).toBeNull();
    expect(await verify(await sign(key, good({ exp: NOW - 59 })))).toEqual({ userId: "user-1" });
  });

  it("a token with no exp at all is rejected (never valid for ever)", async () => {
    const { exp: _exp, ...noExp } = good();
    expect(await verify(await sign(key, noExp))).toBeNull();
  });

  it("not-yet-valid (nbf) beyond 60 s leeway -> null; inside it -> accepted", async () => {
    expect(await verify(await sign(key, good({ nbf: NOW + 61 })))).toBeNull();
    expect(await verify(await sign(key, good({ nbf: NOW + 59 })))).toEqual({ userId: "user-1" });
  });

  it("WRONG AUDIENCE -> null (an anon or other-service token)", async () => {
    expect(await verify(await sign(key, good({ aud: "anon" })))).toBeNull();
    expect(await verify(await sign(key, good({ aud: ["other"] })))).toBeNull();
    expect(await verify(await sign(key, good({ aud: undefined })))).toBeNull();
  });

  it("WRONG ISSUER -> null (a token from another project)", async () => {
    expect(await verify(await sign(key, good({ iss: "https://evil.supabase.co/auth/v1" })))).toBeNull();
    expect(await verify(await sign(key, good({ iss: undefined })))).toBeNull();
  });

  it("no subject, or a non-string subject -> null", async () => {
    expect(await verify(await sign(key, good({ sub: undefined })))).toBeNull();
    expect(await verify(await sign(key, good({ sub: "" })))).toBeNull();
    expect(await verify(await sign(key, good({ sub: 5 })))).toBeNull();
  });

  it('alg "none" (unsigned) -> null', async () => {
    const t = `${enc({ alg: "none", typ: "JWT", kid: "k1" })}.${enc(good())}.`;
    expect(await verify(t)).toBeNull();
  });

  it("alg HS256 signed with the public key as the secret (algorithm confusion) -> null", async () => {
    const head = enc({ alg: "HS256", typ: "JWT", kid: "k1" });
    const body = enc(good());
    const hmac = await crypto.subtle.importKey("raw", Buffer.from(JSON.stringify(key.jwk)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Buffer.from(await crypto.subtle.sign("HMAC", hmac, Buffer.from(`${head}.${body}`))).toString("base64url");
    expect(await verify(`${head}.${body}.${sig}`)).toBeNull();
  });

  it("a VALIDLY signed token whose header names another algorithm is refused (only ES256 is ever accepted)", async () => {
    for (const alg of ["ES384", "RS256", "HS256", "none"]) expect(await verify(await sign(key, good(), { alg }))).toBeNull();
  });

  it("a signature of the wrong length / not base64 -> null, never a throw", async () => {
    const t = (await sign(key, good())).split(".");
    expect(await verify(`${t[0]}.${t[1]}.AAAA`)).toBeNull();
    expect(await verify(`${t[0]}.${t[1]}.@@@`)).toBeNull();
    expect(await verify(`@@@.${t[1]}.${t[2]}`)).toBeNull();
  });

  it("keys are fetched once and cached for many requests", async () => {
    for (let i = 0; i < 5; i++) await verify(await sign(key, good()));
    expect(fetchJwks).toHaveBeenCalledTimes(1);
  });

  it("the key list is re-fetched after its 10 minutes are up", async () => {
    let t = NOW;
    const v = async () => verifyAccessToken(`Bearer ${await sign(key, good({ exp: t + 3600 }))}`, URL_, { fetchJwks: fetchJwks as never, nowS: () => t });
    await v();
    t += 599;
    await v();
    expect(fetchJwks).toHaveBeenCalledTimes(1);
    t += 2;
    await v();
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("KEY ROTATION: an unknown kid triggers ONE refetch and the new key is then accepted", async () => {
    await verify(await sign(key, good())); // k1 cached
    const k2 = await newKey("k2");
    fetchJwks.mockResolvedValue({ keys: [key.jwk, k2.jwk] });
    expect(await verify(await sign(k2, good()))).toEqual({ userId: "user-1" });
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("a forged unknown kid cannot make the server fetch on every request (at most one refetch a minute)", async () => {
    await verify(await sign(key, good()));
    const stranger = await newKey("zzz");
    for (let i = 0; i < 10; i++) expect(await verify(await sign(stranger, good()))).toBeNull();
    expect(fetchJwks).toHaveBeenCalledTimes(2); // the first load + ONE refetch
  });

  it("FAILS CLOSED: the key list cannot be fetched, is empty, or is garbage -> null", async () => {
    fetchJwks.mockRejectedValue(new Error("down"));
    expect(await verify(await sign(key, good()))).toBeNull();
    resetKeyCache();
    fetchJwks.mockResolvedValue({ keys: [] });
    expect(await verify(await sign(key, good()))).toBeNull();
    resetKeyCache();
    fetchJwks.mockResolvedValue({ nope: 1 });
    expect(await verify(await sign(key, good()))).toBeNull();
  });

  it("a key list that is not ES256 / P-256 is ignored, never trusted", async () => {
    fetchJwks.mockResolvedValue({ keys: [{ ...key.jwk, alg: "RS256" }, { kty: "oct", kid: "k1", k: "AAAA" }] });
    expect(await verify(await sign(key, good()))).toBeNull();
  });

  it("a trailing slash on the project URL still matches the issuer", async () => {
    const token = `Bearer ${await sign(key, good())}`;
    expect(await verifyAccessToken(token, `${URL_}/`, { fetchJwks: fetchJwks as never, nowS: () => NOW })).toEqual({ userId: "user-1" });
  });
});
