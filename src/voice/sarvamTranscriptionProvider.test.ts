import { afterEach, describe, expect, it, vi } from "vitest";
import { createSarvamTranscriptionProvider, SARVAM_MODEL } from "./sarvamTranscriptionProvider";

// KB-370 round 2: Sarvam saaras:v4 as the "ear" - a bake-off candidate, NOT wired into /voice. Shapes from docs.sarvam.ai (read 5 Nov 2026):
// REST /speech-to-text (<= 30 s, multipart, header api-subscription-key, response { transcript }); the batch job API for longer audio.

const audio = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });
const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

describe("sarvamTranscriptionProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("<= 30 s: one REST call - the file, saaras:v4, verbatim, hi-IN, the key in its header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ request_id: "r", transcript: "दो किलो चीनी", language_code: "hi-IN" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await createSarvamTranscriptionProvider("secret").transcribe(audio(), { language: "hi", audioSeconds: 12, vocabulary: ["चीनी"] });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.sarvam.ai/speech-to-text");
    expect((init.headers as Record<string, string>)["api-subscription-key"]).toBe("secret");
    const form = init.body as FormData;
    expect([form.get("model"), form.get("mode"), form.get("language_code"), form.get("keyterms")]).toEqual([SARVAM_MODEL, "verbatim", "hi-IN", JSON.stringify(["चीनी"])]);
    expect((form.get("file") as File).name).toBe("audio.webm");
    expect(r.text).toBe("दो किलो चीनी");
    expect(r.waits).toBeUndefined();
  });

  it("key terms are sent without duplicates - Sarvam refuses a list with any (the canary's 400, 5 Nov 2026)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ transcript: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    await createSarvamTranscriptionProvider("k").transcribe(audio(), { audioSeconds: 5, vocabulary: ["Chini", "चीनी", "Chini", " चीनी "] });
    expect(((fetchMock.mock.calls[0]! as [string, RequestInit])[1].body as FormData).get("keyterms")).toBe(JSON.stringify(["Chini", "चीनी"]));
  });

  it("> 30 s: the batch job - init, upload URL, PUT to storage, start, poll, download - and every wait is timed", async () => {
    const calls: string[] = [];
    let polls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/speech-to-text/job/v1")) return json({ job_id: "J1", storage_container_type: "Azure", job_state: "Accepted" }, 202);
      if (url.endsWith("/upload-files")) return json({ job_id: "J1", upload_urls: { "audio.webm": { file_url: "https://blob.example/up?sas=1" } } });
      if (url.startsWith("https://blob.example/up")) return json({}, 201);
      if (url.endsWith("/J1/start")) return json({ job_id: "J1", job_state: "Running" });
      if (url.endsWith("/J1/status")) return json(++polls < 2 ? { job_state: "Running" } : { job_state: "Completed", job_details: [{ outputs: [{ file_name: "0.json" }], state: "Success" }] });
      if (url.endsWith("/download-files")) return json({ download_urls: { "0.json": { file_url: "https://blob.example/down?sas=2" } } });
      if (url.startsWith("https://blob.example/down")) return json({ transcript: "पांच किलो तुअर दाल", language_code: "hi-IN" });
      throw new Error(`unexpected ${url}`);
    }));
    const r = await createSarvamTranscriptionProvider("k", { pollMs: 1 }).transcribe(audio(), { language: "hi", audioSeconds: 76 });
    expect(r.text).toBe("पांच किलो तुअर दाल");
    expect(calls).toEqual([
      "POST https://api.sarvam.ai/speech-to-text/job/v1",
      "POST https://api.sarvam.ai/speech-to-text/job/v1/upload-files",
      "PUT https://blob.example/up?sas=1",
      "POST https://api.sarvam.ai/speech-to-text/job/v1/J1/start",
      "GET https://api.sarvam.ai/speech-to-text/job/v1/J1/status",
      "GET https://api.sarvam.ai/speech-to-text/job/v1/J1/status",
      "POST https://api.sarvam.ai/speech-to-text/job/v1/download-files",
      "GET https://blob.example/down?sas=2",
    ]);
    expect(r.waits).toMatchObject({ polls: 2 });
    expect(Object.keys(r.waits!)).toEqual(["uploadMs", "queueMs", "downloadMs", "polls"]);
  });

  it("Azure storage gets the PUT header its Put Blob API requires (x-ms-blob-type: BlockBlob)", async () => {
    const puts: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/job/v1")) return json({ job_id: "J", storage_container_type: "Azure" }, 202);
      if (url.endsWith("/upload-files")) return json({ upload_urls: { "audio.webm": { file_url: "https://b/u" } } });
      if (url === "https://b/u") return (puts.push(init!), json({}, 201));
      if (url.endsWith("/start")) return json({});
      if (url.endsWith("/status")) return json({ job_state: "Failed", error_message: "bad audio" });
      throw new Error(url);
    }));
    await expect(createSarvamTranscriptionProvider("k", { pollMs: 1 }).transcribe(audio(), { audioSeconds: 40 })).rejects.toMatchObject({ kind: "failed" });
    expect((puts[0]!.headers as Record<string, string>)["x-ms-blob-type"]).toBe("BlockBlob");
  });

  it("a 429 is busy, a 403 (a wrong key) is setup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 429)));
    await expect(createSarvamTranscriptionProvider("k").transcribe(audio(), { audioSeconds: 5 })).rejects.toMatchObject({ kind: "busy" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 403)));
    await expect(createSarvamTranscriptionProvider("k").transcribe(audio(), { audioSeconds: 5 })).rejects.toMatchObject({ kind: "setup" });
  });
});
