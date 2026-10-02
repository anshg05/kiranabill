import { describe, it, expect, vi, afterEach } from "vitest";
import { createGroqTranscriptionProvider, GROQ_TIMEOUT_MS } from "./groqTranscriptionProvider";
import { ProviderError } from "./deadline";

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

  it("KB-317: an explicit model (the eval's large-v3 vs turbo comparison) is sent; the default stays whisper-large-v3", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "" }) });
    vi.stubGlobal("fetch", fetchMock);

    await createGroqTranscriptionProvider("k", "whisper-large-v3-turbo").transcribe(new Blob(["a"]), {});
    await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {});
    const models = fetchMock.mock.calls.map((c) => (c[1].body as FormData).get("model"));
    expect(models).toEqual(["whisper-large-v3-turbo", "whisper-large-v3"]);
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

  // -------------------------------------------------------------------------
  // KB-317 commit 5 (owner): silence hallucination. Silent taps came back as
  // "झाल" / "कर दो" and became junk lines. Measured on all 47 saved recordings
  // (30 Sep 2026): every speech segment has no_speech_prob <= 0.3022, every
  // silent tap >= 0.6382 - avg_logprob does NOT separate them. A segment with
  // no_speech_prob >= 0.5 is dropped.
  // -------------------------------------------------------------------------
  describe("KB-317: segments Whisper itself rates as no speech are dropped", () => {
    const seg = (text: string, no_speech_prob: number, avg_logprob = -0.2) => ({ text, no_speech_prob, avg_logprob, start: 0, end: 1 });
    const reply = (text: string, segments?: unknown[]) =>
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text, ...(segments ? { segments } : {}) }) });

    it("asks Groq for verbose_json with per-segment stats", async () => {
      const fetchMock = reply("do kilo chini", [seg("do kilo chini", 0.01)]);
      vi.stubGlobal("fetch", fetchMock);
      await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), { language: "hi" });
      const form = fetchMock.mock.calls[0]![1].body as FormData;
      expect(form.get("response_format")).toBe("verbose_json");
      expect(form.getAll("timestamp_granularities[]")).toEqual(["segment"]);
    });

    it.each([
      ["a silent tap - 'झाल' at 0.7607 (owner's 04-18-23 recording)", "झाल", [seg(" झाल", 0.7607, -0.164)]],
      ["a silent tap - 'कर दो' at 0.854", "कर दो", [seg(" कर दो", 0.854, -0.273)]],
      ["the boundary - exactly 0.5", "झाल", [seg(" झाल", 0.5)]],
    ])("%s -> empty transcript", async (_label, text, segments) => {
      vi.stubGlobal("fetch", reply(text, segments));
      expect((await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {})).text).toBe("");
    });

    it("real speech is untouched - the highest real no_speech_prob measured (RT24, 0.3022) keeps its exact text", async () => {
      const text = "एक किलो देशी चना, एक किलो बरवटी दाल, एक किलो फुटाना";
      vi.stubGlobal("fetch", reply(text, [seg(" एक किलो देशी चना, एक किलो बरवटी दाल, एक किलो फुटाना", 0.3022, -0.077)]));
      expect((await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {})).text).toBe(text);
    });

    it("just under the boundary (0.4999) is kept", async () => {
      vi.stubGlobal("fetch", reply("दो किलो चीनी", [seg(" दो किलो चीनी", 0.4999)]));
      expect((await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {})).text).toBe("दो किलो चीनी");
    });

    // Owner: the rule is on the WHOLE recording, never per segment - dropping
    // one segment could silently remove a real item in a noisy shop, and the
    // transcript would hide it. A junk tail in a mixed recording is left to
    // the no-information line guard (a loud false alarm beats a silent omission).
    it("speech + a silent tail: ALL the text is kept (only an all-silent recording is dropped)", async () => {
      vi.stubGlobal("fetch", reply("2 किलो चीनी झाल", [seg(" 2 किलो चीनी", 0.02), seg(" झाल", 0.89)]));
      expect((await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {})).text).toBe("2 किलो चीनी झाल");
    });

    it("a noisy shop: 'do kilo chini [noise] ek kilo besan' with the 2nd segment at 0.55 - besan is NOT lost", async () => {
      vi.stubGlobal("fetch", reply("दो किलो चीनी एक किलो बेसन", [seg(" दो किलो चीनी", 0.1), seg(" एक किलो बेसन", 0.55)]));
      expect((await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {})).text).toBe("दो किलो चीनी एक किलो बेसन");
    });

    it("every segment silent -> the recording is silence: empty transcript", async () => {
      vi.stubGlobal("fetch", reply("झाल कर दो", [seg(" झाल", 0.76), seg(" कर दो", 0.85)]));
      expect((await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {})).text).toBe("");
    });

    it("a response with no segments (unexpected) falls back to the plain text - never loses real speech", async () => {
      vi.stubGlobal("fetch", reply("दो किलो चीनी"));
      expect((await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {})).text).toBe("दो किलो चीनी");
    });
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

  describe("KB-319 (KI-58): fail fast", () => {
    afterEach(() => vi.useRealTimers());

    it("a Groq 429 is 'busy' - one call, never retried", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limit reached" });
      vi.stubGlobal("fetch", fetchMock);
      const err = await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toMatchObject({ kind: "busy", message: expect.stringMatching(/429.*rate limit reached/) });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("another non-2xx is 'failed'", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }));
      expect(await createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {}).catch((e: unknown) => e)).toMatchObject({ kind: "failed" });
    });

    it("unanswered at 8 s -> 'timeout', and the request is aborted (the 18.7 s outlier is cut)", async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => ((signal = init.signal ?? undefined), new Promise(() => {}))));
      const result = createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {}).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(GROQ_TIMEOUT_MS - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toMatchObject({ kind: "timeout" });
      expect(signal?.aborted).toBe(true);
      expect(GROQ_TIMEOUT_MS).toBe(8_000);
    });

    it("a normal answer inside the deadline is untouched", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => setTimeout(() => r({ ok: true, json: async () => ({ text: "do kilo chini" }) }), 2_600))));
      const result = createGroqTranscriptionProvider("k").transcribe(new Blob(["a"]), {});
      await vi.advanceTimersByTimeAsync(2_600);
      expect((await result).text).toBe("do kilo chini");
    });
  });
});
