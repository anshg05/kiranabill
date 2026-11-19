-- D116 (owner, 19 Nov 2026; option (b) step 5): the minimum app version, and the app's version on each recording.
--
-- app_min_version: ONE row per platform (only 'android'). The bundled Android app reads it at start and when it comes back to the
-- front - BEFORE sign-in, so anon may read it. Below min_version_code the app shows "Please update" (a hard block; the sync loop keeps
-- uploading). update_url is where its Update button goes (none yet; the Play listing later). NOBODY writes it from the app: the owner
-- changes it in the Supabase dashboard (which runs as postgres and bypasses these rules). Raise the minimum only to a RELEASED version.
--
-- voice_recordings.app_version_code: the phone writes its versionCode when it adds the row - a record only, the server refuses nothing.
--
-- Additive (D55 section 5): a new table and a nullable column; the deployed apps never read the table and never send the column.

create table app_min_version (
  platform text primary key check (platform = 'android'),
  min_version_code integer not null check (min_version_code >= 1),
  update_url text check (update_url is null or (update_url like 'https://%' and length(update_url) <= 500)),
  updated_at timestamptz not null default now()
);

insert into app_min_version (platform, min_version_code) values ('android', 1);

alter table app_min_version enable row level security;

create policy app_min_version_read on app_min_version for select
  to anon, authenticated
  using (true);

-- Read only, for everyone. (Supabase grants everything by default; no insert/update/delete grant or policy exists.)
revoke all on app_min_version from anon, authenticated;
grant select on app_min_version to anon, authenticated;

-- updated_at is the server's clock on every dashboard edit
create or replace function app_min_version_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_min_version_touch before update on app_min_version
  for each row execute function app_min_version_touch();

-- The app's versionCode on the recording row: added at insert only (the column grant), never changed by the phone.
alter table voice_recordings add column app_version_code integer check (app_version_code is null or app_version_code >= 1);
grant insert (app_version_code) on voice_recordings to authenticated;
