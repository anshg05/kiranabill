-- KB-345 (owner, 20 Oct 2026; D90): a cheap "did anything change?" question for the sync loop.
--
-- Until now every phone ran a full pull every 15 s: 12 requests (measured, 20 Oct 2026) = about 2,900 requests an hour per
-- open phone, even with nothing new. The loop now asks THIS one question every 15 s and pulls a table only when its
-- answer moved (plus a full safety cycle about every 5 minutes, because a row that commits late can carry an older stamp).
--
-- sync_probe(shop) returns the newest server stamp of each table a pull reads (the same columns the pulls use as cursors):
-- bills.synced_at, the updated_at of cancellations, metrics, shop products and the learning tables, the shop row's
-- updated_at, and for receipt-number blocks (no updated_at) the count and the highest block_end.
--
-- SECURITY INVOKER (like push_bill and cancel_bill, D37): every statement runs as the caller under RLS (hard rule 4),
-- so a probe of another shop answers nulls. Not granted to anon.
--
-- Additive (D55 section 5): indexes and one function. The deployed app never calls it; the new client falls back to the
-- full pull if the function is missing.
--
-- The indexes make each max() an index read instead of a scan of the shop's rows (a shop may hold 40,000 bills).

create index if not exists bills_shop_synced_at_idx on bills (shop_id, synced_at desc);
create index if not exists shop_products_shop_updated_at_idx on shop_products (shop_id, updated_at desc);
create index if not exists learned_aliases_shop_updated_at_idx on learned_aliases (shop_id, updated_at desc);
create index if not exists provisional_products_shop_updated_at_idx on provisional_products (shop_id, updated_at desc);
create index if not exists price_observations_shop_updated_at_idx on price_observations (shop_id, updated_at desc);
create index if not exists learning_events_shop_updated_at_idx on learning_events (shop_id, updated_at desc);

create or replace function sync_probe(p_shop_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'bills', (select max(synced_at) from bills where shop_id = p_shop_id),
    'bill_cancellations', (select max(updated_at) from bill_cancellations where shop_id = p_shop_id),
    'bill_metrics', (select max(updated_at) from bill_metrics where shop_id = p_shop_id),
    'shop_products', (select max(updated_at) from shop_products where shop_id = p_shop_id),
    'shops', (select updated_at from shops where id = p_shop_id),
    'receipt_number_blocks', (select jsonb_build_array(count(*), coalesce(max(block_end), 0)) from receipt_number_blocks where shop_id = p_shop_id),
    'learning', (
      select greatest(
        (select max(updated_at) from learned_aliases where shop_id = p_shop_id),
        (select max(updated_at) from provisional_products where shop_id = p_shop_id),
        (select max(updated_at) from price_observations where shop_id = p_shop_id),
        (select max(updated_at) from learning_events where shop_id = p_shop_id)
      )
    )
  );
$$;

revoke execute on function sync_probe(uuid) from public, anon;
grant execute on function sync_probe(uuid) to authenticated;
