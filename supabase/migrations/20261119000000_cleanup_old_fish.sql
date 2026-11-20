-- ============================================================================
-- WonderFish • Auto-delete scanned fish older than 2 days
-- ----------------------------------------------------------------------------
-- Keeps Supabase storage / egress small when many venues run tanks every day.
--
--   pg_cron (hourly) --pg_net--> Edge Function `cleanup-old-fish`
--        deletes public.aquarium_fishes rows   older than 48h
--        deletes fish-textures storage files   older than 48h (orphans too)
--
-- The Edge Function source lives in supabase/functions/cleanup-old-fish/index.js
-- Change the age with the MAX_AGE_HOURS function secret (default 48).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Lists storage object paths in the fish-textures bucket older than a cutoff.
-- Storage rows can't be deleted with SQL (protect_objects_delete trigger), so the
-- Edge Function deletes the returned paths through the Storage API.
CREATE OR REPLACE FUNCTION public.list_stale_fish_textures(older_than timestamptz, max_rows integer DEFAULT 500)
RETURNS TABLE (name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'fish-textures'
    AND o.created_at < older_than
  ORDER BY o.created_at
  LIMIT greatest(1, least(coalesce(max_rows, 500), 1000));
$$;

REVOKE ALL ON FUNCTION public.list_stale_fish_textures(timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_stale_fish_textures(timestamptz, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- One-time setup (run manually — keeps the secret out of git):
--
--   1. Pick a long random secret, set it as the Edge Function secret CLEANUP_SECRET
--   2. select vault.create_secret('<same secret>', 'cleanup_old_fish_secret');
--   3. Schedule the hourly job:
--
-- select cron.schedule(
--   'cleanup-old-fish-hourly',
--   '17 * * * *',
--   $job$
--   select net.http_post(
--     url := 'https://tjvmncxnnurseyqheblp.supabase.co/functions/v1/cleanup-old-fish',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cleanup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_old_fish_secret')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 30000
--   );
--   $job$
-- );
--
-- Check runs:   select * from cron.job_run_details order by start_time desc limit 10;
-- HTTP results: select id, status_code, content from net._http_response order by id desc limit 10;
-- ----------------------------------------------------------------------------
