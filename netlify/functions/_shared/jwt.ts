// KB-353 (D94): the access token is verified HERE, against the project's published signing key, instead of asking the
// database on every /voice call (that fresh connection from Ohio to Mumbai was 786 ms of a 2.4 s wait). Never weaker than the
// network check it replaces: ES256 only (so "none" and HS256 are refused), signature, exp and nbf (60 s leeway), issuer,
// audience and subject. A token that fails here is NEVER retried through the network. A signed-out session's token stays valid
// until its exp (at most 1 h) - exactly what PostgREST's own check allows today.

export const LEEWAY_S = 60;
const KEYS_TTL_MS = 600_000; // the project's own Cache-Control: max-age=600
const REFETCH_MIN_GAP_MS = 60_000; // an unknown kid may cause at most one refetch a minute

export interface Jwks {
  keys?: unknown;
}
export interface VerifyOptions {
  fetchJwks?: (url: string) => Promise<Jwks>;
  /** Seconds since the epoch. */
  nowS?: () => number;
}

interface KeyCache {
  keys: Map<string, CryptoKey>;
  loadedAt: number;
}
let cache: KeyCache | null = null;
let lastRefetchAt = -Infinity; // the last time an UNKNOWN kid made us look again

export function resetKeyCache(): void {
  cache = null;
  lastRefetchAt = -Infinity;
}

const defaultFetch = async (url: string): Promise<Jwks> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  return (await res.json()) as Jwks;
};

const b64 = (s: string): Uint8Array<ArrayBuffer> | null => (/^[A-Za-z0-9_-]*$/.test(s) ? Uint8Array.from(Buffer.from(s, "base64url")) : null);
const parseJson = (s: string): Record<string, unknown> | null => {
  const bytes = b64(s);
  if (!bytes) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Loads the key list; only ES256 / P-256 signing keys are ever trusted. */
async function loadKeys(base: string, fetchJwks: (u: string) => Promise<Jwks>, nowMs: number): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  const jwks = await fetchJwks(`${base}/auth/v1/.well-known/jwks.json`);
  if (!Array.isArray(jwks.keys)) return keys;
  for (const k of jwks.keys as Array<Record<string, unknown>>) {
    if (k?.kty !== "EC" || k.crv !== "P-256" || k.alg !== "ES256" || typeof k.kid !== "string") continue;
    try {
      keys.set(k.kid, await crypto.subtle.importKey("jwk", k as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
    } catch {
      // an unusable key is simply not trusted
    }
  }
  cache = { keys, loadedAt: nowMs };
  return keys;
}

async function keyFor(kid: string, base: string, fetchJwks: (u: string) => Promise<Jwks>, nowMs: number): Promise<CryptoKey | null> {
  if (!cache || nowMs - cache.loadedAt >= KEYS_TTL_MS) {
    const stale = cache;
    try {
      await loadKeys(base, fetchJwks, nowMs);
    } catch {
      cache = stale; // fail closed: an expired list is not used (loadedAt stays old), so the next call tries again
      return null;
    }
  } else if (!cache.keys.has(kid) && nowMs - lastRefetchAt >= REFETCH_MIN_GAP_MS) {
    // key rotation: a kid we have not seen -> look again, at most once a minute
    const known = cache;
    lastRefetchAt = nowMs;
    try {
      await loadKeys(base, fetchJwks, nowMs);
    } catch {
      cache = known;
    }
  }
  return cache?.keys.get(kid) ?? null;
}

/** The verified user id (the token's `sub`), or null. Never throws. */
export async function verifyAccessToken(authHeader: string | null, supabaseUrl: string, opts: VerifyOptions = {}): Promise<{ userId: string } | null> {
  try {
    if (!authHeader?.startsWith("Bearer ")) return null;
    const parts = authHeader.slice(7).trim().split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = parseJson(h);
    if (!header || header.alg !== "ES256" || typeof header.kid !== "string") return null;
    const sig = b64(s);
    if (!sig || sig.length !== 64) return null; // ES256 = r||s, 32 + 32 bytes

    const nowS = (opts.nowS ?? (() => Date.now() / 1000))();
    const base = supabaseUrl.replace(/\/+$/, "");
    const key = await keyFor(header.kid, base, opts.fetchJwks ?? defaultFetch, nowS * 1000);
    if (!key) return null;
    const signed = new TextEncoder().encode(`${h}.${p}`);
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, signed))) return null;

    const c = parseJson(p);
    if (!c) return null;
    if (typeof c.exp !== "number" || c.exp + LEEWAY_S < nowS) return null;
    if (c.nbf !== undefined && (typeof c.nbf !== "number" || c.nbf - LEEWAY_S > nowS)) return null;
    if (c.iss !== `${base}/auth/v1`) return null;
    const aud = c.aud;
    if (!(aud === "authenticated" || (Array.isArray(aud) && aud.includes("authenticated")))) return null;
    if (typeof c.sub !== "string" || c.sub.length === 0) return null;
    return { userId: c.sub };
  } catch {
    return null;
  }
}
