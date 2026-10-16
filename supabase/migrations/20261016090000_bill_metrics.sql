-- KB-404 (owner, 16 Oct 2026; D80): per-bill pilot measurements - the numbers behind the release gate (01 S1-S7,
-- 06 "Release gate"). NUMBERS AND ENUMS ONLY: no customer name, no customer mobile, no transcript, no item name.
-- (The heard/billed pairs that S2 needs stay on the shopkeeper's phone - device-only, never in this table.)
--
-- One append-only row per finalised bill, written by the device that made it, AFTER the bill commits: a metrics
-- failure can never fail a bill, and no number here is ever read back into a bill (hard rule 7 spirit: a metric never
-- changes a price, a quantity or a total).
--
-- receipt_number, total_paise and line_count are what the device saw at Bill Banao; scripts/pilot/gate.sql compares
-- them with what the server holds (bills / bill_items) - the "no bill lost or corrupted" reconciliation.
--
-- Additive (D55 section 5): a new table; the deployed app never touches it.

create table bill_metrics (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id),
  bill_id uuid not null,
  bill_local_id uuid not null,
  device_id text not null,
  local_id uuid not null,
  -- the device's view at Bill Banao (reconciliation)
  receipt_number text not null,
  total_paise bigint not null check (total_paise >= 0),
  line_count int not null check (line_count >= 0),
  -- KB-404 definitions (docs/07 D80): a turn is a recording that reached transcription; seconds are active seconds
  -- (first activity to Bill Banao, any idle gap capped at 60 s)
  turns int not null check (turns >= 0),
  seconds_to_bill int not null check (seconds_to_bill >= 0),
  -- one object per utterance: { path: 'fastpath' | 'voice' | 'failed', stop_to_transcript_ms, transcript_to_items_ms }
  utterances jsonb not null default '[]'::jsonb check (jsonb_typeof(utterances) = 'array'),
  finalise_to_receipt_ms int check (finalise_to_receipt_ms is null or finalise_to_receipt_ms >= 0),
  voice_lines int not null check (voice_lines >= 0),
  edited_lines int not null check (edited_lines >= 0),
  manual_lines int not null check (manual_lines >= 0),
  removed_lines int not null check (removed_lines >= 0),
  not_added int not null check (not_added >= 0),
  flags_raised int not null check (flags_raised >= 0),
  flags_acknowledged int not null check (flags_acknowledged >= 0),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (shop_id, bill_id),
  unique (shop_id, local_id),
  -- same-shop integrity (KI-38)
  foreign key (bill_id, shop_id) references bills (id, shop_id)
);

create index on bill_metrics (shop_id, updated_at, id);

-- the server stamps updated_at (the pull cursor) - never a device clock (D62)
create trigger bill_metrics_set_updated_at
  before insert on bill_metrics
  for each row execute function set_learning_updated_at();

alter table bill_metrics enable row level security;

-- Select and insert for a member of the shop; no update, no delete policy at all (append-only).
create policy bill_metrics_select on bill_metrics for select
  using (is_shop_member(shop_id));

create policy bill_metrics_insert on bill_metrics for insert
  with check (is_shop_member(shop_id));
