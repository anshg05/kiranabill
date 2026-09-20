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
-- to its pre-cancellation value, checked via a jsonb diff of the row minus
-- status (see the function body), not just asserted. A cancelled bill
-- silently ending up with a different total would defeat the entire point
-- of this trigger existing.
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

    -- Every column except status must stay byte-identical. Compared via a
    -- jsonb diff of the whole row (minus status), not an explicit column
    -- list - a jsonb list is forced through this check automatically the
    -- moment it exists on the table, so a future column added to bills
    -- can't silently bypass the check by the trigger simply not mentioning
    -- it (the original explicit-list version had exactly that unguarded
    -- gap - see docs/07-DECISIONS.md D18).
    --
    -- jsonb equality can be a footgun for float columns (e.g. distinct
    -- numeric representations of the same value comparing unequal as
    -- jsonb text) - doesn't apply here: every column on bills is
    -- uuid/text/bigint/int/timestamptz, never float or unconstrained
    -- numeric, so this comparison is judged safe for THIS table
    -- specifically, not assumed safe for jsonb diffs in general.
    if (to_jsonb(old) - 'status') is distinct from (to_jsonb(new) - 'status') then
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
