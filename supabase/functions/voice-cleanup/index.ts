// KB-384a step 5 (owner, 9 Nov 2026; D105, D107): the daily 7-day deletion of voice recordings - a Supabase Edge Function, so the
// service-role key never leaves Supabase (Supabase gives it to the function itself). Called once a day by pg_cron + pg_net
// (scripts/voice-cleanup-schedule.sql) with ONLY the shared secret VOICE_CLEANUP_SECRET in the x-cleanup-secret header.
// Deployed with --no-verify-jwt: the secret is the gate (config.toml [functions.voice-cleanup]). The logic is cleanup.ts (tested).
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { runCleanup, secretMatches, supabaseDeps } from "./cleanup.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST" || !secretMatches(req.headers.get("x-cleanup-secret"), Deno.env.get("VOICE_CLEANUP_SECRET"))) {
    return new Response("not found", { status: 404 });
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const result = await runCleanup(supabaseDeps(db as never));
    console.log(`[voice-cleanup] files=${result.files} rows=${result.rows} failedBatches=${result.failedBatches}`);
    return Response.json(result);
  } catch (err) {
    console.log(`[voice-cleanup] failed: ${(err as Error).message}`);
    return Response.json({ error: "cleanup failed" }, { status: 500 });
  }
});
