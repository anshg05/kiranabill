-- KB-384a step 5 (owner, 9 Nov 2026; D105, D107): the DAILY call of the voice-cleanup Edge Function - run ONCE by the owner in the
-- Supabase SQL editor, AFTER the function is deployed and its two Vault secrets exist (docs/07 D107 item 13 has the steps).
-- Not a migration on purpose: pg_cron can only be created in the project's main database, and the backup's restore rehearsal
-- replays every migration into a scratch database (scripts/backup/rehearseRestore.ts).
--
-- The Vault holds the function's URL and the shared secret, so neither is written here. The call carries ONLY the shared secret -
-- never the service-role key. 21:30 UTC = 03:00 in India, when no shop is billing. Running this again replaces the job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'voice-cleanup-daily',
  '30 21 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'voice_cleanup_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'voice_cleanup_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
