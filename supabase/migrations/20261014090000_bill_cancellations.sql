-- KB-325 (owner, 14 Oct 2026; D79): cancel and reissue a bill - the remedy hard rule 2 names.
--
-- A finalised bill stays immutable: the ONE legal change is status 'final' -> 'cancelled', and bills_enforce_immutability
-- (D18) rejects any other column changing on that transition. So the reason, the time and the link to the replacement
-- do NOT go on `bills` (that would mean loosening the trigger that guards hard rule 2); they live in this separate,
-- append-only table, one row per cancelled bill. Other devices learn of a cancellation by pulling THIS table (its
-- updated_at is stamped by the server, like the learning tables - D62/D66), because a cancel changes `bills.status`
-- only and bills.synced_at is set on insert only (KB-324).
--
-- cancel_bill() is SECURITY INVOKER (like push_bill, D37): every statement runs as the caller under RLS (hard rule 4).
-- It is idempotent - a retry, or a second device cancelling the same bill, returns the existing row's id.
--
-- Additive (D55 section 5): a new table and a new function; the deployed app never touches either, and a cancelled
-- bill it pulls (status 'cancelled') is already stored by its pull.

create table bill_cancellations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  bill_id uuid not null,
  -- the bill's own local_id: a pulling device finds its local bill by it, with no join.
  bill_local_id uuid not null,
  reason text not null check (reason in ('wrong_item', 'wrong_price', 'wrong_quantity', 'customer_cancelled', 'other')),
  -- the draft the shopkeeper started to replace it with, if any. The replacement bill finds its predecessor by
  -- looking this up (no column on bills): where replacement_local_id = its own local_id.
  replacement_local_id uuid,
  cancelled_at timestamptz not null,
  local_id uuid not null,
  device_id text not null,
  updated_at timestamptz not null default now(),
  unique (shop_id, bill_id),
  unique (shop_id, local_id),
  -- same-shop integrity (KI-38): the cancelled bill belongs to the same shop as this row.
  foreign key (bill_id, shop_id) references bills (id, shop_id)
);

create index on bill_cancellations (shop_id, updated_at, id);
create index on bill_cancellations (shop_id, replacement_local_id) where replacement_local_id is not null;

create trigger bill_cancellations_set_updated_at
  before insert on bill_cancellations
  for each row execute function set_learning_updated_at();

alter table bill_cancellations enable row level security;

-- Select and insert for a member of the shop; no update and no delete policy at all (append-only).
create policy bill_cancellations_select on bill_cancellations for select
  using (is_shop_member(shop_id));

create policy bill_cancellations_insert on bill_cancellations for insert
  with check (is_shop_member(shop_id));

create or replace function cancel_bill(
  p_shop_id uuid,
  p_bill_local_id uuid,
  p_reason text,
  p_local_id uuid,
  p_device_id text,
  p_cancelled_at timestamptz,
  p_replacement_local_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_bill_id uuid;
  v_status  text;
  v_id      uuid;
begin
  -- RLS applies: another shop's bill is invisible, so it is "unknown" here.
  select id, status into v_bill_id, v_status from bills where shop_id = p_shop_id and local_id = p_bill_local_id;
  if not found then
    raise exception 'cancel_bill: unknown bill %', p_bill_local_id using errcode = 'KB404';
  end if;
  if v_status not in ('final', 'cancelled') then
    raise exception 'cancel_bill: only a final bill can be cancelled (status %)', v_status using errcode = 'KB400';
  end if;

  -- Already cancelled (a retry, or another device first): success, nothing changes.
  select id into v_id from bill_cancellations where shop_id = p_shop_id and bill_id = v_bill_id;
  if found then
    return v_id;
  end if;

  -- Only if still final: a concurrent cancel that won the race leaves nothing to update, and the immutability
  -- trigger is never asked to touch a cancelled row.
  update bills set status = 'cancelled' where id = v_bill_id and status = 'final';

  begin
    insert into bill_cancellations (shop_id, bill_id, bill_local_id, reason, replacement_local_id, cancelled_at, local_id, device_id)
    values (p_shop_id, v_bill_id, p_bill_local_id, p_reason, p_replacement_local_id, p_cancelled_at, p_local_id, p_device_id)
    returning id into v_id;
  exception when unique_violation then
    -- a concurrent call inserted it first (this bill, or this local_id): hand back that row.
    select id into v_id from bill_cancellations where shop_id = p_shop_id and (bill_id = v_bill_id or local_id = p_local_id) order by cancelled_at limit 1;
    if v_id is null then
      raise;
    end if;
  end;
  return v_id;
end;
$$;

revoke execute on function cancel_bill(uuid, uuid, text, uuid, text, timestamptz, uuid) from public, anon;
grant  execute on function cancel_bill(uuid, uuid, text, uuid, text, timestamptz, uuid) to authenticated;
