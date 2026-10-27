-- KB-351 (owner, 22 Oct 2026; D92): one bill-number sequence for the whole shop - 1, 2, 3 ... whatever phone saves the bill.
--
-- Until now each phone drew its own block of 50 numbers (D22 / D74), so two phones issued 12 and 61 side by side. Now Bill Banao
-- (online) takes the next number from the server: an atomic per-shop counter. Two phones saving at the same moment get 5 and 6.
-- Offline, or when the server is too slow, the bill still saves at once with the KB-341 offline number (a 6-character device
-- code and "-n"), kept for ever. The old block table and its constraint stay until a later release (D55 section 5:
-- expand, deploy, contract) - nothing here touches them.
--
-- SECURITY INVOKER (hard rule: no security definer): every statement runs as the caller under RLS - a member of the shop, nobody
-- else, never anon. The counter is seeded the first time a shop asks, from the highest number it has used so far (bills of
-- source 'block' or 'counter' - the trailing digits - and the blocks' own next_number), so the sequence continues with no jump.
--
-- bill_number_grants makes a retry for the SAME bill return the SAME number (a double tap, a lost response, a local write that
-- failed after the number came back) - a number is burned only if the bill itself is never saved. A cancelled bill keeps its number.
--
-- Additive (D55 section 5): two tables, one trigger, one function, one wider CHECK, one nullable column. The deployed app
-- writes only 'block' / 'fallback' and never calls any of it.

create table shop_bill_counters (
  shop_id uuid primary key references shops (id),
  last_number bigint not null check (last_number >= 1),
  updated_at timestamptz not null default now()
);

create table bill_number_grants (
  shop_id uuid not null references shops (id),
  local_id uuid not null,
  bill_number bigint not null check (bill_number >= 1),
  granted_at timestamptz not null default now(),
  primary key (shop_id, local_id)
);

alter table shop_bill_counters enable row level security;
alter table bill_number_grants enable row level security;

create policy shop_bill_counters_select on shop_bill_counters for select using (is_shop_member(shop_id));
create policy shop_bill_counters_insert on shop_bill_counters for insert with check (is_shop_member(shop_id));
create policy shop_bill_counters_update on shop_bill_counters for update using (is_shop_member(shop_id)) with check (is_shop_member(shop_id));
-- no delete policy: a counter is never removed

create policy bill_number_grants_select on bill_number_grants for select using (is_shop_member(shop_id));
create policy bill_number_grants_insert on bill_number_grants for insert with check (is_shop_member(shop_id));
-- no update, no delete policy: a grant is append-only

-- The counter only ever moves up by exactly one: nobody (not even a member, by a direct UPDATE) can move it down or jump it.
create function shop_bill_counter_step() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.shop_id <> old.shop_id or new.last_number <> old.last_number + 1 then
    raise exception 'shop_bill_counters: the counter only moves up by one' using errcode = 'KB409';
  end if;
  return new;
end;
$$;

create trigger shop_bill_counters_step
  before update on shop_bill_counters
  for each row execute function shop_bill_counter_step();

create function next_bill_number(p_shop_id uuid, p_local_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_number bigint;
  v_seed bigint;
begin
  -- Two calls for the same bill at once (a double tap) take turns: the second sees the first's grant.
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text || p_local_id::text, 0));

  select bill_number into v_number from bill_number_grants where shop_id = p_shop_id and local_id = p_local_id;
  if found then
    return v_number;
  end if;

  -- One atomic statement: the row lock makes concurrent callers take turns, each gets its own number.
  update shop_bill_counters set last_number = last_number + 1, updated_at = now()
   where shop_id = p_shop_id
  returning last_number into v_number;

  if not found then
    -- The shop's first call: continue after the highest number used so far (no jump).
    select greatest(
             coalesce((select max(substring(receipt_number from '([0-9]+)$')::bigint)
                         from bills
                        where shop_id = p_shop_id and receipt_number_source in ('block', 'counter') and receipt_number ~ '[0-9]$'), 0),
             coalesce((select max(next_number - 1) from receipt_number_blocks where shop_id = p_shop_id and next_number > block_start), 0)
           ) into v_seed;
    -- Two first calls at once both compute the same seed; the second one's insert conflicts and takes the next number instead.
    insert into shop_bill_counters (shop_id, last_number) values (p_shop_id, v_seed + 1)
    on conflict (shop_id) do update set last_number = shop_bill_counters.last_number + 1, updated_at = now()
    returning last_number into v_number;
  end if;

  insert into bill_number_grants (shop_id, local_id, bill_number) values (p_shop_id, p_local_id, v_number);
  return v_number;
end;
$$;

revoke execute on function next_bill_number(uuid, uuid) from public, anon;
grant execute on function next_bill_number(uuid, uuid) to authenticated;

-- D24: the label stays for ever; a number from the counter is labelled 'counter'. Old bills keep 'block' / 'fallback'.
alter table bills drop constraint if exists bills_receipt_number_source_check;
alter table bills add constraint bills_receipt_number_source_check check (receipt_number_source in ('block', 'fallback', 'counter'));

-- KB-351: how long the server round trip for the bill number took (null: no attempt, or an offline number).
alter table bill_metrics add column number_ms int check (number_ms is null or number_ms >= 0);
