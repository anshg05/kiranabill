-- KB-326 (owner, 9 Oct 2026; D66): the server stamps every learning row, so a pull can use updated_at as its cursor
-- and as the learning_reset cutoff without ever trusting a device clock (D62, D64).
--
-- learned_aliases and provisional_products are pushed as UPSERTS and nothing bumped updated_at on the update: a wiped
-- phone would have pulled an alias at its first-ever hit count and never seen a later one (the KI-65 class). A
-- BEFORE INSERT OR UPDATE trigger now sets it (an upsert's conflict path fires the BEFORE UPDATE trigger too).
--
-- price_observations and learning_events are insert-only. Their updated_at already defaults to now() and no push ever
-- sends it (the client-sent columns are occurred_at and created_at, which are NOT used for the cursor or the cutoff) -
-- but a direct insert could still supply one, so an unconditional BEFORE INSERT trigger makes the stamp unforgeable.
--
-- Additive (D55 section 5): the deployed app never reads these stamps and its pushes don't send them.

create or replace function set_learning_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger learned_aliases_set_updated_at
  before insert or update on learned_aliases
  for each row execute function set_learning_updated_at();

create trigger provisional_products_set_updated_at
  before insert or update on provisional_products
  for each row execute function set_learning_updated_at();

create trigger price_observations_set_updated_at
  before insert on price_observations
  for each row execute function set_learning_updated_at();

create trigger learning_events_set_updated_at
  before insert on learning_events
  for each row execute function set_learning_updated_at();
