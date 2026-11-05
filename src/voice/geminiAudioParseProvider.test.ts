import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIO_PARSE_ADDENDUM, createGeminiAudioParseProvider } from "./geminiAudioParseProvider";
import { PRICING_GRAMMAR_PROMPT } from "./pricingGrammarPrompt";
import type { CatalogEntry } from "@/domain/catalog";

// KB-370 (V1): the audio straight to Gemini, transcript + items in ONE call - a bake-off candidate, NOT wired into /voice.

const chini: CatalogEntry = { id: "27", displayName: "Chini", sourceCategory: "sugar", guardCategory: "other", unit: "kg", suggestedPricePaise: 4500, aliases: ["chini"], isActive: true };
const answer = (json: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }], usageMetadata: { promptTokenCount: 9000, candidatesTokenCount: 120, totalTokenCount: 9120 } }),
});
const audio = () => new Blob([new Uint8Array([7, 8, 9])], { type: "audio/webm;codecs=opus" });

describe("geminiAudioParseProvider (KB-370 candidate C)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the shipped grammar prompt + the audio addendum, the catalog and the audio; the key only in a header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer({ transcript: "दो किलो चीनी", items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createGeminiAudioParseProvider("secret-key", { model: "gemini-3.8-flash" }).parseAudio(audio(), { catalog: [chini] });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    expect(url).not.toContain("secret-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    expect(body.systemInstruction.parts[0].text).toBe(`${PRICING_GRAMMAR_PROMPT}\n\n${AUDIO_PARSE_ADDENDUM}`);
    expect(body.contents[0].parts[0].text).toContain('"id":"27"');
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe("audio/webm");
    expect(body.generationConfig.responseSchema.required).toEqual(["transcript", "items"]);
  });

  it("returns the transcript and the items mapped like Layer 2's - an id not in the catalog becomes a custom line", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer({
      transcript: "दो किलो चीनी पैंतालीस रुपए किलो, एक साबुन",
      items: [
        { spokenName: "चीनी", catalogId: "27", qty: 2, unit: "kg", rate: 4500, total: null, priceType: "rate" },
        { spokenName: "साबुन", catalogId: "999", qty: 1, unit: "piece", rate: null, total: null, priceType: "default" },
      ],
    })));
    const r = await createGeminiAudioParseProvider("k").parseAudio(audio(), { catalog: [chini] });
    expect(r.transcript).toBe("दो किलो चीनी पैंतालीस रुपए किलो, एक साबुन");
    expect(r.items.map((i) => [i.catalogId, i.matchStatus, i.qty, i.rate])).toEqual([["27", "matched", 2, 4500], [null, "none", 1, null]]);
    expect(r.usage.promptTokens).toBe(9000);
  });

  it("KB-370 round 2: another system prompt and a thinking level replace the defaults; the thinking tokens are reported", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript: "x", items: [] }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 40, totalTokenCount: 160 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await createGeminiAudioParseProvider("k", { model: "gemini-3.8-flash", systemPrompt: "EZY PROMPT", thinkingConfig: { thinkingLevel: "low" } }).parseAudio(audio(), { catalog: [chini] });
    const body = JSON.parse((fetchMock.mock.calls[0]! as [string, RequestInit])[1].body as string);
    expect(body.systemInstruction.parts[0].text).toBe("EZY PROMPT");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(r.thoughts).toBe(40);
    expect(r.usage.completionTokens).toBe(60); // thinking billed as output
  });

  it("KB-370 round 2: thinking tokens ABSENT from the answer are null - never mistaken for a real 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer({ transcript: "x", items: [] }))); // usageMetadata without thoughtsTokenCount
    expect((await createGeminiAudioParseProvider("k").parseAudio(audio(), { catalog: [chini] })).thoughts).toBeNull();
  });

  it("refuses a '-latest' alias, and a 429 is busy", async () => {
    expect(() => createGeminiAudioParseProvider("k", { model: "gemini-flash-latest" })).toThrow(/pinned/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "{}" }));
    await expect(createGeminiAudioParseProvider("k").parseAudio(audio(), { catalog: [chini] })).rejects.toMatchObject({ kind: "busy" });
  });
});
