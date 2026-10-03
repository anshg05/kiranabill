-- KB-307 commit 1 (owner, 3 Oct 2026): integrity before bills and learning
-- rows start arriving. Closes docs/12-PARKED.md KI-38 and KI-41. See D53.

-- ---------------------------------------------------------------------------
-- 1. KI-38: every cross-table reference stays inside its own shop.
--    Each table's insert RLS checks only the row's own shop_id, and a plain
--    FK check runs as the table owner (it ignores RLS) - so a shop-B member
--    could point a shop-B row at a shop-A bill or product (no read leak, but
--    a cross-tenant reference and an FK-error existence oracle). The same fix
--    as KB-110b's bill_items -> bills (D37): unique (id, shop_id) on the
--    referenced table, a composite FK on (ref, shop_id), and the plain FK
--    DROPPED - with both present PostgREST sees two relationships and rejects
--    every embed. A NULL reference stays allowed (MATCH SIMPLE: a composite FK
--    with a null column isn't checked), which is the meaning of NULL here.
-- ---------------------------------------------------------------------------

alter table shop_products
  add constraint shop_products_id_shop_id_key unique (id, shop_id);

alter table bill_items
  add constraint bill_items_shop_product_same_shop_fkey
  foreign key (shop_product_id, shop_id) references shop_products (id, shop_id);
alter table bill_items drop constraint bill_items_shop_product_id_fkey;

alter table learned_aliases
  add constraint learned_aliases_shop_product_same_shop_fkey
  foreign key (shop_product_id, shop_id) references shop_products (id, shop_id);
alter table learned_aliases drop constraint learned_aliases_shop_product_id_fkey;

alter table provisional_products
  add constraint provisional_products_promoted_same_shop_fkey
  foreign key (promoted_shop_product_id, shop_id) references shop_products (id, shop_id);
alter table provisional_products drop constraint provisional_products_promoted_shop_product_id_fkey;

alter table price_observations
  add constraint price_observations_shop_product_same_shop_fkey
  foreign key (shop_product_id, shop_id) references shop_products (id, shop_id);
alter table price_observations drop constraint price_observations_shop_product_id_fkey;

-- bills already has unique (id, shop_id) (bills_id_shop_id_key, KB-110b).
alter table learning_events
  add constraint learning_events_bill_same_shop_fkey
  foreign key (bill_id, shop_id) references bills (id, shop_id);
alter table learning_events drop constraint learning_events_bill_id_fkey;

-- KI-38's note: copy_base_catalog was executable by PUBLIC and anon. An anon
-- call even ran without error (proven by scripts/rls-negative-tests.ts before
-- this migration). Signed-in users only, the same grants as push_bill.
revoke execute on function copy_base_catalog(uuid, text) from public, anon;
grant  execute on function copy_base_catalog(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. KI-41: the server never trusts the client's arithmetic.
--    A bill entering 'final' or 'cancelled' must have at least one item, its
--    items must sum to subtotal_paise, and subtotal_paise must equal
--    total_paise (no discounts or tax exist yet - revisit with them).
--    On the TABLE, not only in push_bill: bills_insert / bills_update RLS let
--    a member write bills directly, and this must hold on every path.
--    push_bill inserts a bill as draft, inserts its items, then moves it to
--    final - so the check runs at that update, items visible. A bill inserted
--    directly as final/cancelled has no items yet and is rejected. final ->
--    cancelled is not re-checked: the bill passed on entering final, and
--    bills_immutability forbids every other change.
--    KB422 = permanent in src/data/sync.ts (the same request fails forever).
--    SECURITY INVOKER: the caller can always see its own bill's items.
-- ---------------------------------------------------------------------------

create or replace function bills_enforce_totals()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_items bigint;
  v_sum   numeric;
begin
  if new.status not in ('final', 'cancelled') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    return new;
  end if;

  select count(*), coalesce(sum(total_paise), 0) into v_items, v_sum
  from bill_items where bill_id = new.id;

  if v_items = 0 then
    raise exception 'bills: a % bill must have at least one item (id=%)', new.status, new.id
      using errcode = 'KB422';
  end if;
  if v_sum <> new.subtotal_paise or new.subtotal_paise <> new.total_paise then
    raise exception 'bills: items sum to % but subtotal is % and total is % (id=%)',
      v_sum, new.subtotal_paise, new.total_paise, new.id
      using errcode = 'KB422';
  end if;
  return new;
end;
$$;

create trigger bills_totals
  before insert or update of status on bills
  for each row
  execute function bills_enforce_totals();
