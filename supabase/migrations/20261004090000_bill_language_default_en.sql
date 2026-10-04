-- KB-308 (owner, 4 Oct 2026; 07-DECISIONS.md D57): a NEW shop's receipts are
-- in English. Only the column DEFAULT changes - existing shops keep their
-- bill_language (no UPDATE). Hindi and both stay available (the check is
-- unchanged); switching is via Studio until KB-312's setting.
--
-- Compatible with the currently deployed app (D55 §5): the default applies
-- only when a shop is created, createShop never sends bill_language, and the
-- deployed build (6e29cf2) draws no receipt.

alter table public.shops alter column bill_language set default 'en';
