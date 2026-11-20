-- SG-20 (D121, owner 20 Nov 2026): sign-ups by allowlist, 250 voice calls a shop a day, and the owner's reports.
--
-- app_limits: ONE row the owner edits in the dashboard (no deploy). shop_calls_per_day = Gemini calls a shop may make in one India-time
-- day (0 = voice off for every shop). signup_mode = 'allowlist' (only signup_allowlist's emails may make a shop) or 'open'.
-- RULE (docs/23, docs/17 M-51): before signup_mode is ever set to 'open', the Google AI Studio monthly spend cap must be set.
-- gemini_price: ONE row - the model's price and the rupee rate, so the reports show rupees. Each call's cost is computed and frozen
-- when it finishes (a price change on 1 Jan 2027 never re-prices the past).
-- signup_allowlist: the owner's list of Google emails (any letter case).
-- voice_usage: per shop per India-time day - calls (claims that reached Gemini), done, failed, refused by the limit, tokens, cost.
--
-- The count lives INSIDE claim_voice_recording (row-locked, shared by both Netlify sites): over the limit the claim marks the
-- recording failed 'day_limit' (attempts + 1, so the phone notices) and returns nothing - the worker then makes no Gemini call. Same
-- signatures as before, so the deployed workers (the website and the app's functions site) and app-v2 need no change.
--
-- Nothing here is readable by an app role. The reports (schema reports) are for the dashboard only. Additive (D55 section 5), except
-- that in allowlist mode a new user not on the list can no longer make a shop (the owner's decision).

create table app_limits (
  id smallint primary key default 1 check (id = 1),
  shop_calls_per_day integer not null default 250 check (shop_calls_per_day >= 0),
  signup_mode text not null default 'allowlist' check (signup_mode in ('allowlist', 'open')),
  updated_at timestamptz not null default now()
);
comment on column app_limits.shop_calls_per_day is 'Gemini voice calls one shop may make in one India-time day (0 = voice off for every shop)';
comment on column app_limits.signup_mode is 'allowlist or open. Before setting open: set the Google AI Studio monthly spend cap (docs/17 M-51).';
insert into app_limits (id) values (1);

create table gemini_price (
  id smallint primary key default 1 check (id = 1),
  model text not null,
  input_micro_usd_per_million integer not null check (input_micro_usd_per_million >= 0),
  output_micro_usd_per_million integer not null check (output_micro_usd_per_million >= 0),
  inr_paise_per_usd integer not null check (inr_paise_per_usd > 0),
  gst_percent integer not null check (gst_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
comment on column gemini_price.input_micro_usd_per_million is 'US dollars per million input tokens x 1,000,000 ($0.75 = 750000; from 1 Jan 2027 $1.50 = 1500000)';
comment on column gemini_price.output_micro_usd_per_million is 'US dollars per million output tokens x 1,000,000 ($3.75 = 3750000; from 1 Jan 2027 $7.50 = 7500000)';
comment on column gemini_price.inr_paise_per_usd is 'rupees per US dollar x 100 (Rs 95.17 = 9517)';
-- ai.google.dev/gemini-api/docs/pricing (30 Oct 2026, eval/bakeoff/score.ts); the RBI reference rate of 31 Oct 2026; GST 18%
insert into gemini_price (id, model, input_micro_usd_per_million, output_micro_usd_per_million, inr_paise_per_usd, gst_percent)
values (1, 'gemini-3.8-flash', 750000, 3750000, 9517, 18);

create table signup_allowlist (
  email text primary key check (length(email) between 3 and 320),
  note text check (note is null or length(note) <= 200),
  added_at timestamptz not null default now()
);
create unique index signup_allowlist_lower on signup_allowlist (lower(email));
-- the owner's two Google accounts (the real shop's owner and the TEST account) - by id, so no email address is written in git.
-- On any other database (the local stack) these accounts do not exist and nothing is added.
insert into signup_allowlist (email, note)
select x.email, x.note from (
  select u.email, 'owner' as note from auth.users u where u.id = '5438e8b2-4412-48d7-b1e5-f017e144cd6f'
  union all
  select u.email, 'TEST account' from auth.users u where u.id = '77636ea8-8058-44ef-9762-76dfc47e5502'
) x where x.email is not null;

create table voice_usage (
  day date not null,
  shop_id uuid not null references shops (id),
  calls integer not null default 0 check (calls >= 0),
  done integer not null default 0 check (done >= 0),
  failed integer not null default 0 check (failed >= 0),
  refused integer not null default 0 check (refused >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micro_inr bigint not null default 0 check (cost_micro_inr >= 0),
  primary key (day, shop_id)
);
create index on voice_usage (shop_id);

alter table app_limits enable row level security;
alter table gemini_price enable row level security;
alter table signup_allowlist enable row level security;
alter table voice_usage enable row level security;
-- no policies and no grants: no app role reads or writes these (the functions below run as their owner)
revoke all on app_limits, gemini_price, signup_allowlist, voice_usage from public, anon, authenticated;

create or replace function app_limits_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger app_limits_touch before update on app_limits for each row execute function app_limits_touch();
create trigger gemini_price_touch before update on gemini_price for each row execute function app_limits_touch();

-- The claim, now with the day's limit. The recording row is locked first (a double tap or a Netlify retry waits, then finds it
-- running), then the shop's counter row (two recordings at once can never both take the last call).
create or replace function claim_voice_recording(p_recording_id uuid)
returns setof voice_recordings
language plpgsql
security definer
set search_path = public
as $$
declare
  r voice_recordings;
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_cap integer := coalesce((select shop_calls_per_day from app_limits where id = 1), 250);
begin
  select * into r from voice_recordings
   where recording_id = p_recording_id
     and is_shop_member(shop_id)
     and (status in ('queued', 'failed') or (status = 'running' and started_at < now() - interval '70 seconds'))
     for update;
  if not found then
    return;
  end if;

  insert into voice_usage (day, shop_id) values (v_day, r.shop_id) on conflict (day, shop_id) do nothing;
  update voice_usage set calls = calls + 1 where day = v_day and shop_id = r.shop_id and calls < v_cap;
  if not found then
    update voice_usage set refused = refused + 1 where day = v_day and shop_id = r.shop_id;
    -- attempts + 1: the phone counts a failure only from a newer attempt (src/data/voiceJob.ts)
    update voice_recordings
       set status = 'failed', attempts = attempts + 1, started_at = now(), finished_at = now(), error = 'day_limit'
     where recording_id = p_recording_id;
    return;
  end if;

  return query
  update voice_recordings
     set status = 'running', attempts = attempts + 1, started_at = now(), finished_at = null, error = null
   where recording_id = p_recording_id
  returning *;
end;
$$;

-- The result, now also counted: done / failed, the real tokens and the cost at the current price, on the day the call was claimed.
-- A token count that is not a number from 0 to 10 million counts as 0 - junk never breaks a finish.
create or replace function finish_voice_recording(
  p_recording_id uuid, p_attempt int, p_status text, p_transcript text, p_items jsonb, p_usage jsonb, p_model text, p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid;
  v_day date;
  v_in bigint := 0;
  v_out bigint := 0;
  v_cost bigint := 0;
  p gemini_price;
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
     and attempts = p_attempt
  returning shop_id, (coalesce(started_at, now()) at time zone 'Asia/Kolkata')::date into v_shop, v_day;
  if v_shop is null then
    return false;
  end if;

  if jsonb_typeof(p_usage) = 'object' then
    if jsonb_typeof(p_usage -> 'promptTokens') = 'number' and (p_usage ->> 'promptTokens')::numeric between 0 and 10000000 then
      v_in := round((p_usage ->> 'promptTokens')::numeric);
    end if;
    if jsonb_typeof(p_usage -> 'completionTokens') = 'number' and (p_usage ->> 'completionTokens')::numeric between 0 and 10000000 then
      v_out := round((p_usage ->> 'completionTokens')::numeric);
    end if;
  end if;
  select * into p from gemini_price where id = 1;
  if found then
    -- micro-$ = tokens x micro-$-per-million / 1e6; micro-rupees = micro-$ x paise-per-$ / 100, plus GST
    v_cost := round((v_in * p.input_micro_usd_per_million + v_out * p.output_micro_usd_per_million) / 1000000.0
                    * p.inr_paise_per_usd / 100.0 * (100 + p.gst_percent) / 100.0);
  end if;

  insert into voice_usage (day, shop_id) values (v_day, v_shop) on conflict (day, shop_id) do nothing;
  update voice_usage
     set done = done + (p_status = 'done')::int, failed = failed + (p_status = 'failed')::int,
         input_tokens = input_tokens + v_in, output_tokens = output_tokens + v_out, cost_micro_inr = cost_micro_inr + v_cost
   where day = v_day and shop_id = v_shop;
  return true;
end;
$$;

revoke all on function claim_voice_recording(uuid) from public, anon;
revoke all on function finish_voice_recording(uuid, int, text, text, jsonb, jsonb, text, text) from public, anon;
grant execute on function claim_voice_recording(uuid) to authenticated;
grant execute on function finish_voice_recording(uuid, int, text, text, jsonb, jsonb, text, text) to authenticated;

-- Sign-ups. May the signed-in caller make a shop? Open mode, or their account's email is on the list (any letter case).
create or replace function signup_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select signup_mode from app_limits where id = 1), 'allowlist') = 'open'
      or exists (
        select 1 from signup_allowlist a join auth.users u on lower(a.email) = lower(u.email)
         where u.id = auth.uid()
      );
$$;
revoke all on function signup_allowed() from public, anon;
grant execute on function signup_allowed() to authenticated;

-- Every new shop: created_at from the server's clock (a phone cannot backdate it to look old); an insert by an app role must pass
-- signup_allowed(). The dashboard and the database's own functions (postgres) are not app roles. Existing shops are never checked.
create or replace function shops_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  if current_user in ('authenticated', 'anon') and not signup_allowed() then
    raise exception 'signup_closed' using errcode = 'P0001', hint = 'signup_closed';
  end if;
  return new;
end;
$$;
create trigger shops_before_insert before insert on shops for each row execute function shops_before_insert();

-- The owner's reports: the dashboard only (SQL editor or Table Editor, schema "reports"). Not an API schema, and closed to every app
-- role. Days and times are India time. The TEST shop (and its account) is marked and left out of every total. Bills = final +
-- cancelled bills, by the day the phone made them. Rupees are rounded to the paisa, for reading only.
create schema reports;
revoke all on schema reports from public, anon, authenticated, service_role;

create view reports.daily as
with
  u as (select (created_at at time zone 'Asia/Kolkata')::date as d, count(*) as n from auth.users
         where id <> '77636ea8-8058-44ef-9762-76dfc47e5502' group by 1),
  s as (select (created_at at time zone 'Asia/Kolkata')::date as d, count(*) as n from public.shops
         where id <> 'ac8dda60-6c96-446f-a520-35888e1742c2' group by 1),
  b as (select (created_at at time zone 'Asia/Kolkata')::date as d, count(*) as n from public.bills
         where status <> 'draft' and shop_id <> 'ac8dda60-6c96-446f-a520-35888e1742c2' group by 1),
  v as (select day as d, sum(calls) as calls, sum(done) as done, sum(failed) as failed, sum(refused) as refused,
               sum(cost_micro_inr) as cost
          from public.voice_usage where shop_id <> 'ac8dda60-6c96-446f-a520-35888e1742c2' group by 1),
  days as (select d from u union select d from s union select d from b union select d from v)
select days.d as day,
       coalesce(u.n, 0) as new_users,
       coalesce(s.n, 0) as new_shops,
       coalesce(b.n, 0) as bills,
       coalesce(v.calls, 0) as voice_calls,
       coalesce(v.done, 0) as voice_done,
       coalesce(v.failed, 0) as voice_failed,
       coalesce(v.refused, 0) as voice_refused_by_limit,
       round(coalesce(v.cost, 0) / 1000000.0, 2) as gemini_cost_rs
  from days
  left join u on u.d = days.d
  left join s on s.d = days.d
  left join b on b.d = days.d
  left join v on v.d = days.d
 order by days.d desc;

create view reports.shops as
with today as (select (now() at time zone 'Asia/Kolkata')::date as d)
select s.id as shop_id,
       s.name as shop_name,
       s.id = 'ac8dda60-6c96-446f-a520-35888e1742c2' as is_test,
       u.email as owner_email,
       (u.created_at at time zone 'Asia/Kolkata') as signed_up,
       (s.created_at at time zone 'Asia/Kolkata') as shop_created,
       (greatest(u.last_sign_in_at, bl.last_bill, vr.last_voice) at time zone 'Asia/Kolkata') as last_active,
       coalesce(ph.n, 0) as phones,
       coalesce(bl.today, 0) as bills_today,
       coalesce(bl.total, 0) as bills_total,
       coalesce(vu.calls_today, 0) as voice_calls_today,
       coalesce(vu.calls_total, 0) as voice_calls_total,
       round(coalesce(vu.cost_today, 0) / 1000000.0, 2) as gemini_cost_today_rs,
       round(coalesce(vu.cost_total, 0) / 1000000.0, 2) as gemini_cost_total_rs,
       case when coalesce(bl.total, 0) > 0 then round(coalesce(vu.cost_total, 0) / 1000000.0 / bl.total, 2) end as avg_cost_per_bill_rs
  from public.shops s
  cross join today
  left join auth.users u on u.id = s.owner_user_id
  left join lateral (
    select count(*) filter (where (b.created_at at time zone 'Asia/Kolkata')::date = today.d) as today, count(*) as total,
           max(b.synced_at) as last_bill
      from public.bills b where b.shop_id = s.id and b.status <> 'draft'
  ) bl on true
  left join lateral (
    select count(distinct x.device_id) as n from (
      select device_id from public.bills where shop_id = s.id
      union all
      select device_id from public.bill_metrics where shop_id = s.id
    ) x
  ) ph on true
  left join lateral (
    select sum(calls) filter (where day = today.d) as calls_today, sum(calls) as calls_total,
           sum(cost_micro_inr) filter (where day = today.d) as cost_today, sum(cost_micro_inr) as cost_total
      from public.voice_usage where shop_id = s.id
  ) vu on true
  left join lateral (select max(created_at) as last_voice from public.voice_recordings where shop_id = s.id) vr on true
 order by is_test, last_active desc nulls last;

revoke all on all tables in schema reports from public, anon, authenticated, service_role;

-- "Delete my account" (D119): the same function, with voice_usage added to its list (before shops - its foreign key).
create or replace function delete_account_internal(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shops uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  t text;
begin
  if p_user_id is null then
    raise exception 'delete_account: not signed in' using errcode = '28000';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'delete_account: no such account' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct s), '{}') into v_shops from (
    select shop_id as s from shop_members where user_id = p_user_id
    union
    select id from shops where owner_user_id = p_user_id
  ) x;

  if exists (select 1 from shop_members where shop_id = any (v_shops) and user_id <> p_user_id) then
    raise exception 'delete_account: a shop has other members - remove them first' using errcode = 'P0001', hint = 'shared_shop';
  end if;

  perform set_config('kb.deleting_account', 'on', true);

  -- children first (no foreign key cascades): bills' children, learning, recordings, numbers, then bills, products, the shop
  foreach t in array array[
    'bill_items', 'bill_cancellations', 'bill_metrics', 'learning_events', 'price_observations', 'learned_aliases',
    'provisional_products', 'voice_recordings', 'voice_usage', 'bill_number_grants', 'shop_bill_counters', 'receipt_number_blocks',
    'bills', 'shop_products', 'shop_members'
  ] loop
    execute format('delete from %I where shop_id = any ($1)', t) using v_shops;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, v_n);
  end loop;
  delete from shop_members where user_id = p_user_id; -- a membership with no shop row of its own (none expected)
  delete from shops where id = any (v_shops);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('shops', v_n);

  delete from auth.users where id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('auth_users', v_n);

  perform set_config('kb.deleting_account', 'off', true);
  return v_counts;
end;
$$;

revoke all on function delete_account_internal(uuid) from public, anon, authenticated, service_role;
