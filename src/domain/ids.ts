// KB-307 commit 3 (owner, 3 Oct 2026): deterministic ids for learning rows.
// The same bill, line and kind always give the same id - so a re-run of a
// bill's learning (recovery after a crash, two tabs - KI-39) writes the same
// rows again, never a second copy. Server local_id columns are uuid, so the
// result is UUID-shaped (version 5 / RFC 4122 variant bits set).
//
// Synchronous on purpose: it is computed inside a Dexie transaction, where an
// await on anything but Dexie (e.g. crypto.subtle) would end the transaction.
// cyrb128 - a well-mixed 128-bit non-cryptographic hash: ids only need to be
// stable and practically collision-free within one shop, not secret.

function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

const hex8 = (n: number) => n.toString(16).padStart(8, "0");

/** A UUID derived from its parts - identical parts, identical id. */
export function deterministicUuid(...parts: readonly (string | number)[]): string {
  // A separator that can't appear in the parts' text, so ("ab","c") != ("a","bc").
  const [a, b, c, d] = cyrb128(parts.map(String).join("\u0000"));
  const hex = hex8(a) + hex8(b) + hex8(c) + hex8(d);
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
