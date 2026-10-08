-- KB-324 (owner, Q1): the server stamps every new bill with its own time.
-- A bill's created_at / finalized_at come from the DEVICE (push_bill passes
-- them through), so a bill made offline yesterday and pushed today looks old -
-- the pull cannot use them as a cursor. synced_at already exists on bills but
-- nothing ever set it. A BEFORE INSERT trigger now sets it to now() (the
-- client's value, if any, is ignored). The incremental pull reads
-- "synced_at > cursor - 60 s" (D62's overlap).
--
-- Additive (D55 section 5): the deployed app never reads bills.synced_at.
-- INSERT only - no update path is touched, so bills_enforce_immutability's
-- whole-row comparison never sees synced_at change (push_bill inserts the bill
-- as a draft, then moves it to final; synced_at is already set by then).
-- No backfill: setting synced_at on existing final bills would need the
-- immutability triggers bypassed - never. Existing rows keep synced_at null and
-- reach a new device through the backfill (ordered by created_at) instead.

create or replace function set_bills_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at := now();
  return new;
end;
$$;

create trigger bills_set_synced_at
  before insert on bills
  for each row execute function set_bills_synced_at();
