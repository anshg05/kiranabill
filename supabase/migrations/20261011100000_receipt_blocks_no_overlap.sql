-- KB-334 (D73, D74): a shop may use several devices at once, so two devices can reserve a receipt-number
-- block at the same moment. reserveBlock reads max(block_end) and inserts the next 50 (D22), and until now
-- nothing but the primary key stopped two devices taking overlapping ranges: two customers got the same
-- bill number, and the second bill was refused at push by bills unique (shop_id, receipt_number) - a
-- permanent conflict, so that bill could never sync.
--
-- This makes the database the arbiter, for ANY writer: no two blocks of one shop may overlap. The loser of
-- a race gets exclusion_violation (23P01); the app re-reads the highest block and tries the next range.
-- No SECURITY DEFINER anywhere (RLS stays the boundary - D37); no policy changes.
--
-- Additive (D55 section 5): the deployed app's reserveBlock logs a warning and returns on an insert error,
-- and billing then falls back to the D23 number - it cannot be broken by this constraint.
--
-- btree_gist is what lets a plain uuid (shop_id) sit beside a range in one GiST exclusion constraint. It is
-- installed in the "extensions" schema, where hosted Supabase keeps extensions (and where the local stack's
-- search_path already looks - supabase/config.toml extra_search_path).

create extension if not exists btree_gist with schema extensions;

-- Fail safe, change nothing: if a shop already has overlapping blocks (it cannot with one device), say so
-- instead of letting the constraint creation fail with a less helpful message half way.
do $$
begin
  if exists (
    select 1
    from receipt_number_blocks a
    join receipt_number_blocks b
      on a.shop_id = b.shop_id
     and a.id < b.id
     and int4range(a.block_start, a.block_end, '[]') && int4range(b.block_start, b.block_end, '[]')
  ) then
    raise exception 'KB-334: receipt_number_blocks holds overlapping ranges for one shop; resolve them by hand first. Nothing was changed.';
  end if;
end
$$;

alter table receipt_number_blocks
  add constraint receipt_number_blocks_no_overlap
  exclude using gist (shop_id with =, int4range(block_start, block_end, '[]') with &&);
