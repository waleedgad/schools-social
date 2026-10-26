-- Every 5 minutes, ask the web app to publish posts that are due. Vercel's
-- free plan only runs its own cron once a day, so Supabase does the timing.
-- The endpoint only posts what is due, so extra calls are harmless.
-- If the app moves to another address, run this again with the new URL.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'publish-due-posts',
  '*/5 * * * *',
  $$ select net.http_get(url := 'https://schools-social.vercel.app/api/cron/publish', timeout_milliseconds := 60000) $$
);
