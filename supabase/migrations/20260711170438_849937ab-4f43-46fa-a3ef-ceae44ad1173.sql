
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.chatter_history_live
  ADD COLUMN IF NOT EXISTS revenue_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS stats_details   jsonb NOT NULL DEFAULT '{}'::jsonb;
