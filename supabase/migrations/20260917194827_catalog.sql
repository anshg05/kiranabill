-- KB-103: catalog tables (base_products, shop_products).
--
-- Schema only - RLS is KB-104's job. base_products is deliberately global
-- (docs/03-DATA-MODEL.md section 0 and 3): no shop_id column at all,
-- read-only by design. KB-104 grants select to authenticated with no
-- write policy whatsoever - there is no shop_id here to guard, nothing
-- structural to prepare.

create table base_products (
  id uuid primary key default gen_random_uuid(),
  catalog_version int not null,
  display_name text not null,
  source_category text,
  guard_category text not null check (guard_category in (
    'dal', 'oil', 'masala', 'tea', 'grain', 'soap', 'hygiene', 'dairy',
    'snack', 'sweet', 'beverage', 'condiment', 'dryfruit', 'household',
    'medicine', 'other'
  )),
  default_unit text not null,
  -- A zero-price catalog product is a silent free line item - the same
  -- defect KB-003's seed script explicitly guards against for the source
  -- data (its price test was tightened from non-negative to strictly
  -- positive during that ticket). Same rule, enforced here at the schema
  -- layer too, not just in the one-time seed script.
  suggested_price_paise bigint not null check (suggested_price_paise > 0),
  aliases jsonb not null default '[]'::jsonb,
  is_active boolean not null default true
);

create table shop_products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  base_product_id uuid references base_products (id),
  display_name text not null,
  category text,
  unit text not null,
  price_paise bigint not null check (price_paise > 0),
  aliases jsonb not null default '[]'::jsonb,
  source text not null check (source in ('base', 'custom', 'learned')),
  use_count int not null default 0,
  sku text,
  barcode text,
  is_active boolean not null default true,
  -- Sync fields (docs/03-DATA-MODEL.md iron rule 4). local_id/device_id
  -- are client-generated, no server default - a shop_product can be
  -- created offline, and the client must supply its own idempotency key
  -- the same way docs/02-ARCHITECTURE.md section 2 describes for bills.
  -- updated_at is also client-set on every write (last-write-wins is the
  -- documented conflict strategy for shop catalog) - no server trigger
  -- overwrites it.
  local_id uuid not null,
  device_id text not null,
  updated_at timestamptz not null default now(),
  unique (shop_id, local_id)
);

-- docs/03-DATA-MODEL.md section 9, verbatim. The (shop_id, lower(display_name))
-- uniqueness is an expression, not a plain column list, so it has to be a
-- unique INDEX, not a table-level `unique (...)` constraint (which only
-- accepts bare column names) - a real syntax error the local dry-run
-- caught immediately, not assumed to be fine.
create unique index on shop_products (shop_id, lower(display_name));
create index on shop_products (shop_id) where is_active;
