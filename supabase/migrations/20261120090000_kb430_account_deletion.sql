-- KB-430 (owner, 19-20 Nov 2026; D119): "Delete my account" - Google Play requires an in-app path and a web resource to delete an
-- account and its data. Immediate (no grace period), all or nothing, one transaction.
--
-- delete_account_internal(user): for every shop the user is a member or the owner of - REFUSED (nothing deleted) when any of them
-- has another member - deletes the shop's rows in foreign-key order (no foreign key cascades), then the shop, then the login
-- (auth.users; Supabase removes its identities and sessions with it). Recording FILES are not rows: voice_cleanup_due() (below)
-- now lists the files of a shop that no longer exists at once, so the daily clean-up removes them within about a day.
--
-- delete_my_account(): the app's call - no arguments, it acts on auth.uid() only, so no caller can name another user or shop.
-- delete_account_by_admin(user): for an e-mail request (the /delete-account page) - the owner runs it in the Supabase dashboard;
-- no app role may execute it.
--
-- Hard rule 2 (D119, owner): a finalised bill's lines cannot be removed - with ONE exception, account deletion. The trigger allows a
-- delete only when this transaction set kb.deleting_account AND the deleting role is not an app role (authenticated / anon):
-- inside the SECURITY DEFINER function the role is its owner; a signed-in user who sets the flag himself is still refused.
--
-- Additive (D55 section 5): two new functions (and their helper), two functions replaced with the same signature; app-v2 and the
-- website never call the new ones.

create or replace function bill_items_enforce_immutability()
returns trigger
language plpgsql
as $$
declare
  parent_status text;
  affected_bill_id uuid := coalesce(new.bill_id, old.bill_id);
begin
  -- KB-430 (D119): account deletion only - the flag of delete_account_internal() AND a non-app role (see the header)
  if tg_op = 'DELETE' and current_setting('kb.deleting_account', true) = 'on' and current_user not in ('authenticated', 'anon') then
    return old;
  end if;

  select status into parent_status from bills where id = affected_bill_id;

  if parent_status in ('final', 'cancelled') then
    raise exception 'bill_items: cannot add, change, or remove a line item on a % bill (bill_id=%)', parent_status, affected_bill_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function delete_account_internal(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shops uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  t text;
begin
  if p_user_id is null then
    raise exception 'delete_account: not signed in' using errcode = '28000';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'delete_account: no such account' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct s), '{}') into v_shops from (
    select shop_id as s from shop_members where user_id = p_user_id
    union
    select id from shops where owner_user_id = p_user_id
  ) x;

  if exists (select 1 from shop_members where shop_id = any (v_shops) and user_id <> p_user_id) then
    raise exception 'delete_account: a shop has other members - remove them first' using errcode = 'P0001', hint = 'shared_shop';
  end if;

  perform set_config('kb.deleting_account', 'on', true);

  -- children first (no foreign key cascades): bills' children, learning, recordings, numbers, then bills, products, the shop
  foreach t in array array[
    'bill_items', 'bill_cancellations', 'bill_metrics', 'learning_events', 'price_observations', 'learned_aliases',
    'provisional_products', 'voice_recordings', 'bill_number_grants', 'shop_bill_counters', 'receipt_number_blocks',
    'bills', 'shop_products', 'shop_members'
  ] loop
    execute format('delete from %I where shop_id = any ($1)', t) using v_shops;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, v_n);
  end loop;
  delete from shop_members where user_id = p_user_id; -- a membership with no shop row of its own (none expected)
  delete from shops where id = any (v_shops);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('shops', v_n);

  delete from auth.users where id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('auth_users', v_n);

  perform set_config('kb.deleting_account', 'off', true);
  return v_counts;
end;
$$;

revoke all on function delete_account_internal(uuid) from public, anon, authenticated, service_role;

create or replace function delete_my_account()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select delete_account_internal(auth.uid());
$$;

revoke all on function delete_my_account() from public, anon, service_role;
grant execute on function delete_my_account() to authenticated;

create or replace function delete_account_by_admin(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select delete_account_internal(p_user_id);
$$;

revoke all on function delete_account_by_admin(uuid) from public, anon, authenticated, service_role;

-- The daily clean-up's list: unchanged, plus - at once, not after 7 days - the recording files of a shop that no longer exists
-- (an account deleted, KB-430). Same signature, so the deployed clean-up function needs no change.
create or replace function voice_cleanup_due()
returns table (recording_id uuid, path text)
language sql
stable
security definer
set search_path = public
as $$
  (
    select v.recording_id, v.path
      from voice_recordings v
     where (v.billed_at is not null and v.billed_at < now() - interval '7 days')
        or (v.billed_at is null and v.created_at < now() - interval '7 days')
    union all
    select null::uuid, o.name
      from storage.objects o
     where o.bucket_id = 'recordings'
       and not exists (select 1 from voice_recordings v where v.path = o.name)
       and (
         o.created_at < now() - interval '7 days'
         or not exists (select 1 from shops s where s.id::text = split_part(o.name, '/', 1))
       )
  )
  limit 1000;
$$;

revoke all on function voice_cleanup_due() from public, anon, authenticated;
grant execute on function voice_cleanup_due() to service_role;
