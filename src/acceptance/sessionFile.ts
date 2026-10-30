// KB-364: the file the phone recorder exports and the PC imports. One JSON file, audio as base64 (about 4 MB for 50 clips) - no upload,
// no storage bucket, no new dependency.

export interface SessionClip {
  readonly id: string;
  readonly category: string;
  readonly mime: string;
  readonly durationMs: number;
  readonly audioBase64: string;
}

export interface SessionFile {
  readonly version: 1;
  readonly createdAt: string;
  readonly userAgent: string;
  readonly clips: readonly SessionClip[];
}

export function buildSessionFile(clips: readonly SessionClip[], userAgent: string, now: Date): SessionFile {
  return { version: 1, createdAt: now.toISOString(), userAgent, clips: [...clips].sort((a, b) => a.id.localeCompare(b.id)) };
}

const ID = /^A\d{2}$/;

/** Reads a session file; anything that is not exactly the format is refused with the reason (never half-imported). */
export function parseSessionFile(text: string): SessionFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("not a JSON file");
  }
  const file = raw as Partial<SessionFile> | null;
  if (!file || file.version !== 1 || !Array.isArray(file.clips)) throw new Error("not an acceptance session file (version 1)");
  const seen = new Set<string>();
  for (const c of file.clips as Partial<SessionClip>[]) {
    if (typeof c.id !== "string" || !ID.test(c.id)) throw new Error(`a clip has a bad id: ${String(c.id)}`);
    if (seen.has(c.id)) throw new Error(`clip ${c.id} appears twice`);
    seen.add(c.id);
    if (typeof c.mime !== "string" || !/^audio\//.test(c.mime)) throw new Error(`clip ${c.id}: bad audio type`);
    if (typeof c.audioBase64 !== "string" || c.audioBase64.length === 0) throw new Error(`clip ${c.id}: no audio`);
    if (typeof c.category !== "string" || typeof c.durationMs !== "number") throw new Error(`clip ${c.id}: missing fields`);
  }
  return file as SessionFile;
}

/** The file extension for a recorded type ("audio/webm;codecs=opus" -> webm, "audio/mp4" -> m4a). */
export function extensionFor(mime: string): string {
  if (/webm/.test(mime)) return "webm";
  if (/mp4|aac|m4a/.test(mime)) return "m4a";
  if (/ogg/.test(mime)) return "ogg";
  if (/wav/.test(mime)) return "wav";
  return "bin";
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
