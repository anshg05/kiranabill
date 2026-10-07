-- KB-311 (owner, Q2): the server sets shop_products.updated_at on every insert
-- and update. The pull's cursor is "updated_at > the newest one seen", so a
-- write that left updated_at alone (a price edit from the Catalog screen, or
-- any client that forgot to send it) was never pulled by other devices or by
-- the writer's own re-pull. The client no longer chooses this value - the
-- catalog migration's "client-set, no server trigger" note is superseded.
--
-- Additive (D55 section 5): the deployed app never relies on sending its own
-- updated_at for shop_products (it only pulls them), so it keeps working.

create or replace function set_shop_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger shop_products_set_updated_at
  before insert or update on shop_products
  for each row execute function set_shop_products_updated_at();
