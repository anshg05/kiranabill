-- KB-384a step 5 (owner, 9 Nov 2026; D105, D107): what the daily 7-day deletion removes. Read by the voice-cleanup Edge Function
-- (service role, inside Supabase), which deletes the FILES through the Storage API and then the rows. Due:
--   - a recording whose bill was made 7+ days ago (billed_at, stamped by the server);
--   - a recording never billed, 7+ days after its upload (created_at) - abandoned orders, shops that stopped using the app;
--   - a file in the bucket with NO row, 7+ days old (e.g. left after a restore: voice_recordings is never backed up).
-- At most 1000 per run; the next day takes the rest. Only service_role may call it (it lists every shop's paths).
-- Additive (D55 section 5): a new function; the deployed app never calls it.

create or replace function voice_cleanup_due()
returns table (recording_id uuid, path text)
language sql
stable
security definer
set search_path = public
as $$
  (
    select v.recording_id, v.path
      from voice_recordings v
     where (v.billed_at is not null and v.billed_at < now() - interval '7 days')
        or (v.billed_at is null and v.created_at < now() - interval '7 days')
    union all
    select null::uuid, o.name
      from storage.objects o
     where o.bucket_id = 'recordings'
       and o.created_at < now() - interval '7 days'
       and not exists (select 1 from voice_recordings v where v.path = o.name)
  )
  limit 1000;
$$;

revoke all on function voice_cleanup_due() from public, anon, authenticated;
grant execute on function voice_cleanup_due() to service_role;
