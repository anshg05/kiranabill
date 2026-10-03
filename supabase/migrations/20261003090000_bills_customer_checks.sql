-- KB-306 (owner, 3 Oct 2026; docs/07-DECISIONS.md D6, D52): the customer on
-- a bill, checked on the server too - the client can be bypassed, and a
-- future udhaar matches bills by mobile, so the data must be clean.
--
-- These rules are IDENTICAL to src/domain/customer.ts (isStorableName /
-- isStorableMobile). char_length counts characters = code points in a UTF8
-- database; the client counts code points too ([...s].length), never JS
-- .length (UTF-16 units). A mismatch would make a bill a permanent 23514
-- sync conflict - src/data/customer.e2e.test.ts pushes every tricky input
-- (Devanagari, emoji, ZWJ sequences, exactly 60 / 61, every mobile prefix
-- form) through push_bill and asserts client-accept <=> server-accept.
--
-- customer_mobile is stored as exactly 10 digits (D52): no +91, no spaces.
-- Remote had 0 bills when this was written (owner, 3 Oct 2026; re-checked
-- read-only before the push).

alter table bills
  add constraint bills_customer_name_check
    check (char_length(customer_name) between 1 and 60),
  add constraint bills_customer_mobile_check
    check (customer_mobile is null or customer_mobile ~ '^[6-9][0-9]{9}$');
