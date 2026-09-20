-- KB-107: bulk-copies base_products into a shop's own shop_products,
-- backing the "Ready catalog" choice on S2 onboarding (16-APP-FLOW.md
-- section 2).
--
-- Deliberately NOT security definer - runs as the calling authenticated
-- user, so shop_products_insert's existing with check (is_shop_member
-- (shop_id)) (KB-104) applies to every row of the bulk insert exactly as
-- it would to a single manual insert. One statement, one transaction: if
-- any row's with check fails, the whole copy fails atomically rather than
-- leaving a shop with half a catalog.
--
-- Deliberately does NOT use ON CONFLICT DO NOTHING against
-- shop_products's unique (shop_id, lower(display_name)) index. KI-26
-- documents two real base_products pairs that currently share a
-- display_name (Masoor Daal ids 19/623, Agarbatti ids 202/616) and are
-- genuinely different, differently-priced products - silently skipping
-- the second row on conflict would permanently and silently drop a real
-- product from every new shop's starting catalog, exactly the class of
-- defect this project argues against everywhere else. This function
-- stays strict and fails loudly if that collision (or a new one) ever
-- reaches it - KB-108 is responsible for keeping base_products.display_name
-- genuinely unique before "Ready catalog" is used against production data.
create or replace function copy_base_catalog(p_shop_id uuid, p_device_id text)
returns void
language plpgsql
as $$
begin
  insert into shop_products (
    id, shop_id, base_product_id, display_name, category, unit,
    price_paise, aliases, source, local_id, device_id
  )
  select
    gen_random_uuid(), p_shop_id, bp.id, bp.display_name, bp.source_category, bp.default_unit,
    bp.suggested_price_paise, bp.aliases, 'base', gen_random_uuid(), p_device_id
  from base_products bp
  where bp.is_active;
end;
$$;
