
-- 1. Deduplicate existing rows: keep newest updated_at per (platform, telegram_id, date)
DELETE FROM public.chatter_history_live a
USING public.chatter_history_live b
WHERE a.platform = b.platform
  AND a.telegram_id = b.telegram_id
  AND a.date = b.date
  AND a.telegram_id IS NOT NULL
  AND (
    a.updated_at < b.updated_at
    OR (a.updated_at = b.updated_at AND a.id < b.id)
  );

-- 2. Drop old unique constraint
ALTER TABLE public.chatter_history_live
  DROP CONSTRAINT IF EXISTS chatter_history_live_platform_chatter_date_key;

-- 3. Enforce telegram_id NOT NULL (required for the new uniqueness rule)
ALTER TABLE public.chatter_history_live
  ALTER COLUMN telegram_id SET NOT NULL;

-- 4. Add new unique constraint
ALTER TABLE public.chatter_history_live
  ADD CONSTRAINT chatter_history_live_platform_telegram_date_key
  UNIQUE (platform, telegram_id, date);
