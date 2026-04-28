-- Auto-cleanup of expired undo entries using pg_cron
-- Entries for Drive trash operations expire after 30 days (Google's hard limit)

create extension if not exists pg_cron;

-- Daily job: mark entries past their expires_at as expired (3 AM UTC)
select cron.schedule(
  'expire-undo-entries',
  '0 3 * * *',
  $$
    update public.undo_history
    set undo_status = 'expired'
    where undo_status = 'available'
      and expires_at is not null
      and expires_at < now();
  $$
);

-- Weekly job: hard delete of old terminal-state entries (Sundays 4 AM UTC)
-- Keep entries for audit purposes for 90 days, then purge
select cron.schedule(
  'purge-old-undo-entries',
  '0 4 * * 0',
  $$
    delete from public.undo_history
    where undo_status in ('done', 'expired', 'failed')
      and created_at < now() - interval '90 days';
  $$
);
