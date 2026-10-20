-- KB-348 (owner, 20 Oct 2026; D90): self sign-up - any Google account may sign up and create a shop - so the rule the app
-- already assumes ("one shop per owner": findOwnShop reads it with maybeSingle) becomes a rule of the database. Without it,
-- one account could create shops without end through the API (shops_insert only checks owner_user_id = auth.uid()).
--
-- Additive (D55 section 5): the deployed app creates one shop per account and never a second (it looks first - KI-42).
--
-- Fail safe, change nothing: if an owner already has two shops (an interrupted set-up from long ago), say which and stop,
-- instead of failing half way with a less helpful message. The owner checks first, on the remote, with:
--   select owner_user_id, count(*) from shops group by 1 having count(*) > 1;

do $$
declare
  dupes text;
begin
  select string_agg(owner_user_id::text || ' (' || n || ' shops)', ', ') into dupes
  from (select owner_user_id, count(*) as n from shops group by owner_user_id having count(*) > 1) d;
  if dupes is not null then
    raise exception 'KB-348: these owners have more than one shop - resolve by hand first: %. Nothing was changed.', dupes;
  end if;
end
$$;

create unique index shops_one_per_owner on shops (owner_user_id);
