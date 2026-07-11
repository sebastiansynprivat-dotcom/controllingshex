# Plan: Cron pull into chatter_history_live

## 1. Secret
Add a new secret `CONTROLLING_API_KEY` (via `add_secret`) — used as the `x-api-key` header for the external GET request.

## 2. DB migration
Extend `chatter_history_live` with two JSONB columns:
- `revenue_details jsonb` — `{ modelA: [amounts...], modelB: [...] }`
- `stats_details  jsonb` — `{ modelA: { mass_dms, unread_chats, oldest_chat }, ... }`

Both nullable with default `'{}'::jsonb`. The existing unique constraint `(platform, telegram_id, date)` stays as-is.

Also ensure `pg_cron` and `pg_net` extensions are enabled (for step 4).

## 3. New edge function `pull-chatter-live`
- Performs `GET https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/update-controlling` with header `x-api-key: ${CONTROLLING_API_KEY}`.
- Response is an array of chatter objects. For each object, iterate its `platforms` map and emit one row per platform key:
  - `platform` = capitalize(key) (`maloum` → `Maloum`, `brezzels` → `Brezzels`)
  - `chatter_name`, `telegram_id`, `date` from the root object
  - `revenue` = sum of `total` across all models on that platform
  - `mass_dms` = sum of `mass_dms`
  - `unread_chats` = sum of `unread_chats`
  - `oldest_chat` = max of `oldest_chat`
  - `revenue_details` = `{ [modelUsername]: amounts[] }`
  - `stats_details`   = `{ [modelUsername]: { mass_dms, unread_chats, oldest_chat } }`
- Objects with an empty `platforms` map are skipped.
- Bulk upsert into `chatter_history_live` using service role with `onConflict: "platform,telegram_id,date"`.
- After the upsert, call `supabase.rpc("recompute_live_now")` (same as the existing ingest path).
- CORS headers + error handling. No JWT check needed (invoked internally by cron); add `verify_jwt = false` block in `supabase/config.toml`.

The existing `upsert-chatter-live` function stays untouched.

## 4. Cron job
Scheduled via `supabase--insert` (not migration, because it embeds project-specific URL + anon key):

```sql
select cron.schedule(
  'pull-chatter-live-every-5min',
  '*/5 * * * *',
  $$ select net.http_post(
       url:='https://kgtbciqqvctjrelgbdvx.supabase.co/functions/v1/pull-chatter-live',
       headers:='{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb,
       body:='{}'::jsonb
     ); $$
);
```

## 5. Out of scope
- No frontend changes.
- No changes to existing ingestion paths (`upsert-chatter-live`, `hot-streak-check`, `increment_incoming_stats`). This new pull is a separate read-only sync that also persists the extra per-model breakdown.

## Open question
`revenue_details` / `stats_details` are not yet read anywhere in the frontend — stored now for later analytics. Confirm that's fine, or do you already want a UI surface for them?
