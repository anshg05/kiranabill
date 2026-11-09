import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../../../src/voice/deadline";
import { runVoiceJob, V3_AUDIO_MODEL, V3_GEMINI_TIMEOUT_MS, type VoiceJobDeps, type ClaimedRecording } from "./voiceRun";

// KB-384a step 3 (owner, 9 Nov 2026; D107): the background worker's job. One recording = one Gemini call: the claim decides; a
// rate limit, a failed download or a Gemini failure ends as a FAILED row the phone turns into Retry / Add by hand; it never throws
// (Netlify retries a throwing background function - that would be a second Gemini call).

const row: ClaimedRecording = { shopId: "shop-1", path: "shop-1/rec-1", mime: "audio/webm", attempts: 1 };
const answer = { transcript: "दो किलो चीनी", items: [{ spokenName: "चीनी" }], usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };

function deps(over: Partial<VoiceJobDeps> = {}): VoiceJobDeps & { [K in "claim" | "allowed" | "download" | "parse" | "finish"]: ReturnType<typeof vi.fn> } {
  return {
    claim: vi.fn(async () => row),
    allowed: vi.fn(async () => true),
    download: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])),
    parse: vi.fn(async () => answer),
    finish: vi.fn(async () => true),
    log: vi.fn(),
    ...over,
  } as never;
}

afterEach(() => vi.restoreAllMocks());

describe("runVoiceJob - one recording, one Gemini call, never a throw", () => {
  it("the V3 settings: gemini-3.8-flash, a 60 s Gemini limit - under the 70 s after which a stuck run may be claimed again", () => {
    expect(V3_AUDIO_MODEL).toBe("gemini-3.8-flash");
    expect(V3_GEMINI_TIMEOUT_MS).toBe(60_000);
    expect(V3_GEMINI_TIMEOUT_MS).toBeLessThan(70_000);
  });

  it("claimed: downloads the row's audio AS its own type, one Gemini call, finishes THAT attempt as done with the raw answer", async () => {
    const d = deps();
    expect(await runVoiceJob("rec-1", d)).toBe("done");
    expect(d.download).toHaveBeenCalledWith("shop-1/rec-1");
    expect(d.parse).toHaveBeenCalledOnce();
    expect((d.parse.mock.calls[0]![0] as Blob).type).toBe("audio/webm");
    expect(d.finish).toHaveBeenCalledWith({ recordingId: "rec-1", attempt: 1, status: "done", transcript: answer.transcript, items: answer.items, usage: answer.usage, error: null });
  });

  it("nothing claimed (done already, running, another shop's): no download, no Gemini call, no finish", async () => {
    const d = deps({ claim: vi.fn(async () => null) });
    expect(await runVoiceJob("rec-1", d)).toBe("skipped");
    expect(d.download).not.toHaveBeenCalled();
    expect(d.parse).not.toHaveBeenCalled();
    expect(d.finish).not.toHaveBeenCalled();
  });

  it("a double tap: two runs at once against ONE row make ONE Gemini call", async () => {
    let free = true;
    const d = deps({ claim: vi.fn(async () => (free ? ((free = false), row) : null)) });
    expect((await Promise.all([runVoiceJob("rec-1", d), runVoiceJob("rec-1", d)])).sort()).toEqual(["done", "skipped"]);
    expect(d.parse).toHaveBeenCalledOnce();
  });

  it("over the shop's rate limit: failed 'rate_limited', no download, no Gemini call", async () => {
    const d = deps({ allowed: vi.fn(async () => false) });
    expect(await runVoiceJob("rec-1", d)).toBe("failed");
    expect(d.allowed).toHaveBeenCalledWith("shop-1");
    expect(d.parse).not.toHaveBeenCalled();
    expect(d.finish).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "rate_limited", attempt: 1 }));
  });

  it("the audio cannot be read: failed 'download', no Gemini call", async () => {
    const d = deps({ download: vi.fn(async () => Promise.reject(new Error("object not found"))) });
    expect(await runVoiceJob("rec-1", d)).toBe("failed");
    expect(d.parse).not.toHaveBeenCalled();
    expect(d.finish).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "download" }));
  });

  it("Gemini fails: the error KIND only (timeout / busy / failed) - never its message, body or the transcript", async () => {
    for (const [err, kind] of [[new ProviderError("timeout", "Gemini timed out after 60000 ms"), "timeout"], [new ProviderError("busy", "429 quota"), "busy"], [new Error("boom secret-body"), "failed"]] as const) {
      const d = deps({ parse: vi.fn(async () => Promise.reject(err)) });
      expect(await runVoiceJob("rec-1", d)).toBe("failed");
      expect(d.finish).toHaveBeenCalledWith({ recordingId: "rec-1", attempt: 1, status: "failed", transcript: null, items: null, usage: null, error: kind });
    }
  });

  it("never throws: a claim, a finish or a rate-limit store that throws ends quietly with one log line", async () => {
    for (const over of [{ claim: vi.fn(async () => Promise.reject(new Error("db down"))) }, { finish: vi.fn(async () => Promise.reject(new Error("db down"))) }, { allowed: vi.fn(async () => Promise.reject(new Error("blobs down"))) }]) {
      const d = deps(over);
      await expect(runVoiceJob("rec-1", d)).resolves.toBeDefined();
      expect(d.log).toHaveBeenCalled();
    }
  });

  it("a finish that is refused (the run was claimed again meanwhile) is logged, not retried", async () => {
    const d = deps({ finish: vi.fn(async () => false) });
    expect(await runVoiceJob("rec-1", d)).toBe("skipped");
    expect(d.finish).toHaveBeenCalledOnce();
    expect(d.parse).toHaveBeenCalledOnce();
  });
});
