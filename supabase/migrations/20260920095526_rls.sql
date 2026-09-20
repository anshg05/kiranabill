-- KB-104: RLS policies. shop_id is the security boundary (CLAUDE.md hard
-- rule 4, 00-README.md non-negotiable 6) - never client-side filtering.
--
-- Two security-definer helper functions exist to avoid a real Postgres
-- footgun: a naive per-table policy of the form
--   using (shop_id in (select shop_id from shop_members where user_id = auth.uid()))
-- applied to shop_members ITSELF queries shop_members from within its own
-- RLS policy - "infinite recursion detected in policy for relation."
-- is_shop_member()/is_shop_owner() are security definer, owned by the
-- migration role, which is exempt from its own tables' RLS by default -
-- so the query inside each function bypasses shop_members' policies
-- entirely, breaking the loop. Used on every shop_id table, not just
-- shop_members, so the membership/ownership check lives in one place
-- (KB-104 plan, approved deviation from 03-DATA-MODEL.md section 7's
-- literal per-table inline-subquery template).

create or replace function is_shop_member(check_shop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from shop_members
    where shop_id = check_shop_id
      and user_id = auth.uid()
  );
$$;

create or replace function is_shop_owner(check_shop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from shop_members
    where shop_id = check_shop_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

-- Found by KB-104's own manual smoke test, not assumed safe: the
-- shop_members bootstrap insert (below) originally queried shops directly
-- ("shop_id in (select id from shops where owner_user_id = auth.uid())"),
-- which is subject to shops' OWN RLS (shops_select requires
-- is_shop_member(id)) - so a brand-new owner, who isn't a member yet,
-- could never pass that subquery. Same circular-dependency class as
-- is_shop_member/is_shop_owner, just across two tables instead of one.
-- owns_shop() bypasses shops' RLS the same way, breaking the loop.
create or replace function owns_shop(check_shop_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from shops
    where id = check_shop_id
      and owner_user_id = auth.uid()
  );
$$;

-- shops has no shop_id column - it IS the shop, identified by its own id.
-- shops_insert requires owner_user_id = auth.uid() with no OR branch: a
-- user can only ever insert a shop row that names themselves as owner,
-- never a shop owned by someone else.
alter table shops enable row level security;

create policy shops_select on shops for select
  using (is_shop_member(id));

create policy shops_insert on shops for insert
  with check (owner_user_id = auth.uid());

create policy shops_update on shops for update
  using (is_shop_member(id));

-- shop_members_insert's bootstrap branch depends on the shops row already
-- existing with owner_user_id = auth.uid() BEFORE this insert runs - the
-- shop insert and this membership insert are two separate statements that
-- must happen in that order, in the same transaction or the same request.
-- Whichever ticket builds onboarding (KB-107) must insert the shop row
-- first, then this row - reversing the order, or running them as
-- independent unordered requests, makes the bootstrap case silently fail
-- (the membership insert's with-check has no shop to match against yet).
alter table shop_members enable row level security;

create policy shop_members_select on shop_members for select
  using (is_shop_member(shop_id));

create policy shop_members_insert on shop_members for insert
  with check (
    -- Bootstrap case: a user creating their own shop inserts themselves
    -- as its first owner. Keyed off shops.owner_user_id via owns_shop(),
    -- not shop membership - there is no membership row yet for a
    -- brand-new shop, so is_shop_owner()/is_shop_member() would make the
    -- very first insert impossible. owns_shop() specifically (not a plain
    -- subquery against shops) because shops' own RLS would otherwise
    -- block this exact check for the same reason - see owns_shop()'s
    -- comment above.
    (user_id = auth.uid() and role = 'owner' and owns_shop(shop_id))
    or
    -- Invite case: an existing owner of the shop adds another member.
    is_shop_owner(shop_id)
  );

create policy shop_members_update on shop_members for update
  using (is_shop_owner(shop_id));

-- Standard shape: select/insert/update via shop membership, no delete.
alter table bills enable row level security;

create policy bills_select on bills for select
  using (is_shop_member(shop_id));

create policy bills_insert on bills for insert
  with check (is_shop_member(shop_id));

create policy bills_update on bills for update
  using (is_shop_member(shop_id));

alter table shop_products enable row level security;

create policy shop_products_select on shop_products for select
  using (is_shop_member(shop_id));

create policy shop_products_insert on shop_products for insert
  with check (is_shop_member(shop_id));

create policy shop_products_update on shop_products for update
  using (is_shop_member(shop_id));

alter table learned_aliases enable row level security;

create policy learned_aliases_select on learned_aliases for select
  using (is_shop_member(shop_id));

create policy learned_aliases_insert on learned_aliases for insert
  with check (is_shop_member(shop_id));

create policy learned_aliases_update on learned_aliases for update
  using (is_shop_member(shop_id));

alter table provisional_products enable row level security;

create policy provisional_products_select on provisional_products for select
  using (is_shop_member(shop_id));

create policy provisional_products_insert on provisional_products for insert
  with check (is_shop_member(shop_id));

create policy provisional_products_update on provisional_products for update
  using (is_shop_member(shop_id));

-- bill_items also gets a delete policy, unlike the four tables above -
-- KB-103's bill_items_enforce_immutability trigger already has a
-- tg_op = 'DELETE' branch anticipating this, and a missing RLS delete
-- policy would silently block something the trigger explicitly permits.
-- This policy grants shop-level access only - it has no awareness of the
-- parent bill's status. The actual "only while the bill is still draft"
-- restriction is enforced entirely by the trigger, which fires after RLS
-- passes and raises if the parent bill is final/cancelled. Two
-- independent layers: RLS answers "does this row belong to your shop",
-- the trigger answers "is this delete legal given the bill's state."
alter table bill_items enable row level security;

create policy bill_items_select on bill_items for select
  using (is_shop_member(shop_id));

create policy bill_items_insert on bill_items for insert
  with check (is_shop_member(shop_id));

create policy bill_items_update on bill_items for update
  using (is_shop_member(shop_id));

create policy bill_items_delete on bill_items for delete
  using (is_shop_member(shop_id));

-- Append-only per 03-DATA-MODEL.md section 5 (explicit in the doc text,
-- not inferred here): select+insert only, no update, no delete.
alter table price_observations enable row level security;

create policy price_observations_select on price_observations for select
  using (is_shop_member(shop_id));

create policy price_observations_insert on price_observations for insert
  with check (is_shop_member(shop_id));

alter table learning_events enable row level security;

create policy learning_events_select on learning_events for select
  using (is_shop_member(shop_id));

create policy learning_events_insert on learning_events for insert
  with check (is_shop_member(shop_id));

alter table receipt_number_blocks enable row level security;

create policy receipt_number_blocks_select on receipt_number_blocks for select
  using (is_shop_member(shop_id));

create policy receipt_number_blocks_insert on receipt_number_blocks for insert
  with check (is_shop_member(shop_id));

create policy receipt_number_blocks_update on receipt_number_blocks for update
  using (is_shop_member(shop_id));

-- base_products is global and ownerless (no shop_id column) - read-only
-- to every authenticated user, no insert/update/delete policy at all,
-- per 03-DATA-MODEL.md section 7 verbatim.
alter table base_products enable row level security;

create policy base_products_select on base_products for select
  to authenticated
  using (true);
