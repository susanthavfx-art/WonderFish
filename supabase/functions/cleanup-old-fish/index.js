// =============================================================================
// WonderFish • cleanup-old-fish (Supabase Edge Function) — plain JS, no imports
// -----------------------------------------------------------------------------
// Deletes scanned fish older than MAX_AGE_HOURS (default 48h = 2 days):
//   1. rows in public.aquarium_fishes  -> live tanks get a realtime DELETE event
//                                         and the fish swims away on screen
//   2. PNG textures in the `fish-textures` storage bucket (orphan files from
//      failed uploads / PIN resets included)
//
// Storage files can't be deleted with plain SQL (storage.protect_objects_delete),
// so this runs as an Edge Function with the service-role key + the Storage API.
//
// Triggered hourly by pg_cron + pg_net (supabase/migrations/*_cleanup_old_fish.sql).
// Protected by the `x-cleanup-secret` header, which must equal the CLEANUP_SECRET
// function secret (same value stored in Vault as `cleanup_old_fish_secret`).
// =============================================================================

const BUCKET = 'fish-textures';
const BATCH = 500;
const MAX_BATCHES = 20; // safety cap per run (10,000 rows / files)

Deno.serve(async (req) => {
  const expected = Deno.env.get('CLEANUP_SECRET');
  if (!expected || req.headers.get('x-cleanup-secret') !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };

  const maxAgeHours = Number(Deno.env.get('MAX_AGE_HOURS') || '48');
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();

  let rowsDeleted = 0;
  let filesDeleted = 0;
  const errors = [];

  // 1) Old fish rows (tanks remove them live through the realtime DELETE event)
  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await fetch(
      `${base}/rest/v1/aquarium_fishes?created_at=lt.${encodeURIComponent(cutoff)}` +
        `&select=id&order=id.asc&limit=${BATCH}`,
      { method: 'DELETE', headers: { ...headers, Prefer: 'return=representation' } }
    );
    if (!res.ok) {
      errors.push(`delete rows: ${res.status} ${await res.text()}`);
      break;
    }
    const deleted = await res.json();
    rowsDeleted += deleted.length;
    if (deleted.length < BATCH) break;
  }

  // 2) Old texture files (everything older than the cutoff, orphans included)
  for (let i = 0; i < MAX_BATCHES; i++) {
    const listRes = await fetch(`${base}/rest/v1/rpc/list_stale_fish_textures`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ older_than: cutoff, max_rows: BATCH })
    });
    if (!listRes.ok) {
      errors.push(`list files: ${listRes.status} ${await listRes.text()}`);
      break;
    }
    const paths = (await listRes.json()).map((r) => r.name).filter(Boolean);
    if (!paths.length) break;

    const rmRes = await fetch(`${base}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ prefixes: paths })
    });
    if (!rmRes.ok) {
      errors.push(`remove files: ${rmRes.status} ${await rmRes.text()}`);
      break;
    }
    const removed = await rmRes.json();
    filesDeleted += Array.isArray(removed) ? removed.length : 0;
    if (!Array.isArray(removed) || !removed.length || paths.length < BATCH) break;
  }

  const result = { cutoff, maxAgeHours, rowsDeleted, filesDeleted, errors };
  console.log('cleanup-old-fish', JSON.stringify(result));
  return json(result, errors.length ? 500 : 200);
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
