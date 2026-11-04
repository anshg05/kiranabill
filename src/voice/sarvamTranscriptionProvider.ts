import { ProviderError } from "@/voice/deadline";

// KB-370 round 2: Sarvam saaras:v4 as the "ear" - a bake-off candidate, NOT wired into /voice (eval/bakeoff/notWired.test.ts).
// docs.sarvam.ai, read 5 Nov 2026: REST POST /speech-to-text takes at most 30 s of audio (multipart; header api-subscription-key;
// response { transcript }); longer audio goes through the batch job API - init, upload-files (a presigned storage URL), PUT the bytes,
// start, poll status, download-files, GET the result JSON. The storage PUT / GET are the storage's own API (Sarvam documents only the URL):
// for Azure, Put Blob needs x-ms-blob-type: BlockBlob. Price: Rs 0.49 a minute, billed per second, before GST.

export const SARVAM_MODEL = "saaras:v4";
export const SARVAM_REST_MAX_SECONDS = 30;
const BASE = "https://api.sarvam.ai/speech-to-text";
const KEYTERMS_MAX = 50; // saaras:v4 only, up to 50 terms

export interface SarvamWaits {
  /** init + upload URL + PUT */
  readonly uploadMs: number;
  /** start -> Completed (the queue and the processing) */
  readonly queueMs: number;
  /** download URL + GET */
  readonly downloadMs: number;
  readonly polls: number;
}

export interface SarvamTranscriptionProvider {
  readonly name: string;
  transcribe(audio: Blob, opts: { language?: string; vocabulary?: string[]; audioSeconds: number }): Promise<{ text: string; latencyMs: number; waits?: SarvamWaits }>;
}

async function failed(what: string, r: Response): Promise<ProviderError> {
  const body = await r.text();
  const kind = r.status === 429 ? "busy" : r.status === 401 || r.status === 403 ? "setup" : "failed";
  return new ProviderError(kind, `Sarvam ${what} failed: ${r.status} ${body.slice(0, 300)}`, r.status);
}

export function createSarvamTranscriptionProvider(apiKey: string, options: { pollMs?: number; maxWaitMs?: number } = {}): SarvamTranscriptionProvider {
  const pollMs = options.pollMs ?? 3_000; // the Pay-as-you-go batch limit is 20 requests a minute
  const maxWaitMs = options.maxWaitMs ?? 600_000;
  const auth = { "api-subscription-key": apiKey };
  const call = async (what: string, url: string, init: RequestInit = {}) => {
    const r = await fetch(url, init);
    if (!r.ok) throw await failed(what, r);
    return r;
  };
  const post = (what: string, path: string, body: unknown) => call(what, `${BASE}${path}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  return {
    name: SARVAM_MODEL,
    async transcribe(audio, opts) {
      const language = opts.language === "hi" ? "hi-IN" : (opts.language ?? "unknown");
      const keyterms = (opts.vocabulary ?? []).slice(0, KEYTERMS_MAX);
      const mime = (audio.type.split(";")[0] ?? "").trim() || "audio/webm";
      const file = `audio.${mime.split("/")[1] ?? "webm"}`;
      const start = performance.now();

      if (opts.audioSeconds <= SARVAM_REST_MAX_SECONDS) {
        const form = new FormData();
        form.set("file", audio, file);
        form.set("model", SARVAM_MODEL);
        form.set("mode", "verbatim"); // keep what was said, corrections included
        form.set("language_code", language);
        if (keyterms.length) form.set("keyterms", JSON.stringify(keyterms));
        const r = (await (await call("transcription", BASE, { method: "POST", headers: auth, body: form })).json()) as { transcript?: string };
        return { text: (r.transcript ?? "").trim(), latencyMs: performance.now() - start };
      }

      // the batch job: every step timed, so the report can say whether Sarvam could ever answer at the counter
      const init = (await post("job init", "/job/v1", { job_parameters: { model: SARVAM_MODEL, mode: "verbatim", language_code: language, ...(keyterms.length ? { keyterms } : {}) } })) as { job_id: string; storage_container_type?: string };
      const up = (await post("upload URL", "/job/v1/upload-files", { job_id: init.job_id, files: [file] })) as { upload_urls: Record<string, { file_url: string }> };
      const azure = (init.storage_container_type ?? "").toLowerCase().startsWith("azure");
      await call("upload", up.upload_urls[file]!.file_url, { method: "PUT", headers: { "Content-Type": mime, ...(azure ? { "x-ms-blob-type": "BlockBlob" } : {}) }, body: audio });
      const uploaded = performance.now();
      await post("job start", `/job/v1/${init.job_id}/start`, {});
      let polls = 0;
      let status: { job_state: string; error_message?: string; job_details?: { outputs?: { file_name: string }[] }[] };
      for (;;) {
        await new Promise((r) => setTimeout(r, pollMs));
        polls++;
        status = (await (await call("job status", `${BASE}/job/v1/${init.job_id}/status`, { headers: auth })).json()) as typeof status;
        if (status.job_state === "Completed") break;
        if (status.job_state === "Failed") throw new ProviderError("failed", `Sarvam job failed: ${status.error_message ?? "no reason given"}`);
        if (performance.now() - uploaded > maxWaitMs) throw new ProviderError("timeout", `Sarvam job not done after ${maxWaitMs} ms`);
      }
      const done = performance.now();
      const output = status.job_details?.[0]?.outputs?.[0]?.file_name ?? "0.json";
      const down = (await post("download URL", "/job/v1/download-files", { job_id: init.job_id, files: [output] })) as { download_urls: Record<string, { file_url: string }> };
      const result = (await (await call("download", down.download_urls[output]!.file_url)).json()) as { transcript?: string };
      const end = performance.now();
      return { text: (result.transcript ?? "").trim(), latencyMs: end - start, waits: { uploadMs: uploaded - start, queueMs: done - uploaded, downloadMs: end - done, polls } };
    },
  };
}
