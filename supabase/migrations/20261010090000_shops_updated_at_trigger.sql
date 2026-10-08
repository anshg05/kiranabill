-- KB-312 (owner, 8 Oct 2026; KI-65, D64): the server sets shops.updated_at on every
-- insert and update, like shop_products (D62). Until now the DEVICE set it: two phones with
-- skewed clocks could lose an edit, and an edit made in Studio / SQL that left updated_at
-- alone never reached a device (KI-65). The sync rule changes with it (D64): the server's
-- updated_at is the only clock - a push reads it back and stores it verbatim, a pull takes
-- the server row whenever its updated_at differs from the local one.
--
-- Additive (D55 section 5): the deployed app still sends its own updated_at (now ignored)
-- and compares it with the server's on a pull; the server's value is later than the one it
-- sent, so the worst it does is take an identical row back once per edit. Its clock-skew
-- weakness stays until the next release - no worse than today.

create or replace function set_shops_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger shops_set_updated_at
  before insert or update on shops
  for each row execute function set_shops_updated_at();
