-- KB-103: learning tables (learned_aliases, provisional_products,
-- price_observations, learning_events).
--
-- Schema only - RLS is KB-104's job. price_observations and
-- learning_events are append-only by design (docs/03-DATA-MODEL.md
-- sections 5): KB-104's policies should grant select+insert only, no
-- update/delete, the same pattern base_products already uses for its own
-- read-only guarantee. Not enforced by a trigger here - that's a policy
-- decision, deliberately left to KB-104, not schema.
--
-- All four tables carry local_id/device_id/updated_at even though
-- 03-DATA-MODEL.md's own per-table lists for this section omit them -
-- see docs/07-DECISIONS.md D17 for the full reasoning: iron rule 4 is
-- unconditional, and 08-LEARNING-ENGINE.md section 8 explicitly confirms
-- learning rows sync like everything else.

create table learned_aliases (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  alias text not null,
  shop_product_id uuid not null references shop_products (id),
  hit_count int not null default 0,
  -- numeric(3,2), not real/float - the same "no floating point near an
  -- exact threshold" reasoning as money paise, applied to confidence's
  -- exact 0.3/0.5/0.7/0.8/0.9 boundaries (docs/07-DECISIONS.md D15).
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  source text not null check (source in ('correction', 'confirmation')),
  local_id uuid not null,
  device_id text not null,
  updated_at timestamptz not null default now(),
  unique (shop_id, local_id)
);

-- Same expression-index fix as shop_products above: (shop_id, lower(alias))
-- must be a unique index, not a table-level unique (...) constraint.
create unique index on learned_aliases (shop_id, lower(alias));

create table provisional_products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  spoken_name text not null,
  seen_count int not null default 0,
  suggested_unit text,
  suggested_price_paise bigint check (suggested_price_paise > 0),
  promoted_at timestamptz,
  promoted_shop_product_id uuid references shop_products (id),
  local_id uuid not null,
  device_id text not null,
  updated_at timestamptz not null default now(),
  unique (shop_id, local_id)
);

create index on provisional_products (shop_id, seen_count desc) where promoted_at is null;

create table price_observations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  shop_product_id uuid not null references shop_products (id),
  observed_price_paise bigint not null check (observed_price_paise > 0),
  occurred_at timestamptz not null default now(),
  local_id uuid not null,
  device_id text not null,
  updated_at timestamptz not null default now(),
  unique (shop_id, local_id)
);

create table learning_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  bill_id uuid references bills (id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  local_id uuid not null,
  device_id text not null,
  updated_at timestamptz not null default now(),
  unique (shop_id, local_id)
);
