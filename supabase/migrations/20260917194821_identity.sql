-- KB-103: identity tables (shops, shop_members).
--
-- Schema only - no RLS here. Enabling row level security and writing
-- policies is KB-104's job (docs/06-FEATURE-TICKETS.md), reviewed and
-- tested (KB-105, "the most important test in the suite") as its own
-- step. This migration only shapes the tables so KB-104's policies have
-- something correct to attach to:
--   - shops has no shop_id column - it IS the shop, identified by its own
--     id. KB-104 will need a bespoke policy shape here
--     (id in (select shop_id from shop_members where user_id = auth.uid())),
--     not the generic shop_id-based template every other table uses.
--   - shop_members's own RLS policy will need to query shop_members from
--     within its own policy (to answer "which shops can this user see
--     members of") - a well-known Postgres footgun ("infinite recursion
--     detected in policy for relation") if done naively. A composite PK
--     here (not a surrogate id) keeps that door open for a
--     security-definer helper function later without this table's shape
--     getting in the way.

create table shops (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id),
  name text not null,
  phone text,
  address text,
  logo_url text,
  catalog_mode text not null check (catalog_mode in ('base_imported', 'custom_only')),
  bill_language text not null default 'hi' check (bill_language in ('en', 'hi', 'both')),
  receipt_prefix text,
  -- docs/02-ARCHITECTURE.md section 2: shop settings use last-write-wins
  -- on updated_at during sync. The CLIENT sets this value on every write,
  -- both insert and update - no server-side trigger overwrites it, or
  -- last-write-wins would compare server receipt time instead of the
  -- actual edit time, defeating the point of the conflict strategy.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shop_members (
  shop_id uuid not null references shops (id),
  user_id uuid not null references auth.users (id),
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

-- Supports the RLS policies KB-104 will write against this table
-- ("shops this user belongs to" is looked up by user_id constantly).
create index on shop_members (user_id);
