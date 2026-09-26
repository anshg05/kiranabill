-- KB-110b: atomic, idempotent bill push (docs/12-PARKED.md KI-29),
-- bill_items.rate_unit (docs/07-DECISIONS.md D36), and same-shop integrity
-- for bill_items (review finding, 26 Sep 2026). See D37.

-- 1. An item may only attach to a bill of its OWN shop. bill_items_insert's
--    RLS checks only the item's shop_id, the plain bill_id FK doesn't care
--    which shop the bill belongs to, and bill_items_immutability reads the
--    parent through RLS (it sees nothing for another shop's bill, so it
--    allowed the insert - proven by scripts/rls-negative-tests.ts before this
--    migration). The composite FK closes it structurally, whatever RLS sees.
alter table bills
  add constraint bills_id_shop_id_key unique (id, shop_id);
alter table bill_items
  add constraint bill_items_bill_same_shop_fkey
  foreign key (bill_id, shop_id) references bills (id, shop_id);

-- The plain bill_id FK is now redundant (bill_id and shop_id are both NOT
-- NULL, so the composite FK enforces everything it did) - and NOT harmless:
-- with both present, PostgREST sees two bills<->bill_items relationships
-- and rejects every embed ("Could not embed because more than one
-- relationship was found for 'bills' and 'bill_items'"). Found by
-- KB-110b's real e2e run, not by any mocked test. See D37.
alter table bill_items drop constraint bill_items_bill_id_fkey;

-- 2. rate_unit (D36): the unit a line's rate is per. No vocabulary check -
--    bill_items.unit and shop_products.unit are free text (custom, imported,
--    provisional units); a value list would turn valid lines into permanent
--    23514 conflicts. Unit vocabulary is KI-16's job, for unit and rate_unit
--    together.
alter table bill_items add column rate_unit text;

-- 3. Backfill with the pre-D36 meaning (a rate was per the line's own unit).
--    The UPDATE would fire bill_items_immutability and abort on any final or
--    cancelled bill's items, so only that trigger is disabled around it -
--    inside ONE DO block, a single statement: if the backfill fails, the
--    disable rolls back with it and the trigger can never be left off,
--    however the CLI batches migration files.
do $$
begin
  alter table bill_items disable trigger bill_items_immutability;
  update bill_items set rate_unit = unit where rate_paise is not null;
  alter table bill_items enable trigger bill_items_immutability;
end;
$$;

-- 4. Null exactly when rate_paise is null. A row with a rate but no unit
--    fails here loudly rather than being guessed.
alter table bill_items
  add constraint bill_items_rate_unit_iff_rate
  check ((rate_paise is null) = (rate_unit is null));

-- 5. "Already done" test for push_bill's retries: same immutable bill
--    content AND identical item sets. Every comparison is IS NOT DISTINCT
--    FROM, so a missing/null payload field is a MISMATCH, never NULL - an
--    AND-chain of `=` returns NULL on any null, and `if not NULL` does not
--    raise, which would turn a divergent retry into a silent no-op success
--    (review finding, 26 Sep 2026). created_at / finalized_at are excluded:
--    timestamptz round-trips can change precision, and neither decides
--    whether two pushes are the same bill. EXCEPT compares rows with
--    IS NOT DISTINCT FROM semantics already (nulls compare equal).
create or replace function push_bill_content_matches(p_existing bills, p_bill jsonb, p_items jsonb)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with payload as (
    select i.line_no, i.shop_product_id, i.display_name, i.spoken_name,
           i.qty::numeric(12,3) as qty, i.unit, i.rate_paise, i.rate_unit,
           i.total_paise, i.price_type, i.source,
           coalesce(i.review_flags, '[]'::jsonb) as review_flags, i.was_edited
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(
      line_no int, shop_product_id uuid, display_name text, spoken_name text,
      qty numeric, unit text, rate_paise bigint, rate_unit text, total_paise bigint,
      price_type text, source text, review_flags jsonb, was_edited boolean)
  ),
  existing as (
    select line_no, shop_product_id, display_name, spoken_name, qty, unit,
           rate_paise, rate_unit, total_paise, price_type, source, review_flags,
           was_edited
    from bill_items where bill_id = p_existing.id
  )
  select coalesce(
       p_existing.receipt_number        is not distinct from (p_bill->>'receipt_number')
   and p_existing.receipt_number_source is not distinct from (p_bill->>'receipt_number_source')
   and p_existing.customer_name         is not distinct from (p_bill->>'customer_name')
   and p_existing.customer_mobile       is not distinct from (p_bill->>'customer_mobile')
   and p_existing.subtotal_paise        is not distinct from (p_bill->>'subtotal_paise')::bigint
   and p_existing.total_paise           is not distinct from (p_bill->>'total_paise')::bigint
   and p_existing.schema_version        is not distinct from (p_bill->>'schema_version')::int
   and p_existing.device_id             is not distinct from (p_bill->>'device_id')
   and (select count(*) from existing)  is not distinct from jsonb_array_length(coalesce(p_items, '[]'::jsonb))::bigint
   and not exists (select * from existing except select * from payload)
   and not exists (select * from payload except select * from existing),
   false);
$$;

-- 6. Atomic push. PostgREST runs an RPC in one transaction: the bill, every
--    item and the status transitions commit or roll back together. SECURITY
--    INVOKER - every statement runs as the caller under the existing
--    bills / bill_items RLS policies; never SECURITY DEFINER (hard rule 4).
--    Only final/cancelled bills are pushed; drafts stay on the device (D37).
create or replace function push_bill(p_bill jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shop_id  uuid := (p_bill->>'shop_id')::uuid;
  v_local_id uuid := (p_bill->>'local_id')::uuid;
  v_target   text := p_bill->>'status';
  v_existing bills%rowtype;
  v_bill_id  uuid;
begin
  if v_target is distinct from 'final' and v_target is distinct from 'cancelled' then
    raise exception 'push_bill: only final or cancelled bills are pushed (got %)', v_target
      using errcode = 'KB400';
  end if;

  -- RLS applies: another shop's bill is invisible, so it can never be
  -- matched, compared or modified from here.
  select * into v_existing from bills where shop_id = v_shop_id and local_id = v_local_id;

  if not found then
    begin
      -- Inserted as DRAFT so its items can be inserted (bill_items_immutability
      -- rejects items on a final bill), then moved to final - the KI-29 fix.
      insert into bills (shop_id, local_id, receipt_number, receipt_number_source,
                         customer_name, customer_mobile, subtotal_paise, total_paise,
                         status, schema_version, device_id, created_at, finalized_at)
      values (v_shop_id, v_local_id, p_bill->>'receipt_number',
              p_bill->>'receipt_number_source', p_bill->>'customer_name',
              p_bill->>'customer_mobile', (p_bill->>'subtotal_paise')::bigint,
              (p_bill->>'total_paise')::bigint, 'draft',
              (p_bill->>'schema_version')::int, p_bill->>'device_id',
              (p_bill->>'created_at')::timestamptz, (p_bill->>'finalized_at')::timestamptz)
      returning id into v_bill_id;

      -- shop_id and bill_id come from the function, never from the payload.
      insert into bill_items (bill_id, shop_id, line_no, shop_product_id, display_name,
                              spoken_name, qty, unit, rate_paise, rate_unit, total_paise,
                              price_type, source, review_flags, was_edited)
      select v_bill_id, v_shop_id, i.line_no, i.shop_product_id, i.display_name,
             i.spoken_name, i.qty, i.unit, i.rate_paise, i.rate_unit, i.total_paise,
             i.price_type, i.source, coalesce(i.review_flags, '[]'::jsonb),
             coalesce(i.was_edited, false)
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(
        line_no int, shop_product_id uuid, display_name text, spoken_name text,
        qty numeric, unit text, rate_paise bigint, rate_unit text, total_paise bigint,
        price_type text, source text, review_flags jsonb, was_edited boolean);

      update bills set status = 'final' where id = v_bill_id;
      if v_target = 'cancelled' then
        update bills set status = 'cancelled' where id = v_bill_id;  -- only status differs (D18)
      end if;
      return v_bill_id;
    exception when unique_violation then
      -- Either a concurrent push of this same bill won the race (local_id),
      -- or a genuine duplicate receipt_number. If our row now exists, fall
      -- through to the compare path; otherwise re-raise (23505, permanent).
      select * into v_existing from bills where shop_id = v_shop_id and local_id = v_local_id;
      if not found then
        raise;
      end if;
    end;
  end if;

  -- The row already exists: a lost-response retry, a concurrent push, or a
  -- later cancel of an already-synced bill. `is not true`, never `not`: a
  -- NULL result must be a mismatch, not a silent success.
  if push_bill_content_matches(v_existing, p_bill, p_items) is not true then
    raise exception 'push_bill: bill % already exists with different content', v_local_id
      using errcode = 'KB409';
  end if;
  if v_existing.status = v_target then
    return v_existing.id;                                   -- no-op success
  end if;
  if v_existing.status = 'final' and v_target = 'cancelled' then
    update bills set status = 'cancelled' where id = v_existing.id;
    return v_existing.id;
  end if;
  raise exception 'push_bill: cannot move bill % from % to %',
    v_local_id, v_existing.status, v_target using errcode = 'KB409';
end;
$$;

revoke execute on function push_bill_content_matches(bills, jsonb, jsonb) from public, anon;
grant  execute on function push_bill_content_matches(bills, jsonb, jsonb) to authenticated;
revoke execute on function push_bill(jsonb, jsonb) from public, anon;
grant  execute on function push_bill(jsonb, jsonb) to authenticated;
