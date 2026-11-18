import type { Config, Context } from "@netlify/functions";
import { corsHeaders, PREFLIGHT_HEADERS } from "./_shared/cors.js";
import { verifyAccessToken } from "./_shared/jwt.js";
import { RECORDING_ID } from "./_shared/voiceRun.js";

// Option (b) step 3 (owner, 18 Nov 2026): the FRONT of the voice path. The bundled Android app calls this from https://localhost, so it
// needs CORS - which a background function cannot give (Netlify answers it with its own 202, our headers never reach the caller). This
// normal function answers CORS and the preflight, checks the login, and starts the worker (/voice-run-worker, the D107 background
// function, unchanged) on the SAME deploy - a draft starts its own draft's worker. The worker checks the login again.

export default async (req: Request, _context: Context): Promise<Response> => {
  const cors = corsHeaders(req);
  if (!cors) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  const answer = (status: number) => new Response(null, { status, headers: cors });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, ...PREFLIGHT_HEADERS } });
  if (req.method !== "POST") return answer(405);

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    console.warn("[voice-run] server misconfigured");
    return answer(500);
  }
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !(await verifyAccessToken(authHeader, supabaseUrl))) return answer(401);
  let recordingId: unknown;
  try {
    recordingId = ((await req.json()) as { recordingId?: unknown }).recordingId;
  } catch {
    return answer(400);
  }
  if (typeof recordingId !== "string" || !RECORDING_ID.test(recordingId)) return answer(400);

  try {
    const res = await fetch(new URL("/voice-run-worker", req.url), {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId }),
    });
    if (!res.ok) return answer(502);
  } catch {
    return answer(502);
  }
  return answer(202);
};

export const config: Config = { path: "/voice-run" };
