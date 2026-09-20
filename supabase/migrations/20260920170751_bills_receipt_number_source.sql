-- KB-111: bills.receipt_number_source - which allocation path produced
-- this bill's receipt_number. Needed to make 02-ARCHITECTURE.md section
-- 4 step 5 ("block exhausted while offline -> fall back to
-- {device_prefix}-{n}, reconcile on sync and flag it") architecturally
-- possible at all - without this column, there is nothing to reconcile
-- or flag once the bill syncs; the information is gone the moment it
-- would matter.
--
-- This is a PERMANENT BOOKKEEPING LABEL, never a trigger for
-- renumbering. Per section 4 step 3 - "the number shown to the customer
-- never changes after sync" - a fallback-numbered bill's receipt_number
-- is never replaced, renumbered, or touched once assigned; it stays
-- exactly as printed on the physical receipt forever.
-- "Reconcile on sync and flag it" (docs/07-DECISIONS.md D24) means the
-- shop owner can eventually SEE that a bill used the offline-exhaustion
-- path - surfaced in whichever ticket builds S5/S6, deliberately not
-- decided here - never that the system corrects or reissues the number.
-- A future migration that tries to "fix" a fallback receipt_number using
-- this column is misreading its purpose.

alter table bills
  add column receipt_number_source text not null default 'block'
    check (receipt_number_source in ('block', 'fallback'));
