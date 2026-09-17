-- KB-103: billing tables (bills, bill_items, receipt_number_blocks) and
-- the bill immutability trigger.
--
-- Schema only - RLS is KB-104's job.
--
-- "Finalised bills are immutable. Wrong bill -> cancel and reissue"
-- (CLAUDE.md hard rule 2, 03-DATA-MODEL.md iron rule 3) is enforced here
-- by a trigger, not by convention - a wrong bill silently editable after
-- finalisation is exactly the class of bug this whole project exists to
-- prevent. The one legal transition out of 'final' is to 'cancelled', and
-- on that transition ONLY the status column may change - every other
-- column (including subtotal_paise/total_paise) must stay byte-identical
-- to its pre-cancellation value, checked column by column, not just
-- asserted. A cancelled bill silently ending up with a different total
-- would defeat the entire point of this trigger existing.
--
-- docs/03-DATA-MODEL.md's own conflict-strategy table (02-ARCHITECTURE.md
-- section 2) says bill_items are "Immutable once the bill is finalised"
-- too - the same rule, one level down. Not explicitly asked for as its
-- own trigger, but directly required by the same hard rule bills' trigger
-- enforces, so it's included here rather than left as a gap: a line item
-- silently editable (or insertable, or deletable) after its parent bill
-- finalises would let the total quietly drift out of sync with its own
-- lines. Unlike bills, there is no "only status may change" carve-out for
-- a line item - once its parent bill is final or cancelled, nothing about
-- it may change at all.

create table bills (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  local_id uuid not null,
  receipt_number text not null,
  customer_name text not null default 'Cash',
  customer_mobile text,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  status text not null default 'draft' check (status in ('draft', 'final', 'cancelled')),
  schema_version int not null,
  device_id text not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  synced_at timestamptz,
  unique (shop_id, local_id),
  unique (shop_id, receipt_number)
);

create index on bills (shop_id, created_at desc);
create index on bills (shop_id, customer_name);

create or replace function bills_enforce_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'cancelled' then
    raise exception 'bills: a cancelled bill can never be modified (id=%)', old.id;
  end if;

  if old.status = 'final' then
    if new.status is distinct from 'cancelled' then
      raise exception 'bills: a finalised bill may only transition to cancelled, not to % (id=%)', new.status, old.id;
    end if;

    -- Every column except status must stay byte-identical. Listed
    -- explicitly, not "select * differs", so a future added column is
    -- forced through this check deliberately rather than silently passing.
    if new.id is distinct from old.id
      or new.shop_id is distinct from old.shop_id
      or new.local_id is distinct from old.local_id
      or new.receipt_number is distinct from old.receipt_number
      or new.customer_name is distinct from old.customer_name
      or new.customer_mobile is distinct from old.customer_mobile
      or new.subtotal_paise is distinct from old.subtotal_paise
      or new.total_paise is distinct from old.total_paise
      or new.schema_version is distinct from old.schema_version
      or new.device_id is distinct from old.device_id
      or new.created_at is distinct from old.created_at
      or new.finalized_at is distinct from old.finalized_at
      or new.synced_at is distinct from old.synced_at
    then
      raise exception 'bills: cancelling a finalised bill may only change status - every other column must stay identical (id=%)', old.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger bills_immutability
  before update on bills
  for each row
  execute function bills_enforce_immutability();

create table bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills (id),
  shop_id uuid not null references shops (id),
  line_no int not null,
  shop_product_id uuid references shop_products (id),
  display_name text not null,
  spoken_name text,
  qty numeric(12,3),
  unit text,
  rate_paise bigint check (rate_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  price_type text not null check (price_type in ('rate', 'total', 'default', 'unknown')),
  source text not null check (source in ('voice', 'fastpath', 'manual')),
  review_flags jsonb not null default '[]'::jsonb,
  was_edited boolean not null default false
  -- Deliberately no local_id/device_id/updated_at here - a line item
  -- syncs atomically as part of its parent bill (bill_id), never
  -- independently. Confirmed intentional during KB-103's planning, not
  -- an inconsistency with the learning tables gaining sync columns
  -- (docs/07-DECISIONS.md D17) - those four are each their own
  -- root-level syncable entity; this one has a parent that already
  -- carries sync state on its behalf.
);

create index on bill_items (bill_id);
create index on bill_items (shop_id, display_name);

create or replace function bill_items_enforce_immutability()
returns trigger
language plpgsql
as $$
declare
  parent_status text;
  affected_bill_id uuid := coalesce(new.bill_id, old.bill_id);
begin
  select status into parent_status from bills where id = affected_bill_id;

  if parent_status in ('final', 'cancelled') then
    raise exception 'bill_items: cannot add, change, or remove a line item on a % bill (bill_id=%)', parent_status, affected_bill_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger bill_items_immutability
  before insert or update or delete on bill_items
  for each row
  execute function bill_items_enforce_immutability();

create table receipt_number_blocks (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  device_id text not null,
  block_start int not null,
  block_end int not null,
  next_number int not null,
  allocated_at timestamptz not null default now()
);

create index on receipt_number_blocks (shop_id);
