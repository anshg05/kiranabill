-- KB-384a step 2 (owner, 9 Nov 2026; D107): the async voice path's storage. One recording = one row, keyed by the recording_id
-- the PHONE makes once (a retry or a double tap reuses it). The audio is in the PRIVATE `recordings` bucket at
-- {shop_id}/{recording_id}. The worker (a Netlify background function) acts AS THE USER - their login token, these policies -
-- so there is no service-role key in Netlify.
--
-- Clients only ADD a row (recording_id, shop_id, mime) and stamp billed_at. The status moves only through two functions:
--   claim_voice_recording:  queued | failed | running for more than 70 s  ->  running (attempt + 1)  - one Gemini call per claim
--   finish_voice_recording: running (that attempt)  ->  done (transcript + items) | failed (error)
-- so nobody can push a done row back to queued and buy a second Gemini call. Nobody deletes from the app: the 7-day clean-up
-- (D105; billed 7 days after billed_at, unbilled 7 days after upload) runs inside Supabase with the Storage API.
--
-- Additive (D55 section 5): a new table, bucket and functions; the deployed app never touches them.

create table voice_recordings (
  recording_id uuid primary key,
  shop_id uuid not null references shops (id),
  path text generated always as (shop_id::text || '/' || recording_id::text) stored,
  mime text not null check (mime like 'audio/%' and length(mime) <= 64),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  error text check (error is null or length(error) <= 200),
  model text check (model is null or length(model) <= 64),
  transcript text,
  items jsonb check (items is null or jsonb_typeof(items) = 'array'),
  usage jsonb,
  -- server clocks only: the 7-day clean-up reads these
  created_at timestamptz not null default now(),
  billed_at timestamptz,
  check (status <> 'done' or (transcript is not null and items is not null))
);

create index on voice_recordings (created_at);
create index on voice_recordings (billed_at);
create index on voice_recordings (shop_id);

alter table voice_recordings enable row level security;

create policy voice_recordings_select on voice_recordings for select
  using (is_shop_member(shop_id));
create policy voice_recordings_insert on voice_recordings for insert
  with check (is_shop_member(shop_id));
create policy voice_recordings_update on voice_recordings for update
  using (is_shop_member(shop_id)) with check (is_shop_member(shop_id));

-- Column privileges: add only the three columns, update only billed_at, never delete. (Supabase grants everything by default.)
revoke all on voice_recordings from anon, authenticated;
grant select on voice_recordings to authenticated;
grant insert (recording_id, shop_id, mime) on voice_recordings to authenticated;
grant update (billed_at) on voice_recordings to authenticated;

-- billed_at is the server's clock, set once: a client's date (say 2099) can never keep a recording past its 7 days.
create or replace function voice_recordings_stamp_billed_at()
returns trigger
language plpgsql
as $$
begin
  if old.billed_at is not null and new.billed_at is distinct from old.billed_at then
    raise exception 'billed_at is set once';
  end if;
  if old.billed_at is null and new.billed_at is not null then
    new.billed_at := now();
  end if;
  return new;
end;
$$;

create trigger voice_recordings_billed_at
  before update on voice_recordings
  for each row execute function voice_recordings_stamp_billed_at();

-- The claim: ONE statement, so two workers (a double tap, Netlify's own retry) can never both win.
create or replace function claim_voice_recording(p_recording_id uuid)
returns setof voice_recordings
language sql
security definer
set search_path = public
as $$
  update voice_recordings
     set status = 'running', attempts = attempts + 1, started_at = now(), finished_at = null, error = null
   where recording_id = p_recording_id
     and is_shop_member(shop_id)
     and (status in ('queued', 'failed') or (status = 'running' and started_at < now() - interval '70 seconds'))
  returning *;
$$;

-- The result: only the attempt that is running, only once. Returns false when nothing was finished.
create or replace function finish_voice_recording(
  p_recording_id uuid, p_attempt int, p_status text, p_transcript text, p_items jsonb, p_usage jsonb, p_model text, p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_status not in ('done', 'failed') then
    raise exception 'finish status must be done or failed' using errcode = '22023';
  end if;
  update voice_recordings
     set status = p_status, finished_at = now(), transcript = p_transcript, items = p_items, usage = p_usage, model = p_model,
         error = left(p_error, 200)
   where recording_id = p_recording_id
     and is_shop_member(shop_id)
     and status = 'running'
     and attempts = p_attempt;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

revoke all on function claim_voice_recording(uuid) from public, anon;
revoke all on function finish_voice_recording(uuid, int, text, text, jsonb, jsonb, text, text) from public, anon;
grant execute on function claim_voice_recording(uuid) to authenticated;
grant execute on function finish_voice_recording(uuid, int, text, text, jsonb, jsonb, text, text) to authenticated;

-- The PRIVATE bucket: audio only, 10 MB at most (5 min at the phone's ~126 kbps is ~4.7 MB; KB-385 records at 24 kbps).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 10485760,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do nothing;

-- Read and add only {shop_id}/{recording_id} of the member's own shop. No update policy (no overwrite, no upsert),
-- no delete policy (the clean-up deletes inside Supabase).
create policy recordings_select on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recordings'
    and public.is_shop_member((storage.foldername(name))[1]::uuid)
  );

create policy recordings_insert on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recordings'
    and array_length(storage.foldername(name), 1) = 1
    and public.is_shop_member((storage.foldername(name))[1]::uuid)
    and storage.filename(name)::uuid is not null
  );
