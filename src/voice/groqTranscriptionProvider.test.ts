import { describe, it, expect, vi, afterEach } from "vitest";
import { createGroqTranscriptionProvider } from "./groqTranscriptionProvider";

describe("groqTranscriptionProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("conforms to the TranscriptionProvider interface shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "do kilo chini" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGroqTranscriptionProvider("test-key");
    expect(provider.name).toBe("groq-whisper-large-v3");

    const result = await provider.transcribe(new Blob(["audio"]), {});
    expect(result.text).toBe("do kilo chini");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("uploads the file with a real extension matching the Blob's MIME type - KB-206 found Groq rejects a bare 'audio' filename with no extension", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGroqTranscriptionProvider("test-key");
    await provider.transcribe(new Blob(["audio"], { type: "audio/wav" }), {});

    const form = fetchMock.mock.calls[0]![1].body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.wav");
  });

  it("KB-302: ignores MediaRecorder's codec parameters - Safari's audio/mp4;codecs=... uploads as .mp4, not the webm fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "" }) });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createGroqTranscriptionProvider("test-key");

    const names: string[] = [];
    for (const type of ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "Audio/MP4; codecs=\"mp4a.40.2\""]) {
      await provider.transcribe(new Blob(["audio"], { type }), {});
      const form = fetchMock.mock.calls.at(-1)![1].body as FormData;
      names.push((form.get("file") as File).name);
    }
    expect(names).toEqual(["audio.mp4", "audio.webm", "audio.mp4"]);
  });

  it("falls back to a .webm extension when the Blob carries no recognized type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGroqTranscriptionProvider("test-key");
    await provider.transcribe(new Blob(["audio"]), {});

    const form = fetchMock.mock.calls[0]![1].body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.webm");
  });

  it("sends the auth header, model, language and audio file", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "chawal" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGroqTranscriptionProvider("real-key-123");
    await provider.transcribe(new Blob(["audio"]), { language: "hi" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    const [url, init] = call;
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer real-key-123");

    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3");
    expect(form.get("language")).toBe("hi");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("truncates the vocabulary prompt to exactly 600 characters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGroqTranscriptionProvider("test-key");
    // Each entry is "productN, " (9-10 chars); 100 entries comfortably
    // exceeds 600 characters once joined.
    const vocabulary = Array.from({ length: 100 }, (_, i) => `product${i}`);
    await provider.transcribe(new Blob(["audio"]), { vocabulary });

    const form = fetchMock.mock.calls[0]![1].body as FormData;
    const prompt = form.get("prompt") as string;
    expect(prompt.length).toBe(600);
    expect(prompt).toBe(vocabulary.join(", ").slice(0, 600));
  });

  it("omits the prompt field entirely when no vocabulary is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGroqTranscriptionProvider("test-key");
    await provider.transcribe(new Blob(["audio"]), {});

    const form = fetchMock.mock.calls[0]![1].body as FormData;
    expect(form.get("prompt")).toBeNull();
  });

  it("throws a real error on a non-2xx response, including status and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid API Key"}}',
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGroqTranscriptionProvider("bad-key");
    await expect(provider.transcribe(new Blob(["audio"]), {})).rejects.toThrow(
      /401.*Invalid API Key/,
    );
  });
});
