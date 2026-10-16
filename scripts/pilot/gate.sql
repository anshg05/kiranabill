-- KB-404 (docs/07-DECISIONS.md D80): the release gate's lines, computed on the SERVER from bill_metrics - the same numbers the
-- Developer-mode "Pilot numbers" panel shows, so they can be checked two ways.
--
-- HOW: open the Supabase dashboard -> SQL editor (it runs as postgres), replace the one uuid on the first line of `params`
-- with the pilot shop's id (select id, name from shops;), run. One row per line: (line, value).
--
-- DEFINITIONS (docs/07 D80): eligible = a final bill that is not the replacement of a cancelled one; the window = the last
-- 20 eligible VOICE bills (turns >= 1) by finalised time, across every device of the shop; typing = eligible hand-only bills
-- (0 turns, hand-added lines, no voice lines), the last 20; fast-path coverage = fastpath / (fastpath + voice) utterances,
-- failed ones counted apart; zero-edit = no edited, removed or not-added line, among bills with NO hand-added line; escaped
-- errors = bills cancelled for a wrong item / price / quantity (all of them until the window holds 20 bills, then those
-- finalised since its first bill). Cancelled bills and reissues are in no line but "escaped_errors".
-- Medians are percentile_cont(0.5); p95 is the nearest rank (percentile_disc) - the same as the app.
-- NUMBERS ONLY: bill_metrics holds no customer name or mobile, no transcript and no item name.
--
-- "NO BILL LOST OR CORRUPTED": reconciliation_problems counts bills whose server copy differs from what the device recorded
-- at Bill Banao (receipt number, total, item count) or is still a draft - it must be 0. (The app's "Check this phone's bills"
-- asks the same question from the phone's side.) bills_without_metrics is information (bills made before KB-404, or whose
-- metrics have not arrived yet).

with params as (select '00000000-0000-0000-0000-000000000000'::uuid as shop_id),
eligible as (
  select b.finalized_at, m.*
  from params p
  join bills b on b.shop_id = p.shop_id and b.status = 'final'
  join bill_metrics m on m.bill_id = b.id
  where not exists (select 1 from bill_cancellations c where c.shop_id = b.shop_id and c.replacement_local_id = b.local_id)
),
win as (select * from eligible where turns >= 1 order by finalized_at desc limit 20),
typed as (select * from eligible where turns = 0 and manual_lines > 0 and voice_lines = 0 order by finalized_at desc limit 20),
utt as (
  select u->>'path' as path, (u->>'stop_to_transcript_ms')::numeric as stop_ms, (u->>'transcript_to_items_ms')::numeric as items_ms
  from win, jsonb_array_elements(win.utterances) u
),
cov as (
  select count(*) filter (where path = 'fastpath') as fastpath, count(*) filter (where path = 'voice') as llm, count(*) filter (where path = 'failed') as failed from utt
),
nohands as (select * from win where manual_lines = 0),
zero as (select count(*) filter (where edited_lines = 0 and removed_lines = 0 and not_added = 0) as zero, count(*) as of from nohands),
escape_from as (select case when (select count(*) from win) < 20 then null else (select min(finalized_at) from win) end as at),
escaped as (
  select count(*) as n
  from params p
  join bill_cancellations c on c.shop_id = p.shop_id and c.reason in ('wrong_item', 'wrong_price', 'wrong_quantity')
  join bills b on b.id = c.bill_id
  where (select at from escape_from) is null or b.finalized_at >= (select at from escape_from)
),
recon as (
  select count(*) as checked,
         count(*) filter (
           where m.receipt_number <> b.receipt_number or m.total_paise <> b.total_paise
              or m.line_count <> (select count(*) from bill_items i where i.bill_id = b.id) or b.status = 'draft'
         ) as problems
  from params p join bill_metrics m on m.shop_id = p.shop_id join bills b on b.id = m.bill_id
),
nometrics as (
  select count(*) as n from params p join bills b on b.shop_id = p.shop_id and b.status in ('final', 'cancelled')
  where not exists (select 1 from bill_metrics m where m.bill_id = b.id)
)
select * from (
  select 1 as ord, 'voice_bills_in_window' as line, (select count(*) from win)::text as value
  union all select 2, 'turns_median', (select percentile_cont(0.5) within group (order by turns) from win)::text
  union all select 3, 'seconds_voice_median', (select percentile_cont(0.5) within group (order by seconds_to_bill) from win)::text
  union all select 4, 'seconds_typed_median', (select percentile_cont(0.5) within group (order by seconds_to_bill) from typed)::text
  union all select 5, 'seconds_typed_n', (select count(*) from typed)::text
  union all select 6, 'coverage_fastpath', fastpath::text from cov
  union all select 7, 'coverage_llm', llm::text from cov
  union all select 8, 'coverage_failed', failed::text from cov
  union all select 9, 'coverage_pct', (select round(100.0 * fastpath / nullif(fastpath + llm, 0)) from cov)::text
  union all select 10, 'zero_edit_zero', zero::text from zero
  union all select 11, 'zero_edit_of', of::text from zero
  union all select 12, 'zero_edit_pct', (select round(100.0 * zero / nullif(of, 0)) from zero)::text
  union all select 13, 'needing_hands', ((select count(*) from win) - (select count(*) from nohands))::text
  union all select 14, 'stop_to_transcript_median_ms', (select percentile_cont(0.5) within group (order by stop_ms) from utt)::text
  union all select 15, 'stop_to_transcript_p95_ms', (select percentile_disc(0.95) within group (order by stop_ms) from utt)::text
  union all select 16, 'stop_to_transcript_n', (select count(stop_ms) from utt)::text
  union all select 17, 'fastpath_to_items_median_ms', (select percentile_cont(0.5) within group (order by items_ms) from utt where path = 'fastpath')::text
  union all select 18, 'fastpath_to_items_p95_ms', (select percentile_disc(0.95) within group (order by items_ms) from utt where path = 'fastpath')::text
  union all select 19, 'fastpath_to_items_n', (select count(items_ms) from utt where path = 'fastpath')::text
  union all select 20, 'llm_to_items_median_ms', (select percentile_cont(0.5) within group (order by items_ms) from utt where path = 'voice')::text
  union all select 21, 'llm_to_items_p95_ms', (select percentile_disc(0.95) within group (order by items_ms) from utt where path = 'voice')::text
  union all select 22, 'llm_to_items_n', (select count(items_ms) from utt where path = 'voice')::text
  union all select 23, 'finalise_to_receipt_median_ms', (select percentile_cont(0.5) within group (order by finalise_to_receipt_ms) from win)::text
  union all select 24, 'finalise_to_receipt_p95_ms', (select percentile_disc(0.95) within group (order by finalise_to_receipt_ms) from win)::text
  union all select 25, 'finalise_to_receipt_n', (select count(finalise_to_receipt_ms) from win)::text
  union all select 26, 'escaped_errors', n::text from escaped
  union all select 27, 'reconciliation_checked', checked::text from recon
  union all select 28, 'reconciliation_problems', problems::text from recon
  union all select 29, 'bills_without_metrics', n::text from nometrics
) lines
order by ord;
